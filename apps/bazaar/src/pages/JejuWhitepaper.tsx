/**
 * JEJU Whitepaper Page
 */

import { Link } from 'react-router-dom'

export default function JejuWhitepaperPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <Link
        to="/coins/jeju-ico"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to ICO
      </Link>

      <h1
        className="text-3xl md:text-4xl font-bold mb-6"
        style={{ color: 'var(--text-primary)' }}
      >
        🏝️ JEJU Token Whitepaper
      </h1>

      <div className="card p-6 prose max-w-none">
        <h2 style={{ color: 'var(--text-primary)' }}>Abstract</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          JEJU is the governance and utility token for the Jeju Network
          ecosystem. It enables decentralized governance, staking, and access to
          premium features.
        </p>

        <h2 style={{ color: 'var(--text-primary)' }}>Tokenomics</h2>
        <ul style={{ color: 'var(--text-secondary)' }}>
          <li>Total Supply: 100,000,000 JEJU</li>
          <li>ICO Allocation: 30%</li>
          <li>Team & Advisors: 15% (4-year vesting)</li>
          <li>Ecosystem Development: 25%</li>
          <li>Community Rewards: 20%</li>
          <li>Treasury: 10%</li>
        </ul>

        <h2 style={{ color: 'var(--text-primary)' }}>Utility</h2>
        <ul style={{ color: 'var(--text-secondary)' }}>
          <li>Governance voting</li>
          <li>Staking rewards</li>
          <li>Fee discounts</li>
          <li>Premium features access</li>
        </ul>
      </div>
    </div>
  )
}
