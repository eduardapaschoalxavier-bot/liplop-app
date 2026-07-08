// Estado do usuario logado pro topbar: quantos creditos gratis restam e se ja e
// assinante. So LEITURA (nao altera nada). O front usa isso pra mostrar o contador
// e o botao "Tenha o Liplop Ilimitado". Mesma logica de assinante do /api/analyze.

const FREE_TOTAL = 3;

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', (function (o) {
    return (['https://app.myliplop.com', 'https://myliplop.com', 'https://www.myliplop.com'].includes(o)
      || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o)) ? o : 'https://app.myliplop.com';
  })(origin || ''));
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

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
  if (!userId || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/usage?user_id=eq.' + userId + '&select=analyses_used,resumes_used,interviews_used', {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY }
    });
    const d = await r.json();
    return (Array.isArray(d) && d[0]) || null;
  } catch (e) { return null; }
}

function isAllowlistedSub(email) {
  if (!email || !process.env.SUBSCRIBER_EMAILS) return false;
  const list = process.env.SUBSCRIBER_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

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

export default async function handler(req, res) {
  cors(res, req.headers.origin || '');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = await getUser(token);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }

  const subscriber = isAllowlistedSub(user.email) || await hasActiveSubDB(user.id);
  const u = await getUsage(user.id);
  const used = u ? ((u.analyses_used || 0) + (u.resumes_used || 0) + (u.interviews_used || 0)) : 0;
  // clamp pra sanidade visual (uso legado pode ser negativo por ajuste manual)
  const remaining = Math.min(FREE_TOTAL, Math.max(0, FREE_TOTAL - used));

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ subscriber, used: Math.max(0, used), total: FREE_TOTAL, remaining });
}
