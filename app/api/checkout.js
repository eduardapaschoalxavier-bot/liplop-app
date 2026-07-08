// Cria uma sessão de Checkout da Stripe (assinatura) amarrada ao usuário logado.
// Env: STRIPE_SECRET_KEY, STRIPE_PRICE_MENSAL, STRIPE_PRICE_SEMESTRAL,
//      SUPABASE_URL/ANON_KEY (pra validar o token).

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

  const plan = (req.body && req.body.plan) || 'mensal';
  const price = plan === 'semestral' ? process.env.STRIPE_PRICE_SEMESTRAL : process.env.STRIPE_PRICE_MENSAL;
  if (!price) return res.status(500).json({ error: 'Plano não configurado no servidor' });

  const origin = req.headers.origin || ('https://' + req.headers.host);
  try {
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', price);
    params.append('line_items[0][quantity]', '1');
    params.append('customer_email', user.email);
    params.append('client_reference_id', user.id);
    params.append('success_url', origin + '/?assinatura=ok');
    params.append('cancel_url', origin + '/?assinatura=cancel');
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const d = await r.json();
    if (!r.ok) return res.status(400).json({ error: (d.error && d.error.message) || 'Erro Stripe' });
    return res.status(200).json({ url: d.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
