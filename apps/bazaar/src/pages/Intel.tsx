/**
 * Intel Page - AI-powered market analysis
 */

export default function IntelPage() {
  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          🔮 Intel
        </h1>
        <p
          className="text-sm sm:text-base"
          style={{ color: 'var(--text-secondary)' }}
        >
          AI-powered market intelligence and analysis
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3
            className="font-semibold mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            🤖 Market Sentiment
          </h3>
          <div className="text-3xl font-bold text-green-400 mb-2">Bullish</div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Based on on-chain activity and social signals
          </p>
        </div>

        <div className="card p-5">
          <h3
            className="font-semibold mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            📈 Trending Tokens
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-primary)' }}>JEJU</span>
              <span className="text-green-400">+15.5%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-primary)' }}>ETH</span>
              <span className="text-green-400">+2.5%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
