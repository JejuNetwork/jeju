/**
 * BBLN ICO Page
 */

export default function BblnICOPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1
        className="text-3xl md:text-4xl font-bold mb-4 text-center"
        style={{ color: 'var(--text-primary)' }}
      >
        🔮 BBLN Token Sale
      </h1>

      <div className="card p-6">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">🔮</div>
          <h2
            className="text-2xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Babylon Token
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Cross-chain bridge and staking token
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Price
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              $0.10
            </p>
          </div>
          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Raised
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              $1.2M
            </p>
          </div>
        </div>

        <button className="btn-primary w-full py-3">Participate in ICO</button>
      </div>
    </div>
  )
}
