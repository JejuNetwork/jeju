import { Check, Copy, MessageSquare, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useEmbeddings } from '../../hooks'

interface EmbeddingResult {
  input: string
  embedding: number[]
  model: string
  tokens: number
}

export default function EmbeddingsPage() {
  const embeddings = useEmbeddings()
  const [input, setInput] = useState('')
  const [model, setModel] = useState('text-embedding-3-small')
  const [results, setResults] = useState<EmbeddingResult[]>([])
  const [copied, setCopied] = useState<number | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    try {
      const result = await embeddings.mutateAsync({
        input: input,
        model,
      })

      if (result.data[0]) {
        setResults([
          ...results,
          {
            input: input,
            embedding: result.data[0].embedding,
            model: result.model,
            tokens: result.usage.total_tokens,
          },
        ])
      }
      setInput('')
    } catch (error) {
      // Error is handled by React Query, but we prevent uncaught promise rejection
      console.error('Embedding error:', error)
    }
  }

  const handleCopy = (embedding: number[], index: number) => {
    navigator.clipboard.writeText(JSON.stringify(embedding))
    setCopied(index)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleClear = () => {
    setResults([])
  }

  const cosineSimilarity = (a: number[], b: number[]) => {
    if (a.length !== b.length) return 0
    let dotProduct = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
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
          <h1 className="page-title">Embeddings</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <select
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="text-embedding-3-small">
              text-embedding-3-small
            </option>
            <option value="text-embedding-3-large">
              text-embedding-3-large
            </option>
            <option value="text-embedding-ada-002">
              text-embedding-ada-002
            </option>
          </select>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClear}
            disabled={results.length === 0}
          >
            <Trash2 size={16} /> Clear
          </button>
        </div>
      </div>

      <div className="card">
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}
        >
          <input
            className="input"
            placeholder="Enter text to embed..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={embeddings.isPending}
            style={{ flex: 1 }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!input.trim() || embeddings.isPending}
          >
            {embeddings.isPending ? (
              <div className="spinner" style={{ width: 16, height: 16 }} />
            ) : (
              <Send size={16} />
            )}
            Embed
          </button>
        </form>

        {results.length === 0 ? (
          <div className="empty-state" style={{ padding: '3rem' }}>
            <MessageSquare size={48} />
            <h3>Enter text above</h3>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {results.map((result, i) => (
              <div
                key={`${result.input}-${result.model}-${result.tokens}-${i}`}
                style={{
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '0.75rem',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
                      {result.input}
                    </div>
                    <div
                      style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}
                    >
                      {result.model} · {result.embedding.length} dimensions ·{' '}
                      {result.tokens} tokens
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleCopy(result.embedding, i)}
                  >
                    {copied === i ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  [
                  {result.embedding
                    .slice(0, 8)
                    .map((v) => v.toFixed(6))
                    .join(', ')}
                  , ...]
                </div>

                {i > 0 && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      paddingTop: '0.75rem',
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.5rem',
                      }}
                    >
                      Similarity with previous:
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: '6px',
                          background: 'var(--bg-primary)',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.max(0, cosineSimilarity(result.embedding, results[i - 1].embedding) * 100)}%`,
                            height: '100%',
                            background: 'var(--accent)',
                            borderRadius: '3px',
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.85rem',
                        }}
                      >
                        {(
                          cosineSimilarity(
                            result.embedding,
                            results[i - 1].embedding,
                          ) * 100
                        ).toFixed(1)}
                        %
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <MessageSquare size={18} /> API Usage
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
              POST /compute/embeddings
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
              Use Cases
            </div>
            <span>Semantic Search, Clustering, RAG</span>
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
