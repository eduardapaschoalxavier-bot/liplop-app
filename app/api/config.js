// Serve a config PÚBLICA do Supabase pro front (URL + anon key).
// A anon key é pública por design (o RLS é quem protege). Segredos de servidor
// (service_role, stripe sk_, whsec_) NUNCA passam por aqui.
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
  });
}
