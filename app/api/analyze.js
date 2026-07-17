import { brevoUpsert, brevoToday, brevoListPaywall, brevoListResume } from './_brevo.js';

// ── Free trial: trava por uso, contada no servidor ──────────────────────────
// Free trial POOLED: 3 ações de IA que a pessoa faz SOZINHA (fit + currículo
// + preparação, somadas). Ações do tour guiado (guided) NÃO contam. Ao chegar
// em 3, entra o paywall.
const FREE_TOTAL = 3;
const KIND_COL = { analysis: 'analyses_used', resume: 'resumes_used', interview: 'interviews_used' };

async function getUser(token) {
  if (!token || !process.env.SUPABASE_URL) return null;
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: process.env.SUPABASE_ANON_KEY }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}
async function getUsage(userId) {
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/usage?user_id=eq.' + userId + '&select=analyses_used,resumes_used,interviews_used', {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY }
    });
    const d = await r.json();
    return (Array.isArray(d) && d[0]) || null;
  } catch (e) { return null; }
}
async function bumpUsage(userId, col, current) {
  const body = { user_id: userId, updated_at: new Date().toISOString() };
  body[col] = (current || 0) + 1;
  try {
    await fetch(process.env.SUPABASE_URL + '/rest/v1/usage', {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(body)
    });
  } catch (e) {}
}
async function logEvent(userId, action) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !userId) return;
  try {
    await fetch(process.env.SUPABASE_URL + '/rest/v1/usage_events', {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, action: action })
    });
  } catch (e) {}
}

// Teto de acoes 'guided' (tour) por usuario. O tour faz ~3-4 chamadas de IA;
// depois disso, guided deixa de ser gratuito (conta como normal), pra ninguem
// fingir tour infinito e furar o paywall gastando a chave da IA.
const GUIDED_CAP = 10;
async function countGuidedEvents(userId) {
  if (!userId || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return GUIDED_CAP; // sem como contar: trava por seguranca
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/usage_events?user_id=eq.' + userId + '&action=eq.guided&select=id', {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        Prefer: 'count=exact', Range: '0-0'
      }
    });
    const cr = r.headers.get('content-range') || '';   // ex.: "0-0/5"
    const n = parseInt((cr.split('/')[1] || '0'), 10);
    return isNaN(n) ? 0 : n;
  } catch (e) { return GUIDED_CAP; }   // erro: trava por seguranca
}
async function hasActiveSub(email) {
  if (!process.env.STRIPE_SECRET_KEY || !email) return false;
  try {
    const h = { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY };
    const cr = await fetch('https://api.stripe.com/v1/customers?limit=1&email=' + encodeURIComponent(email), { headers: h });
    const cd = await cr.json();
    const cust = cd.data && cd.data[0];
    if (!cust) return false;
    const sr = await fetch('https://api.stripe.com/v1/subscriptions?status=all&limit=5&customer=' + cust.id, { headers: h });
    const sd = await sr.json();
    return !!(sd.data || []).find(s => ['active', 'trialing', 'past_due'].includes(s.status));
  } catch (e) { return false; }
}

// Allowlist de e-mails SEMPRE tratados como assinantes. Serve pros pagantes legados
// cujo e-mail do Stripe pode diferir do e-mail de login (o hasActiveSub busca por
// e-mail e nao acha). Configura via env SUBSCRIBER_EMAILS (lista separada por virgula).
function isAllowlistedSub(email) {
  if (!email || !process.env.SUBSCRIBER_EMAILS) return false;
  const list = process.env.SUBSCRIBER_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

// Assinatura ativa lida da tabela `subscriptions` (populada pelo webhook do Stripe),
// amarrada por user_id. E o caminho CONFIAVEL: independe do e-mail do Stripe bater.
async function hasActiveSubDB(userId) {
  if (!userId || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/subscriptions?user_id=eq.' + userId + '&select=status', {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY }
    });
    const d = await r.json();
    const row = Array.isArray(d) && d[0];
    return !!(row && ['active', 'trialing', 'past_due'].includes(row.status));
  } catch (e) { return false; }
}

