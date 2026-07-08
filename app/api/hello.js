// Sinal de ATIVACAO "conta nova": o app chama este endpoint uma vez, no primeiro
// login (guardado por flag no navegador). So adiciona a pessoa na lista de
// boas-vindas do Brevo se a CONTA foi criada ha pouco (created_at recente), pra
// nao mandar boas-vindas retroativa pra usuario antigo que so logou de novo.
// INERTE se BREVO_API_KEY / BREVO_LIST_WELCOME nao estiverem setados.

import { brevoUpsert, brevoToday, brevoListWelcome } from './_brevo.js';

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', (function (o) {
    return (['https://app.myliplop.com', 'https://myliplop.com', 'https://www.myliplop.com'].includes(o)
      || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o)) ? o : 'https://app.myliplop.com';
  })(origin || ''));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

// conta e' "nova" se foi criada nas ultimas 48h
const NEW_WINDOW_MS = 48 * 60 * 60 * 1000;
function isNewAccount(user) {
  const created = user && (user.created_at || user.createdAt);
  if (!created) return false;
  const t = Date.parse(created);
  if (isNaN(t)) return false;
  return (Date.now() - t) < NEW_WINDOW_MS;
}

export default async function handler(req, res) {
  cors(res, req.headers.origin || '');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = await getUser(token);
  if (!user || !user.email) { res.status(401).json({ error: 'Não autenticado' }); return; }

  if (isNewAccount(user)) {
    // conta nova => lista de boas-vindas (dispara a automacao de onboarding)
    await brevoUpsert(user.email, { LAST_ACTIVE: brevoToday() }, brevoListWelcome());
    res.status(200).json({ ok: true, welcomed: true });
    return;
  }
  // conta antiga logando de novo: so atualiza o LAST_ACTIVE, sem boas-vindas
  await brevoUpsert(user.email, { LAST_ACTIVE: brevoToday() }, []);
  res.status(200).json({ ok: true, welcomed: false });
}
