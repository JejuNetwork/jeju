'use client'

import Link from 'next/link'
import { formatEther } from 'viem'
import {
  NetworkPresaleCard,
  NetworkTokenomics,
  NetworkUtility,
} from '@/components/ico'
import { JEJU_TOKENOMICS } from '@/config/jeju-tokenomics'

export default function JejuICOPage() {
  // Calculate price in USD (assuming ~$3000/ETH for display)
  const priceInEth = Number(formatEther(JEJU_TOKENOMICS.presale.tokenPrice))
  const estimatedUsdPrice = (priceInEth * 3000).toFixed(4)

  return (
    <div className="max-w-6xl mx-auto">
      {/* Hero */}
      <section className="text-center py-12">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm mb-6"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span className="w-2 h-2 rounded-full bg-bazaar-primary animate-pulse" />
          Token Presale
        </div>

        <h1
          className="text-4xl md:text-5xl font-bold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          <span className="text-bazaar-primary">{JEJU_TOKENOMICS.name}</span>{' '}
          Token
        </h1>

        <p
          className="text-lg max-w-2xl mx-auto mb-8"
          style={{ color: 'var(--text-secondary)' }}
        >
          Governance and utility token for the Network. Stake in moderation,
          vote on proposals, and power the ecosystem.
        </p>

        <div className="flex flex-wrap justify-center gap-4 mb-8">
          <FeatureBadge emoji="🗳️" text="Governance" />
          <FeatureBadge emoji="🛡️" text="Moderation Staking" />
          <FeatureBadge emoji="💻" text="Network Utility" />
        </div>

        <div
          className="flex flex-wrap justify-center gap-6 text-sm"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <Stat
            label="Max Supply"
            value={`${(Number(JEJU_TOKENOMICS.maxSupply) / 1e27).toFixed(0)}B ${JEJU_TOKENOMICS.symbol}`}
          />
          <Stat
            label="Presale Allocation"
            value={`${JEJU_TOKENOMICS.allocation.presale.percent}%`}
          />
          <Stat label="Initial Price" value={`~$${estimatedUsdPrice}`} />
        </div>
      </section>

      {/* Main Content */}
      <div className="grid lg:grid-cols-2 gap-8 py-8">
        <NetworkPresaleCard />
        <div className="space-y-6">
          <NetworkUtility />

          {/* Timeline */}
          <div className="card p-6">
            <h3
              className="text-lg font-semibold mb-4"
              style={{ color: 'var(--text-primary)' }}
            >
              Timeline
            </h3>
            <div className="space-y-4">
              <TimelineItem
                status="complete"
                title="Infrastructure"
                description="Network L2, contracts, platform"
              />
              <TimelineItem
                status="active"
                title="Presale"
                description="Public token sale"
              />
              <TimelineItem
                status="upcoming"
                title="TGE"
                description="Token distribution and trading"
              />
              <TimelineItem
                status="upcoming"
                title="Governance"
                description="Agent Council activation"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tokenomics */}
      <NetworkTokenomics />

      {/* Links */}
      <div className="flex flex-wrap justify-center gap-4 py-12">
        <Link
          href="/coins/jeju-ico/whitepaper"
          className="btn-secondary px-6 py-3"
        >
          📄 Whitepaper
        </Link>
        <a
          href="https://github.com/elizaos/jeju"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary px-6 py-3"
        >
          💻 GitHub
        </a>
        <a
          href="https://docs.jejunetwork.org"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary px-6 py-3"
        >
          📚 Documentation
        </a>
      </div>
    </div>
  )
}

function FeatureBadge({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 rounded-lg"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
      }}
    >
      <span>{emoji}</span>
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
        {text}
      </span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-xs">{label}</div>
    </div>
  )
}

function TimelineItem({
  status,
  title,
  description,
}: {
  status: 'complete' | 'active' | 'upcoming'
  title: string
  description: string
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className={`w-3 h-3 rounded-full ${
            status === 'complete'
              ? 'bg-green-500'
              : status === 'active'
                ? 'bg-bazaar-primary animate-pulse'
                : 'bg-[var(--bg-tertiary)]'
          }`}
        />
        <div
          className="flex-1 w-0.5 mt-1"
          style={{ backgroundColor: 'var(--border-primary)' }}
        />
      </div>
      <div className="pb-4">
        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </div>
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          {description}
        </div>
      </div>
    </div>
  )
}