// ── Regras de negocio (prompts) no SERVIDOR, nao mais no frontend ────────────
// O cliente manda so os dados (perfil, vaga); o prompt e montado aqui e nunca
// aparece no view-source. Fase 1: analise de fit. (Curriculo/entrevista virao nas
// proximas fases.)
function buildAnalysisPrompt(d) {
  const profile = (d && d.profile) || '';
  const jd = (d && d.jd) || '';
  return `Você é um especialista em recrutamento e carreira. Analise o fit entre o perfil profissional e a vaga abaixo.

## PERFIL DA CANDIDATA
${profile}

## DESCRIÇÃO DA VAGA
${jd}

Responda SOMENTE com um JSON válido neste formato exato (sem markdown, sem texto extra):
{
  "score": <número 0-100>,
  "company": "<nome da empresa da vaga>",
  "role": "<título exato do cargo da vaga>",
  "label": "<Ex: Fit muito forte | Fit sólido | Fit parcial | Fit baixo>",
  "summary": "<1-2 frases explicando o score de forma direta>",
  "pillars": [
    {"name": "Experiência", "pct": <0-100>},
    {"name": "Skills técnicas", "pct": <0-100>},
    {"name": "Senioridade", "pct": <0-100>},
    {"name": "Contexto/setor", "pct": <0-100>},
    {"name": "LATAM / idioma", "pct": <0-100>}
  ],
  "has": ["<ponto forte 1>", "<ponto forte 2>", "<ponto forte 3>"],
  "lacks": ["<gap 1>", "<gap 2>"],
  "tips": ["<dica específica de como adaptar o currículo ou posicionamento para passar na triagem do ATS e do recrutador para esta vaga, por exemplo: quais keywords incluir, como reescrever o resumo, o que destacar>", "<dica 2>", "<dica 3>"]
}

Nos textos (summary, has, lacks, tips), NÃO use travessão nem meia-risca; use vírgula, ponto ou dois-pontos. Português brasileiro correto com todos os acentos.`;
}

