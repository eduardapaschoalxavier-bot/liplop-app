// Retorna os dados de assinatura do usuário logado (somente leitura). Usado pela
// tela "Minha assinatura" no app. Primeiro tenta o stripe_customer_id amarrado
// pelo webhook (tabela subscriptions), então funciona mesmo quando o e-mail do
// pagamento é diferente do e-mail do login. Cai no lookup por e-mail se precisar,
// e se o Stripe não devolver nada usa a própria linha da tabela como fallback
// (cobre acessos liberados manualmente por SQL, sem cliente Stripe).
// Env: STRIPE_SECRET_KEY + SUPABASE_URL/ANON_KEY (token) + SUPABASE_SERVICE_ROLE_KEY.

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

// Lê a linha de assinatura do usuário na tabela subscriptions (service role).
async function getSubRow(userId) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!userId || !key) return null;
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/subscriptions?user_id=eq.' + encodeURIComponent(userId) + '&select=*&limit=1', {
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (Array.isArray(d) && d[0]) || null;
  } catch (e) { return null; }
}

// Monta a "view" de assinatura a partir da linha da tabela (quando não há dado no Stripe).
function dbSubToView(row) {
  if (!row) return null;
  return {
    status: row.status || 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: row.current_period_end ? Math.floor(new Date(row.current_period_end).getTime() / 1000) : null,
    amount: null,
    currency: null,
    interval: null,
    intervalCount: null,
    nickname: { semestral: 'Semestral (6 meses)', onetime: 'Acesso avulso', month: 'Mensal', year: 'Anual', mensal: 'Mensal', anual: 'Anual' }[row.plan] || (row.plan || 'Plano ativo')
  };
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
    // linha da tabela (webhook ou grant manual); traz o stripe_customer_id se houver
    const dbRow = await getSubRow(user.id);
    const dbActive = !!(dbRow && ['active', 'trialing', 'grant', 'granted'].includes((dbRow.status || 'active')));

    // 1) cliente amarrado pelo webhook; 2) fallback por e-mail
    let customer = null;
    if (dbRow && dbRow.stripe_customer_id) {
      const cr = await fetch('https://api.stripe.com/v1/customers/' + encodeURIComponent(dbRow.stripe_customer_id), { headers: sh });
      if (cr.ok) customer = await cr.json();
    }
    if (!customer) {
      const cr = await fetch('https://api.stripe.com/v1/customers?limit=1&email=' + encodeURIComponent(user.email), { headers: sh });
      const cd = await cr.json();
      if (!cr.ok) return res.status(400).json({ error: (cd.error && cd.error.message) || 'Erro Stripe' });
      customer = cd.data && cd.data[0];
    }

    // sem cliente Stripe e sem linha ativa na tabela → não tem assinatura
    if (!customer && !dbActive) return res.status(200).json({ hasCustomer: false, email: user.email });

    let subscription = null, card = null;
    if (customer) {
      const qs = new URLSearchParams();
      qs.append('customer', customer.id);
      qs.append('status', 'all');
      qs.append('limit', '1');
      qs.append('expand[]', 'data.items.data.price');
      qs.append('expand[]', 'data.default_payment_method');
      const sr = await fetch('https://api.stripe.com/v1/subscriptions?' + qs.toString(), { headers: sh });
      const sd = await sr.json();
      const sub = sd && sd.data && sd.data[0];
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
    }

    // fallback: Stripe não devolveu assinatura, mas a tabela diz que tem acesso
    if (!subscription && dbActive) subscription = dbSubToView(dbRow);

    return res.status(200).json({
      hasCustomer: true,
      name: (customer && customer.name) || null,
      email: (customer && customer.email) || user.email,
      subscription: subscription,
      card: card
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
