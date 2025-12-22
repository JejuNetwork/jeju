import { Brain, Check, Copy, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useInference } from '../../hooks'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function InferencePage() {
  const inference = useInference()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState('gpt-4')
  const [copied, setCopied] = useState<number | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    const userMessage: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')

    const result = await inference.mutateAsync({
      model,
      messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
    })

    if (result.choices[0]?.message?.content) {
      setMessages([
        ...newMessages,
        { role: 'assistant', content: result.choices[0].message.content },
      ])
    }
  }

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text)
    setCopied(index)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleClear = () => {
    setMessages([])
  }

  return (
    <div>
      <div
        className="page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 className="page-title">AI Inference</h1>
          <p className="page-subtitle">
            Chat completions and text generation via decentralized AI nodes
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <select
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="gpt-4">GPT-4</option>
            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            <option value="claude-3-opus">Claude 3 Opus</option>
            <option value="claude-3-sonnet">Claude 3 Sonnet</option>
            <option value="llama-3-70b">Llama 3 70B</option>
            <option value="mixtral-8x7b">Mixtral 8x7B</option>
          </select>
          <button
            className="btn btn-secondary"
            onClick={handleClear}
            disabled={messages.length === 0}
          >
            <Trash2 size={16} /> Clear
          </button>
        </div>
      </div>

      <div
        className="card"
        style={{
          height: 'calc(100vh - 280px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {messages.length === 0 ? (
            <div
              className="empty-state"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              <Brain size={48} />
              <h3>Start a conversation</h3>
              <p>Send a message to interact with the AI model</p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '0.75rem',
                  marginTop: '1rem',
                  maxWidth: '600px',
                }}
              >
                {[
                  'Explain quantum computing',
                  'Write a Python function',
                  'What is blockchain?',
                  'Help me debug code',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    className="btn btn-secondary"
                    onClick={() => setInput(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent:
                    message.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '80%',
                    padding: '1rem',
                    borderRadius: 'var(--radius-lg)',
                    background:
                      message.role === 'user'
                        ? 'var(--accent)'
                        : 'var(--bg-tertiary)',
                    color:
                      message.role === 'user' ? 'white' : 'var(--text-primary)',
                    position: 'relative',
                  }}
                >
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    {message.content}
                  </div>
                  {message.role === 'assistant' && (
                    <button
                      className="btn btn-ghost btn-icon"
                      style={{
                        position: 'absolute',
                        top: '0.5rem',
                        right: '0.5rem',
                        padding: '0.25rem',
                        opacity: 0.6,
                      }}
                      onClick={() => handleCopy(message.content, i)}
                    >
                      {copied === i ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          {inference.isPending && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div
                style={{
                  padding: '1rem',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--bg-tertiary)',
                }}
              >
                <div className="spinner" style={{ width: 20, height: 20 }} />
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            borderTop: '1px solid var(--border)',
            padding: '1rem',
            display: 'flex',
            gap: '0.75rem',
          }}
        >
          <input
            className="input"
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={inference.isPending}
            style={{ flex: 1 }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!input.trim() || inference.isPending}
          >
            <Send size={16} />
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Brain size={18} /> API Usage
          </h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1rem',
          }}
        >
          <div
            style={{
              padding: '1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                marginBottom: '0.25rem',
              }}
            >
              Endpoint
            </div>
            <code style={{ fontSize: '0.85rem' }}>
              POST /compute/chat/completions
            </code>
          </div>
          <div
            style={{
              padding: '1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                marginBottom: '0.25rem',
              }}
            >
              Compatible With
            </div>
            <span>OpenAI SDK, LangChain, LlamaIndex</span>
          </div>
          <div
            style={{
              padding: '1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                marginBottom: '0.25rem',
              }}
            >
              Pricing
            </div>
            <span>x402 micropayments per token</span>
          </div>
        </div>
      </div>
    </div>
  )
}
