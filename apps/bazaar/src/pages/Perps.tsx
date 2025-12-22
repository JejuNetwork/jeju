/**
 * Perpetuals Page
 */

export default function PerpsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          📈 Perpetuals
        </h1>
        <p
          className="text-sm sm:text-base"
          style={{ color: 'var(--text-secondary)' }}
        >
          Trade perpetual futures with up to 50x leverage
        </p>
      </div>

      <div className="card p-6 text-center">
        <div className="text-5xl mb-4">📈</div>
        <h3
          className="text-lg font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Perps Coming Soon
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Perpetual futures trading will be available shortly
        </p>
      </div>
    </div>
  )
}
