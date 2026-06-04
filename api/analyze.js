export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { prompt, json_mode = true } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt ausente' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Chave da API não configurada no servidor' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model:      'gpt-4o',
        max_tokens: 2048,
        messages:   [{ role: 'user', content: prompt }],
        ...(json_mode ? { response_format: { type: 'json_object' } } : {})
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'Erro na API OpenAI'
      });
    }

    const text = data.choices[0].message.content.trim();
    return res.status(200).json({ result: text });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
