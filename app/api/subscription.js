// Retorna os dados de assinatura do usuário logado (somente leitura), achando
// o cliente Stripe pelo e-mail. Usado pela tela "Minha assinatura" no app.
// Env: STRIPE_SECRET_KEY + SUPABASE_URL/ANON_KEY (pra validar o token).

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

  const sh = { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY };
  try {
    const cr = await fetch('https://api.stripe.com/v1/customers?limit=1&email=' + encodeURIComponent(user.email), { headers: sh });
    const cd = await cr.json();
    if (!cr.ok) return res.status(400).json({ error: (cd.error && cd.error.message) || 'Erro Stripe' });
    const customer = cd.data && cd.data[0];
    if (!customer) return res.status(200).json({ hasCustomer: false, email: user.email });

    const qs = new URLSearchParams();
    qs.append('customer', customer.id);
    qs.append('status', 'all');
    qs.append('limit', '1');
    qs.append('expand[]', 'data.items.data.price');
    qs.append('expand[]', 'data.default_payment_method');
    const sr = await fetch('https://api.stripe.com/v1/subscriptions?' + qs.toString(), { headers: sh });
    const sd = await sr.json();
    const sub = sd && sd.data && sd.data[0];

    let subscription = null, card = null;
    if (sub) {
      const price = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price;
      subscription = {
        status: sub.status,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        currentPeriodEnd: sub.current_period_end,
        amount: price ? price.unit_amount : null,
        currency: price ? price.currency : null,
        interval: price && price.recurring ? price.recurring.interval : null,
        intervalCount: price && price.recurring ? price.recurring.interval_count : null,
        nickname: price ? price.nickname : null
      };
      const pm = sub.default_payment_method;
      if (pm && pm.card) card = { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
    }
    return res.status(200).json({
      hasCustomer: true,
      name: customer.name || null,
      email: customer.email || user.email,
      subscription: subscription,
      card: card
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
