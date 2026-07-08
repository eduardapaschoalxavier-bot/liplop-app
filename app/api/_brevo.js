// Integracao Brevo (ativacao). INERTE se BREVO_API_KEY nao estiver setada.
// Usa a Contacts API (api-key padrao) pra upsert de contato + atributos + entrada
// em lista. As automacoes do Brevo disparam por ENTRADA EM LISTA (gatilho confiavel
// com a chave padrao) e usam o atributo LAST_ACTIVE pra saber se a pessoa voltou.
//
// Env: BREVO_API_KEY (segredo), BREVO_LIST_PAYWALL e BREVO_LIST_RESUME (ids das
// listas, numeros, nao-segredo).

export async function brevoUpsert(email, attributes, listIds) {
  if (!process.env.BREVO_API_KEY || !email) return;
  try {
    const body = { email: String(email).toLowerCase(), updateEnabled: true };
    if (attributes && Object.keys(attributes).length) body.attributes = attributes;
    const ids = (listIds || []).map(Number).filter(Boolean);
    if (ids.length) body.listIds = ids;
    await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000)   // nao deixa um Brevo lento travar a resposta da IA
    });
  } catch (e) { /* nunca quebra o fluxo principal */ }
}

// Data de hoje em YYYY-MM-DD (formato de atributo DATE do Brevo).
export function brevoToday() {
  return new Date().toISOString().slice(0, 10);
}

export function brevoListPaywall() {
  return process.env.BREVO_LIST_PAYWALL ? [Number(process.env.BREVO_LIST_PAYWALL)] : [];
}
export function brevoListResume() {
  return process.env.BREVO_LIST_RESUME ? [Number(process.env.BREVO_LIST_RESUME)] : [];
}
