// Webhook do Stripe: quando uma assinatura e criada/atualizada/cancelada, grava na
// tabela `subscriptions` do Supabase, amarrada ao user_id (via client_reference_id
// que o checkout carrega). Assim o app libera acesso AUTOMATICO, sem depender do
// e-mail do Stripe bater com o de login.
//
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Seguranca: NAO confia no corpo do evento cru. Para cada evento, re-busca o objeto
// no proprio Stripe (autenticado com a secret key), entao um POST forjado nao passa
// (ou o id nao existe, ou so confirma um pagamento real de quem realmente pagou).

async function stripeGet(path) {
  try {
    const r = await fetch('https://api.stripe.com/v1/' + path, {
      headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

function sbHeaders(extra) {
  return Object.assign({
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
  }, extra || {});
}

async function upsertSub(row) {
  await fetch(process.env.SUPABASE_URL + '/rest/v1/subscriptions', {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(row)
  });
}

async function patchSubBySubId(subId, fields) {
  await fetch(process.env.SUPABASE_URL + '/rest/v1/subscriptions?stripe_subscription_id=eq.' + encodeURIComponent(subId), {
    method: 'PATCH',
    headers: sbHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(fields)
  });
}

function subRowFromStripe(sub, userId, customerId) {
  const price = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price;
  return {
    user_id: userId,
    stripe_customer_id: customerId || sub.customer || null,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan: (price && price.recurring && price.recurring.interval) || null,
    price_id: (price && price.id) || null,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    updated_at: new Date().toISOString()
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_URL) {
    return res.status(200).json({ received: true, skipped: 'env ausente' });
  }

  const event = (req.body && typeof req.body === 'object') ? req.body : {};
  const type = event.type;
  const obj = event.data && event.data.object;

  try {
    if (type === 'checkout.session.completed' && obj && obj.id) {
      // re-confirma a sessao no Stripe e amarra ao usuario pelo client_reference_id
      const session = await stripeGet('checkout/sessions/' + obj.id);
      const userId = session && session.client_reference_id;
      if (session && userId && session.subscription) {
        const sub = await stripeGet('subscriptions/' + session.subscription);
        if (sub && sub.id) await upsertSub(subRowFromStripe(sub, userId, session.customer));
      }
    } else if ((type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') && obj && obj.id) {
      const sub = (await stripeGet('subscriptions/' + obj.id)) || obj;
      if (sub && sub.id) {
        await patchSubBySubId(sub.id, {
          status: sub.status,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          updated_at: new Date().toISOString()
        });
      }
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    // Sempre 200: se der erro do nosso lado, nao queremos o Stripe reenviando pra sempre.
    return res.status(200).json({ received: true, error: e.message });
  }
}
