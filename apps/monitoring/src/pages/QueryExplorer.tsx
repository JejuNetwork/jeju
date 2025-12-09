import { useState } from 'react'
import { Play, Clock, Copy, Check } from 'lucide-react'
import { useMetricsQuery } from '../hooks/useMonitoring'

const examples = [
  { label: 'HTTP Rate', query: 'rate(http_requests_total[5m])' },
  { label: 'CPU', query: '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' },
  { label: 'Memory', query: 'node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes' },
  { label: 'Up', query: 'up' },
  { label: 'Scrape Duration', query: 'scrape_duration_seconds' },
  { label: 'Block Height', query: 'ethereum_block_number' },
]

export function QueryExplorer() {
  const [query, setQuery] = useState('up')
  const [executedQuery, setExecutedQuery] = useState('up')
  const { data, loading, error } = useMetricsQuery(executedQuery)
  const [copied, setCopied] = useState(false)

  const handleExecute = () => {
    if (query.trim()) setExecutedQuery(query.trim())
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(query)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-2xl md:text-3xl font-bold text-gradient">Query</h1>

      {/* Input */}
      <div className="card-static p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleExecute()}
              placeholder="PromQL..."
              className="input font-mono pr-12"
            />
            <button
              onClick={handleCopy}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]"
            >
              {copied ? (
                <Check className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
              ) : (
                <Copy className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
              )}
            </button>
          </div>
          
          <button
            onClick={handleExecute}
            disabled={loading || !query.trim()}
            className="btn-primary flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4" />
            Run
          </button>
        </div>
      </div>

      {/* Examples */}
      <div className="flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button
            key={ex.query}
            onClick={() => { setQuery(ex.query); setExecutedQuery(ex.query) }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:scale-105"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="card-static p-4">
        <div className="flex items-center justify-between mb-4">
          <span className="font-bold" style={{ color: 'var(--text-primary)' }}>Results</span>
          {data && <span className="badge-info">{data.length}</span>}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="shimmer h-12 rounded-lg" />)}
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl text-center" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <p className="font-mono text-sm" style={{ color: 'var(--color-error)' }}>{error}</p>
          </div>
        ) : !data || data.length === 0 ? (
          <div className="p-6 text-center">
            <p style={{ color: 'var(--text-tertiary)' }}>No data</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {data.map((result, i) => (
              <ResultRow key={i} result={result} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface MetricResult {
  metric: Record<string, string>
  value: [number, string]
}

function ResultRow({ result }: { result: MetricResult }) {
  const labels = Object.entries(result.metric).filter(([key]) => key !== '__name__')
  const metricName = result.metric.__name__ || 'value'
  const [timestamp, value] = result.value

  return (
    <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-bold font-mono" style={{ color: 'var(--color-primary)' }}>{metricName}</span>
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {parseFloat(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </span>
      </div>
      
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {labels.map(([key, val]) => (
            <span key={key} className="px-2 py-1 rounded text-xs font-mono" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              {key}={val}
            </span>
          ))}
        </div>
      )}
      
      <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <Clock className="w-3 h-3" />
        {new Date(timestamp * 1000).toLocaleString()}
      </div>
    </div>
  )
}
