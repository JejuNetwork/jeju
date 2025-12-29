import { Link } from 'react-router-dom'
import { InfoCard } from '../components/ui'

export default function JejuICOPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1
        className="text-3xl md:text-4xl font-bold mb-4 text-center"
        style={{ color: 'var(--text-primary)' }}
      >
        🏝️ JEJU Token
      </h1>

      <div className="card p-6 mb-6">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">🏝️</div>
          <h2
            className="text-2xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            JEJU Token
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Governance and utility token for the Jeju Network
          </p>
        </div>

        <InfoCard variant="info" className="mb-6">
          <p className="font-medium">Token Sale Coming Soon</p>
          <p className="text-sm opacity-80">
            The JEJU token sale has not yet started. Check back later or read
            the whitepaper for more details.
          </p>
        </InfoCard>

        <Link
          to="/coins/jeju-ico/whitepaper"
          className="btn-primary w-full py-3 text-center block"
        >
          Read Whitepaper
        </Link>
      </div>
    </div>
  )
}
