// Abre o Customer Portal da Stripe para o usuário logado.
// Localiza o cliente Stripe pelo E-MAIL do usuário, então funciona inclusive
// pra quem pagou pelo Payment Link da landing (sem conta vinculada nem webhook).
//
// Env necessárias: STRIPE_SECRET_KEY (sk_test_... primeiro), e as já existentes
// SUPABASE_URL e SUPABASE_ANON_KEY (pra validar o token do usuário).

async function getUser(token) {
  if (!token) return null;
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: process.env.SUPABASE_ANON_KEY }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', (function(o){return (['https://app.myliplop.com','https://myliplop.com','https://www.myliplop.com'].includes(o)||/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o))?o:'https://app.myliplop.com';})(req.headers.origin||''));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe não configurada no servidor' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await getUser(token);
  if (!user || !user.email) return res.status(401).json({ error: 'Não autenticado' });

  const sk = process.env.STRIPE_SECRET_KEY;
  try {
    // acha o cliente Stripe pelo e-mail do usuário
    const cr = await fetch('https://api.stripe.com/v1/customers?limit=1&email=' + encodeURIComponent(user.email), {
      headers: { Authorization: 'Bearer ' + sk }
    });
    const cd = await cr.json();
    if (!cr.ok) return res.status(400).json({ error: (cd.error && cd.error.message) || 'Erro Stripe' });
    const customer = cd.data && cd.data[0] && cd.data[0].id;
    if (!customer) return res.status(404).json({ error: 'no_customer' });

    const origin = req.headers.origin || ('https://' + req.headers.host);
    const params = new URLSearchParams();
    params.append('customer', customer);
    params.append('return_url', origin);
    const pr = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + sk, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const pd = await pr.json();
    if (!pr.ok) return res.status(400).json({ error: (pd.error && pd.error.message) || 'Erro ao abrir o portal' });
    return res.status(200).json({ url: pd.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
