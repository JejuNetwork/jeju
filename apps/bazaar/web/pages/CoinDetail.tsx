import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import type { Address } from 'viem'
import { formatUnits } from 'viem'
import { fetchTokenDetails } from '../../lib/data-client'
import { ChannelFeed } from '../components/ChannelFeed'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { getCoinChannel } from '../hooks/useMessaging'

function formatNumber(num: number | bigint): string {
  const n = typeof num === 'bigint' ? Number(num) : num
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

export default function CoinDetailPage() {
  const { chainId, address } = useParams<{ chainId: string; address: string }>()

  const { data: token, isLoading, error } = useQuery({
    queryKey: ['token-details', address],
    queryFn: () => fetchTokenDetails(address as Address),
    enabled: Boolean(address),
    staleTime: 30000,
  })

  if (!chainId || !address) {
    return (
      <div className="text-center py-12">
        <p style={{ color: 'var(--text-secondary)' }}>Invalid token URL</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (error || !token) {
    return (
      <div className="max-w-4xl mx-auto">
        <Link to="/coins" className="text-sm mb-4 inline-block" style={{ color: 'var(--text-secondary)' }}>
          ← Back to Coins
        </Link>
        <div className="card p-6 border-red-500/30 bg-red-500/10">
          <p className="text-red-400">Failed to load token details</p>
        </div>
      </div>
    )
  }

  const chainIdNum = parseInt(chainId, 10)
  const channel = getCoinChannel(chainIdNum, address as Address, token.name)

  const initials = token.symbol.slice(0, 2).toUpperCase()
  const supplyFormatted = formatNumber(Number(formatUnits(token.totalSupply, token.decimals)))

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/coins" className="text-sm mb-4 inline-block" style={{ color: 'var(--text-secondary)' }}>
        ← Back to Coins
      </Link>

      <div className="card p-6">
        <div className="flex items-center gap-4 mb-6">
          {token.logoUrl ? (
            <img src={token.logoUrl} alt="" className="w-16 h-16 rounded-2xl" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-2xl font-bold text-white">
              {initials}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {token.name}
              </h1>
              {token.verified && <span className="text-blue-400 text-sm" title="Verified">✓</span>}
            </div>
            <p className="text-sm font-mono" style={{ color: 'var(--text-tertiary)' }}>
              ${token.symbol} • {address.slice(0, 10)}...{address.slice(-8)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Supply</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{supplyFormatted}</p>
          </div>
          <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Price</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {token.priceUSD ? `$${token.priceUSD.toFixed(6)}` : '—'}
            </p>
          </div>
          <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>24h Volume</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {token.volumeUSD24h ? `$${formatNumber(token.volumeUSD24h)}` : '—'}
            </p>
          </div>
          <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Holders</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {token.holders?.toLocaleString() ?? '—'}
            </p>
          </div>
        </div>
      </div>

      <ChannelFeed channel={channel} />
    </div>
  )
}
