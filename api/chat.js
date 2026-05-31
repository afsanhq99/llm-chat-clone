const model = process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b:free'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  try {
    const apiKey = process.env.OPENROUTER_API_KEY
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : []

    if (!apiKey) {
      res.status(500).json({ error: 'Missing OPENROUTER_API_KEY.' })
      return
    }

    const conversation = messages
      .filter((message) => message?.content?.trim())
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      }))

    if (conversation.length === 0) {
      res.status(400).json({ error: 'Send at least one message.' })
      return
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5174',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'LLM Chat Clone',
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.35,
        top_p: 0.85,
        messages: [
          {
            role: 'system',
            content:
              'You are a precise ChatGPT-style assistant. Give clear, practical answers. For code, provide correct runnable examples, explain tradeoffs briefly, and use fenced code blocks with language names. For math, show definitions, formulas, and step-by-step reasoning using LaTeX when helpful. Ask a clarifying question only when needed.',
          },
          ...conversation,
        ],
      }),
    })

    if (!response.ok) {
      const data = await response.json()
      res.status(response.status).json({
        error: data?.error?.message || 'OpenRouter request failed.',
      })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const decoder = new TextDecoder()
    let buffer = ''

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''

      for (const event of events) {
        const dataLine = event
          .split('\n')
          .find((line) => line.startsWith('data: '))

        if (!dataLine) continue

        const payload = dataLine.slice(6)

        if (payload === '[DONE]') continue

        const data = JSON.parse(payload)
        const delta = data?.choices?.[0]?.delta || {}
        const reasoningDetails = Array.isArray(delta.reasoning_details)
          ? delta.reasoning_details
              .map((detail) => detail?.text || detail?.summary || '')
              .join('')
          : ''
        const text = delta.content || delta.reasoning || delta.reasoning_content || reasoningDetails || ''

        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`)
        }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Unexpected server error.' })
      return
    }
    res.write(`data: ${JSON.stringify({ error: error.message || 'Unexpected server error.' })}\n\n`)
    res.end()
  }
}
