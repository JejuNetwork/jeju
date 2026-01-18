import { Brain, Check, Copy, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '../../context/AppContext'
import { useInference } from '../../hooks'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// Current models per network rules
const MODELS = [
  { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'OpenAI' },
  { id: 'gpt-5.2-mini', name: 'GPT-5.2 Mini', provider: 'OpenAI' },
  { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', provider: 'Anthropic' },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'Anthropic' },
  { id: 'gemini3', name: 'Gemini 3', provider: 'Google' },
  {
    id: 'llama-4-maverick-17b-128e-instruct',
    name: 'Llama 4 Maverick',
    provider: 'Meta',
  },
  {
    id: 'llama-4-scout-17b-16e-instruct',
    name: 'Llama 4 Scout',
    provider: 'Meta',
  },
]

export default function InferencePage() {
  const inference = useInference()
  const { showError, showSuccess } = useToast()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState('gpt-5.2')
  const [copied, setCopied] = useState<number | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    const userMessage: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')

    try {
      const result = await inference.mutateAsync({
        model,
        messages: newMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      })

      const choice = result.choices[0]
      if (choice.message.content) {
        setMessages([
          ...newMessages,
          { role: 'assistant', content: choice.message.content },
        ])
      }
    } catch (error) {
      showError(
        'Inference failed',
        error instanceof Error ? error.message : 'Failed to get response',
      )
      // Remove the user message on error
      setMessages(messages)
    }
  }

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text)
    setCopied(index)
    showSuccess('Copied', 'Message copied to clipboard')
    setTimeout(() => setCopied(null), 2000)
  }

  const handleClear = () => {
    setMessages([])
  }

  const selectedModel = MODELS.find((m) => m.id === model)

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
            Chat with state-of-the-art AI models via OpenAI-compatible API
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{ width: 'auto', minWidth: '200px' }}
          >
            <optgroup label="OpenAI">
              {MODELS.filter((m) => m.provider === 'OpenAI').map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Anthropic">
              {MODELS.filter((m) => m.provider === 'Anthropic').map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Google">
              {MODELS.filter((m) => m.provider === 'Google').map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Meta">
              {MODELS.filter((m) => m.provider === 'Meta').map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            type="button"
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
          height: 'calc(100vh - 320px)',
          minHeight: '400px',
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
              <p>
                Using {selectedModel?.name} ({selectedModel?.provider})
              </p>
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
                  'Write a TypeScript function',
                  'What is blockchain?',
                  'Help me debug code',
                ].map((prompt) => (
                  <button
                    type="button"
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
                key={`${message.role}-${i}`}
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
                      type="button"
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <div className="spinner" style={{ width: 20, height: 20 }} />
                <span
                  style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}
                >
                  Thinking...
                </span>
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
