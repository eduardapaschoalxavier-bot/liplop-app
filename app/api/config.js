// Serve a config PÚBLICA do Supabase pro front (URL + anon key).
// A anon key é pública por design (o RLS é quem protege). Segredos de servidor
// (service_role, stripe sk_, whsec_) NUNCA passam por aqui.
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', (function(o){return (['https://app.myliplop.com','https://myliplop.com','https://www.myliplop.com'].includes(o)||/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o))?o:'https://app.myliplop.com';})(req.headers.origin||''));
  res.setHeader('Cache-Control', 'no-store');
  // Trava do cutover: o login/portão só é ativado quando LOGIN_ENABLED=1.
  // Sem a flag, o front NÃO recebe as credenciais e o app roda só com cache,
  // mesmo com SUPABASE_URL/ANON_KEY presentes. Assim o merge sobe o walkthrough
  // sem ligar o login; a virada do login vira um passo controlado (setar a flag).
  const loginOn = process.env.LOGIN_ENABLED === '1' || process.env.LOGIN_ENABLED === 'true';
  return res.status(200).json({
    supabaseUrl: loginOn ? (process.env.SUPABASE_URL || null) : null,
    supabaseAnonKey: loginOn ? (process.env.SUPABASE_ANON_KEY || null) : null,
  });
}
