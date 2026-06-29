// ── Free trial: trava por uso, contada no servidor ──────────────────────────
// Free trial por tipo de ação: 2 de cada = 1 rodada completa no onboarding
// guiado + 1 rodada completa que a pessoa faz sozinha. Depois disso, paywall.
const FREE_LIMIT = { analysis: 2, resume: 2, interview: 2 };
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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { prompt, json_mode = true, mode = 'standard', model = 'claude-sonnet-4-5', kind } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt ausente' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Chave da API não configurada no servidor' });
  }

  // ── Trava do free trial (só quando vem 'kind' de uma ação gratuita-limitada) ──
  let _incCol = null, _incUser = null, _incCur = 0, _evtKind = null, _evtUser = null;
  if (kind && KIND_COL[kind]) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = await getUser(token);
    if (!user) return res.status(401).json({ error: 'Não autenticado' });
    const col = KIND_COL[kind];
    const usage = await getUsage(user.id);
    const used = (usage && usage[col]) || 0;
    if (used >= (FREE_LIMIT[kind] || 1)) {
      const subbed = await hasActiveSub(user.email);
      if (!subbed) return res.status(402).json({ error: 'trial_over', kind: kind });
    } else {
      _incCol = col; _incUser = user.id; _incCur = used;
    }
    _evtKind = kind; _evtUser = user.id;   // registra o evento (qualquer uso permitido)
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
      return res.status(response.status).json({
        error: data.error?.message || 'Erro na API Anthropic'
      });
    }

    const text = data.content[0].text.trim();
    if (_incCol) await bumpUsage(_incUser, _incCol, _incCur);  // consumiu 1 uso grátis
    if (_evtKind) await logEvent(_evtUser, _evtKind);          // registra o evento de uso
    return res.status(200).json({ result: text });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
