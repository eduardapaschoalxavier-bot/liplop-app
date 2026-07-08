export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', (function(o){return (['https://app.myliplop.com','https://myliplop.com','https://www.myliplop.com'].includes(o)||/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o))?o:'https://app.myliplop.com';})(req.headers.origin||''));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Nome e email obrigatórios' });

  const timestamp = new Date().toISOString();

  // ── Notion ──────────────────────────────────────────────────────────────
  if (process.env.NOTION_TOKEN && process.env.NOTION_DATABASE_ID) {
    try {
      await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({
          parent: { database_id: process.env.NOTION_DATABASE_ID },
          properties: {
            Nome:  { title: [{ text: { content: name } }] },
            Email: { email: email },
            Data:  { date: { start: timestamp } },
            Status: { select: { name: 'Aguardando' } },
          },
        }),
      });
    } catch (e) {
      console.error('Notion error:', e);
    }
  }

  // ── Webhook genérico (Make / Zapier / n8n) ───────────────────────────────
  if (process.env.LEADS_WEBHOOK_URL) {
    try {
      await fetch(process.env.LEADS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, timestamp }),
      });
    } catch (e) {
      console.error('Webhook error:', e);
    }
  }

  return res.status(200).json({ ok: true });
}
