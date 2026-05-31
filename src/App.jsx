import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, LogOut, Menu, MessageSquarePlus, PanelLeftClose, Send, Sparkles, Square, User } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import './App.css'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import { hasSupabaseConfig, supabase } from './lib/supabase'

const welcomeMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Ask me anything. I am powered by OpenRouter GPT OSS and saved to Supabase when your anon key is configured.',
}

const missingSupabaseMessage = hasSupabaseConfig
  ? ''
  : 'Add your Supabase anon key in .env to save chats.'

function isInvalidRefreshToken(error) {
  const message = error?.message?.toLowerCase() || ''
  return message.includes('refresh token') && message.includes('invalid')
}

function countMatches(value, pattern) {
  return value.match(pattern)?.length || 0
}

function renderableMarkdown(content) {
  let markdown = content
    .replaceAll('\\[', '$$')
    .replaceAll('\\]', '$$')
    .replaceAll('\\(', '$')
    .replaceAll('\\)', '$')

  if (countMatches(markdown, /(?<!\\)\$\$/g) % 2 === 1) {
    markdown += '\n$$'
  }

  const withoutBlocks = markdown.replace(/(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$/g, '')
  if (countMatches(withoutBlocks, /(?<!\\)\$(?!\$)/g) % 2 === 1) {
    markdown += '$'
  }

  return markdown
}

function App() {
  const [authMode, setAuthMode] = useState('signin')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [user, setUser] = useState(null)
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [messages, setMessages] = useState([welcomeMessage])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState(missingSupabaseMessage)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const abortControllerRef = useRef(null)

  const activeTitle = useMemo(() => {
    return sessions.find((session) => session.id === activeSessionId)?.title || 'New chat'
  }, [activeSessionId, sessions])

  useEffect(() => {
    if (!hasSupabaseConfig) {
      return
    }

    let isMounted = true

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!isMounted) return

      if (error) {
        if (isInvalidRefreshToken(error)) {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
          if (!isMounted) return
          setUser(null)
          setStatus('Your saved sign-in expired. Please sign in again.')
          return
        }

        setStatus(error.message)
        return
      }

      setUser(data.session?.user || null)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null)
      setSessions([])
      setActiveSessionId(null)
      setMessages([welcomeMessage])
    })

    return () => {
      isMounted = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!hasSupabaseConfig || !user) {
      return
    }

    async function loadSessions() {
      const { data, error } = await supabase
        .from('chat_sessions')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) {
        setStatus(error.message)
        return
      }

      setSessions(data || [])
      if (data?.[0]) {
        setActiveSessionId(data[0].id)
      }
    }

    loadSessions()
  }, [user])

  useEffect(() => {
    if (!hasSupabaseConfig || !activeSessionId || !user) return

    async function loadMessages() {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', activeSessionId)
        .order('created_at', { ascending: true })

      if (error) {
        setStatus(error.message)
        return
      }

      setMessages(data?.length ? data : [welcomeMessage])
    }

    loadMessages()
  }, [activeSessionId, user])

  async function createSession(firstMessage = 'New chat') {
    if (!hasSupabaseConfig || !user) return null

    const title = firstMessage.trim().slice(0, 48) || 'New chat'
    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({ title, user_id: user.id })
      .select()
      .single()

    if (error) {
      setStatus(error.message)
      return null
    }

    setSessions((current) => [data, ...current])
    setActiveSessionId(data.id)
    return data.id
  }

  async function saveMessage(sessionId, message) {
    if (!hasSupabaseConfig || !sessionId || !user) return

    const { error } = await supabase.from('chat_messages').insert({
      session_id: sessionId,
      user_id: user.id,
      role: message.role,
      content: message.content,
    })

    if (error) setStatus(error.message)
  }

  function startNewChat() {
    setActiveSessionId(null)
    setMessages([welcomeMessage])
    setInput('')
    setStatus(missingSupabaseMessage)
  }

  async function handleAuth(event) {
    event.preventDefault()
    if (!hasSupabaseConfig) {
      setStatus('Add your Supabase anon key in .env before signing in.')
      return
    }

    setIsLoading(true)
    setStatus('')

    const authRequest =
      authMode === 'signup'
        ? supabase.auth.signUp({ email: authEmail, password: authPassword })
        : supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })

    const { error } = await authRequest
    if (error) setStatus(error.message)
    else setStatus(authMode === 'signup' ? 'Account created. Check email confirmation if enabled.' : '')
    setIsLoading(false)
  }

  async function signOut() {
    if (!hasSupabaseConfig) return
    await supabase.auth.signOut()
  }

  function stopGeneration() {
    abortControllerRef.current?.abort()
  }

  async function submitMessage(event) {
    event.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    setIsLoading(true)
    setStatus('')

    const sessionId = activeSessionId || (await createSession(text))
    const history = messages.filter((message) => message.id !== 'welcome')
    const userMessage = { id: crypto.randomUUID(), role: 'user', content: text }
    const nextMessages = [...history, userMessage]
    setMessages(nextMessages)
    await saveMessage(sessionId, userMessage)

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    let streamedText = ''
    let assistantMessage = null

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'OpenRouter request failed.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
      }

      setMessages((current) => [...current, assistantMessage])
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const eventText of events) {
          const payload = eventText.replace(/^data: /, '').trim()
          if (!payload || payload === '[DONE]') continue

          const chunk = JSON.parse(payload)
          if (chunk.error) throw new Error(chunk.error)
          streamedText += chunk.text || ''
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: streamedText }
                : message,
            ),
          )
        }
      }

      assistantMessage.content = streamedText || 'I did not receive a text response.'
      await saveMessage(sessionId, assistantMessage)
    } catch (error) {
      if (error.name === 'AbortError') {
        if (assistantMessage && streamedText) {
          assistantMessage.content = streamedText
          await saveMessage(sessionId, assistantMessage)
        }
        setStatus('Generation stopped.')
        return
      }

      setStatus(error.message)
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `I could not get a response from OpenRouter.\n\n**API error:** ${error.message}`,
        },
      ])
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-copy">
          <div className="brand-mark"><Sparkles size={20} /> OpenRouter Chat</div>
          <h1>Private AI chats with streaming code and math answers.</h1>
          <p>Sign in to save your conversations to Supabase Postgres with per-user row security.</p>
        </section>
        <form className="auth-card" onSubmit={handleAuth}>
          <h2>{authMode === 'signin' ? 'Welcome back' : 'Create account'}</h2>
          <label>
            Email
            <input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} type="password" minLength="6" required />
          </label>
          {status && <p className="status auth-status">{status}</p>}
          <button type="submit" disabled={isLoading}>{authMode === 'signin' ? 'Sign in' : 'Sign up'}</button>
          <button className="link-button" type="button" onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}>
            {authMode === 'signin' ? 'Need an account?' : 'Already have an account?'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className={sidebarOpen ? 'app-shell' : 'app-shell collapsed'}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand-mark"><Sparkles size={18} /> OpenRouter Chat</div>
          <button className="icon-button" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
            <PanelLeftClose size={18} />
          </button>
        </div>
        <button className="new-chat" type="button" onClick={startNewChat}>
          <MessageSquarePlus size={18} /> New chat
        </button>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              className={session.id === activeSessionId ? 'session active' : 'session'}
              key={session.id}
              type="button"
              onClick={() => setActiveSessionId(session.id)}
            >
              {session.title}
            </button>
          ))}
        </div>
        <button className="signout" type="button" onClick={signOut}>
          <LogOut size={17} /> Sign out
        </button>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          {!sidebarOpen && (
            <button className="icon-button floating" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
              <Menu size={19} />
            </button>
          )}
          <div>
            <p className="eyebrow">GPT OSS 120B</p>
            <h1>{activeTitle}</h1>
          </div>
          <span className={hasSupabaseConfig ? 'pill ready' : 'pill'}>
            {hasSupabaseConfig ? 'Supabase connected' : 'Local chat'}
          </span>
        </header>

        <div className="messages" aria-live="polite">
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="avatar">{message.role === 'assistant' ? <Bot size={19} /> : <User size={18} />}</div>
              <div className="message-content">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeHighlight, [rehypeKatex, { throwOnError: false, strict: false }]]}
                >
                  {renderableMarkdown(message.content)}
                </ReactMarkdown>
              </div>
            </article>
          ))}
        </div>

        {status && <p className="status">{status}</p>}

        <form className="composer" onSubmit={submitMessage}>
          <textarea
            aria-label="Message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) submitMessage(event)
            }}
            placeholder="Message OpenRouter..."
            rows="1"
          />
          {isLoading ? (
            <button className="stop-button" type="button" onClick={stopGeneration} aria-label="Stop generation" title="Stop generation">
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} aria-label="Send message" title="Send message">
              <Send size={18} />
            </button>
          )}
        </form>
      </section>
    </main>
  )
}

export default App