function buildPromptForTask(task, data) {
  if (task === 'analysis') return buildAnalysisPrompt(data);
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', (function(o){return (['https://app.myliplop.com','https://myliplop.com','https://www.myliplop.com'].includes(o)||/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o))?o:'https://app.myliplop.com';})(req.headers.origin||''));
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', (function(o){return (['https://app.myliplop.com','https://myliplop.com','https://www.myliplop.com'].includes(o)||/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o))?o:'https://app.myliplop.com';})(req.headers.origin||''));
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { json_mode = true, mode = 'standard', model = 'claude-sonnet-4-5', kind, guided, task, data } = req.body;
  // Prompt vem montado no SERVIDOR (via task+data) ou, legado, direto do cliente (prompt).
  // As proximas fases migram os demais fluxos pra task; ate la o legado segue funcionando.
  const prompt = task ? buildPromptForTask(task, data || {}) : req.body.prompt;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt ausente' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Chave da API não configurada no servidor' });
  }

  // ── Auth OBRIGATORIA pra QUALQUER chamada a este endpoint. Fecha o endpoint aberto:
  // antes, um request SEM 'kind' (ou via curl/script) passava direto e usava o Claude
  // sem login, gastando a chave da Anthropic. Agora: sem token valido, sem IA. ──
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await getUser(token);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });

  // ── Trava do free trial (toda acao de IA com 'kind') ──
  let _incCol = null, _incUser = null, _incCur = 0, _evtKind = null, _evtUser = null, _logGuided = false;
  if (kind && KIND_COL[kind]) {
    _evtUser = user.id;

    // 'guided' (tour) so e gratuito ate o teto; passou disso, conta como acao normal.
    const guidedOk = guided && (await countGuidedEvents(user.id)) < GUIDED_CAP;

    if (!guidedOk) {
      const col = KIND_COL[kind];
      const usage = await getUsage(user.id);
      const total = ((usage && usage.analyses_used) || 0) + ((usage && usage.resumes_used) || 0) + ((usage && usage.interviews_used) || 0);
      if (total >= FREE_TOTAL) {
        const subbed = isAllowlistedSub(user.email) || await hasActiveSubDB(user.id) || await hasActiveSub(user.email);
        if (!subbed) {
          await brevoUpsert(user.email, { IS_SUBSCRIBER: 'no' }, brevoListPaywall());   // fluxo 1: bateu no paywall e nao e assinante
          return res.status(402).json({ error: 'trial_over', kind: kind });
        }
      } else {
        _incCol = col; _incUser = user.id; _incCur = (usage && usage[col]) || 0;
      }
      _evtKind = kind;   // registra o evento normal (uso permitido, nao-guided)
    } else {
      _logGuided = true;   // conta esse uso guided no teto
    }
  }

  try {
    // ── Modo job_search: usa web search tool para buscar vagas reais ──
    if (mode === 'job_search') {
      const messages = [{ role: 'user', content: prompt }];
      let finalText = '';
      let attempts = 0;

      while (attempts < 6) {
        attempts++;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'web-search-2025-03-05'
          },
          body: JSON.stringify({
            model: 'claude-opus-4-5',
            max_tokens: 4096,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            system: 'You are a job search specialist. Use web search to scrape real company career pages (company websites, Gupy, Inhire, etc.) and find real open job listings. Read the actual job pages to confirm they are still open. Avoid LinkedIn individual job URLs as they expire. Always respond with valid JSON only at the end — no markdown, no explanation.',
            messages
          })
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('[analyze/job_search] Anthropic', response.status, 'model=claude-opus-4-5', JSON.stringify(data && data.error));
          return res.status(response.status).json({ error: data.error?.message || 'Erro na API Anthropic' });
        }

        if (data.stop_reason === 'end_turn') {
          finalText = data.content.find(b => b.type === 'text')?.text?.trim() || '';
          break;
        }

        if (data.stop_reason === 'tool_use') {
          // Adiciona a resposta do assistente com os tool_use blocks
          messages.push({ role: 'assistant', content: data.content });

          // Coleta resultados de todas as tool_use calls
          const toolResults = data.content
            .filter(b => b.type === 'tool_use')
            .map(b => ({
              type: 'tool_result',
              tool_use_id: b.id,
              content: b.content || ''
            }));

          messages.push({ role: 'user', content: toolResults });
        } else {
          // stop_reason inesperado — pega o texto se houver
          finalText = data.content?.find(b => b.type === 'text')?.text?.trim() || '';
          break;
        }
      }

      return res.status(200).json({ result: finalText });
    }

    // ── Modo padrão ──────────────────────────────────────────────────
    const systemPrompt = json_mode
      ? 'You are a helpful assistant. Always respond with valid JSON only, no markdown, no explanation.'
      : 'You are a helpful assistant.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[analyze] Anthropic', response.status, 'model=' + model, 'promptChars=' + (prompt ? prompt.length : 0), JSON.stringify(data && data.error));
      return res.status(response.status).json({
        error: data.error?.message || 'Erro na API Anthropic'
      });
    }

    const text = data.content[0].text.trim();
    if (_incCol) await bumpUsage(_incUser, _incCol, _incCur);  // consumiu 1 uso grátis
    if (_evtKind) await logEvent(_evtUser, _evtKind);          // registra o evento de uso
    if (_logGuided) await logEvent(_evtUser, 'guided');        // conta a ação guided no teto
    // Brevo (ativacao): marca 'ativo hoje'; se gerou curriculo, entra na lista do fluxo 2.
    await brevoUpsert(user.email, { LAST_ACTIVE: brevoToday() }, _evtKind === 'resume' ? brevoListResume() : []);
    return res.status(200).json({ result: text });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
