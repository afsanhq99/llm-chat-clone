# LLM Chat Clone

A Vite React ChatGPT-style clone using OpenRouter for streamed replies, Supabase Auth, and Supabase Postgres for per-user chat history.

## Setup

1. Add your OpenRouter and Supabase keys in `.env`:

```env
OPENROUTER_API_KEY=your-openrouter-api-key
OPENROUTER_MODEL=openai/gpt-oss-120b:free
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

2. Run the app:

```bash
npm run dev
```

The client runs on Vite and proxies `/api/chat` to the local Express server.

## Supabase

The `Chatgpt Clone` Supabase project has authenticated, RLS-protected tables:

- `chat_sessions`
- `chat_messages`

Only signed-in users can create, read, update, or delete their own chat sessions. Messages are linked to both the session and the signed-in user.

## Features

- Email/password authentication
- Streaming OpenRouter responses
- Markdown, GitHub-flavored tables, code blocks, syntax highlighting, and LaTeX math rendering
- Chat history stored in Supabase Postgres
- Code/math-oriented system instruction for more structured responses
