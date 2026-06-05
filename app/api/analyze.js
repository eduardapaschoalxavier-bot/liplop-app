export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { prompt, json_mode = true, mode = 'standard', model = 'claude-sonnet-4-5' } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt ausente' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Chave da API não configurada no servidor' });
  }

  try {
    // ── Modo job_search: usa web search tool para buscar vagas reais ──
    if (mode === 'job_search') {
      const messages = [{ role: 'user', content: prompt }];
      let finalText = '';
      let attempts = 0;

      while (attempts < 6) {
        attempts++;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'web-search-2025-03-05'
          },
          body: JSON.stringify({
            model: 'claude-opus-4-5',
            max_tokens: 4096,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            system: 'You are a job search specialist. Use web search to scrape real company career pages (company websites, Gupy, Inhire, etc.) and find real open job listings. Read the actual job pages to confirm they are still open. Avoid LinkedIn individual job URLs as they expire. Always respond with valid JSON only at the end — no markdown, no explanation.',
            messages
          })
        });

        const data = await response.json();

        if (!response.ok) {
          return res.status(response.status).json({ error: data.error?.message || 'Erro na API Anthropic' });
        }

        if (data.stop_reason === 'end_turn') {
          finalText = data.content.find(b => b.type === 'text')?.text?.trim() || '';
          break;
        }

        if (data.stop_reason === 'tool_use') {
          // Adiciona a resposta do assistente com os tool_use blocks
          messages.push({ role: 'assistant', content: data.content });

          // Coleta resultados de todas as tool_use calls
          const toolResults = data.content
            .filter(b => b.type === 'tool_use')
            .map(b => ({
              type: 'tool_result',
              tool_use_id: b.id,
              content: b.content || ''
            }));

          messages.push({ role: 'user', content: toolResults });
        } else {
          // stop_reason inesperado — pega o texto se houver
          finalText = data.content?.find(b => b.type === 'text')?.text?.trim() || '';
          break;
        }
      }

      return res.status(200).json({ result: finalText });
    }

    // ── Modo padrão ──────────────────────────────────────────────────
    const systemPrompt = json_mode
      ? 'You are a helpful assistant. Always respond with valid JSON only, no markdown, no explanation.'
      : 'You are a helpful assistant.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'Erro na API Anthropic'
      });
    }

    const text = data.content[0].text.trim();
    return res.status(200).json({ result: text });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
