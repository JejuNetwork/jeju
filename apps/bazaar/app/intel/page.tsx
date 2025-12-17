'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

// Supported chains for cross-chain intel
const CHAINS = [
  { id: 1, name: 'Ethereum', icon: '⟠', color: '#627EEA' },
  { id: 8453, name: 'Base', icon: '🔵', color: '#0052FF' },
  { id: 42161, name: 'Arbitrum', icon: '🔷', color: '#28A0F0' },
  { id: 10, name: 'Optimism', icon: '🔴', color: '#FF0420' },
  { id: 56, name: 'BSC', icon: '🟡', color: '#F0B90B' },
]

interface MarketAlert {
  id: string
  type: 'price' | 'volume' | 'whale' | 'liquidation' | 'funding' | 'opportunity'
  severity: 'info' | 'warning' | 'critical'
  title: string
  description: string
  chain: number
  token?: string
  timestamp: number
  data?: Record<string, unknown>
}

interface CrossChainPrice {
  token: string
  prices: Record<number, number>
  spread: number
  arbitrageOpportunity: boolean
}

interface WhaleActivity {
  address: string
  chain: number
  action: 'buy' | 'sell' | 'transfer'
  token: string
  amount: string
  value: string
  timestamp: number
}

const IS_DEMO_MODE = true

function generateSampleAlerts(): MarketAlert[] {
  return [
    {
      id: '1',
      type: 'whale',
      severity: 'warning',
      title: 'Large ETH Movement',
      description: 'Whale moved 5,000 ETH from Binance to unknown wallet',
      chain: 1,
      token: 'ETH',
      timestamp: Date.now() - 120000,
    },
    {
      id: '2',
      type: 'opportunity',
      severity: 'info',
      title: 'Arbitrage Opportunity',
      description: 'WBTC price spread 0.3% between Base and Arbitrum',
      chain: 8453,
      token: 'WBTC',
      timestamp: Date.now() - 300000,
      data: { spread: 0.3, basePrice: 97500, arbPrice: 97207 },
    },
    {
      id: '3',
      type: 'liquidation',
      severity: 'critical',
      title: 'Large Liquidation',
      description: '$2.5M BTC long liquidated on Hyperliquid',
      chain: 42161,
      token: 'BTC',
      timestamp: Date.now() - 600000,
    },
    {
      id: '4',
      type: 'funding',
      severity: 'info',
      title: 'High Funding Rate',
      description: 'ETH perp funding at 0.1% - shorts getting paid',
      chain: 10,
      token: 'ETH',
      timestamp: Date.now() - 900000,
    },
    {
      id: '5',
      type: 'volume',
      severity: 'warning',
      title: 'Volume Spike',
      description: 'ARB trading volume up 340% in last hour',
      chain: 42161,
      token: 'ARB',
      timestamp: Date.now() - 1800000,
    },
  ]
}

function generateSampleCrossChainPrices(): CrossChainPrice[] {
  return [
    {
      token: 'ETH',
      prices: { 1: 3450.00, 8453: 3448.50, 42161: 3451.20, 10: 3449.80, 56: 3445.00 },
      spread: 0.18,
      arbitrageOpportunity: false,
    },
    {
      token: 'WBTC',
      prices: { 1: 97500, 8453: 97500, 42161: 97207, 10: 97450, 56: 97100 },
      spread: 0.41,
      arbitrageOpportunity: true,
    },
    {
      token: 'USDC',
      prices: { 1: 1.0001, 8453: 1.0000, 42161: 0.9999, 10: 1.0000, 56: 0.9998 },
      spread: 0.03,
      arbitrageOpportunity: false,
    },
    {
      token: 'ARB',
      prices: { 1: 0.85, 8453: 0.84, 42161: 0.86, 10: 0.845, 56: 0.83 },
      spread: 3.61,
      arbitrageOpportunity: true,
    },
  ]
}

function generateSampleWhaleActivity(): WhaleActivity[] {
  return [
    { address: '0x1234...5678', chain: 1, action: 'buy', token: 'ETH', amount: '5,000', value: '$17.25M', timestamp: Date.now() - 120000 },
    { address: '0x2345...6789', chain: 8453, action: 'sell', token: 'USDC', amount: '10M', value: '$10M', timestamp: Date.now() - 300000 },
    { address: '0x3456...7890', chain: 42161, action: 'transfer', token: 'ARB', amount: '2.5M', value: '$2.1M', timestamp: Date.now() - 600000 },
    { address: '0x4567...8901', chain: 56, action: 'buy', token: 'BNB', amount: '15,000', value: '$9.75M', timestamp: Date.now() - 900000 },
  ]
}

function AlertCard({ alert }: { alert: MarketAlert }) {
  const chain = CHAINS.find(c => c.id === alert.chain)
  const severityColors = {
    info: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
    warning: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400',
    critical: 'bg-red-500/20 border-red-500/30 text-red-400',
  }
  const typeIcons = {
    price: '📈',
    volume: '📊',
    whale: '🐋',
    liquidation: '💥',
    funding: '💰',
    opportunity: '✨',
  }

  const timeAgo = Math.floor((Date.now() - alert.timestamp) / 60000)
  const timeStr = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.floor(timeAgo / 60)}h ago`

  return (
    <div className={`card p-4 border ${severityColors[alert.severity]}`}>
      <div className="flex items-start gap-3">
        <div className="text-2xl">{typeIcons[alert.type]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{alert.title}</span>
            {chain && (
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: chain.color + '20', color: chain.color }}>
                {chain.icon} {chain.name}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{alert.description}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{timeStr}</p>
        </div>
      </div>
    </div>
  )
}

function CrossChainPriceTable({ prices }: { prices: CrossChainPrice[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Cross-Chain Prices</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <th className="p-3 text-left" style={{ color: 'var(--text-tertiary)' }}>Token</th>
              {CHAINS.map(chain => (
                <th key={chain.id} className="p-3 text-right" style={{ color: 'var(--text-tertiary)' }}>
                  {chain.icon}
                </th>
              ))}
              <th className="p-3 text-right" style={{ color: 'var(--text-tertiary)' }}>Spread</th>
            </tr>
          </thead>
          <tbody>
            {prices.map(price => (
              <tr key={price.token} className="border-t" style={{ borderColor: 'var(--border)' }}>
                <td className="p-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {price.token}
                  {price.arbitrageOpportunity && <span className="ml-1 text-green-400">✨</span>}
                </td>
                {CHAINS.map(chain => {
                  const chainPrice = price.prices[chain.id]
                  return (
                    <td key={chain.id} className="p-3 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {chainPrice ? `$${chainPrice.toLocaleString()}` : '—'}
                    </td>
                  )
                })}
                <td className={`p-3 text-right font-semibold ${price.spread > 0.5 ? 'text-green-400' : ''}`}>
                  {price.spread.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function WhaleTracker({ activity }: { activity: WhaleActivity[] }) {
  return (
    <div className="card">
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h3 className="font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          🐋 Whale Activity
        </h3>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {activity.map((whale, i) => {
          const chain = CHAINS.find(c => c.id === whale.chain)
          const actionColors = {
            buy: 'text-green-400',
            sell: 'text-red-400',
            transfer: 'text-blue-400',
          }
          const timeAgo = Math.floor((Date.now() - whale.timestamp) / 60000)

          return (
            <div key={i} className="p-3 flex items-center gap-3">
              <div className="text-lg">{chain?.icon}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{whale.address}</span>
                  <span className={`text-xs font-semibold uppercase ${actionColors[whale.action]}`}>
                    {whale.action}
                  </span>
                </div>
                <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  {whale.amount} {whale.token} ({whale.value})
                </div>
              </div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {timeAgo}m
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MarketMetrics() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="card p-4">
        <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Fear & Greed</div>
        <div className="text-2xl font-bold text-green-400">72</div>
        <div className="text-xs text-green-400">Greed</div>
      </div>
      <div className="card p-4">
        <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>BTC Dominance</div>
        <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>58.2%</div>
        <div className="text-xs text-red-400">-0.3%</div>
      </div>
      <div className="card p-4">
        <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Total DEX Vol</div>
        <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>$12.4B</div>
        <div className="text-xs text-green-400">+15%</div>
      </div>
      <div className="card p-4">
        <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Gas (Gwei)</div>
        <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>24</div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Normal</div>
      </div>
    </div>
  )
}

export default function IntelPage() {
  const [selectedChains, setSelectedChains] = useState<number[]>(CHAINS.map(c => c.id))
  const [alertFilter, setAlertFilter] = useState<'all' | 'critical' | 'opportunity'>('all')

  // Data queries - uses sample data in demo mode
  const { data: alerts } = useQuery({
    queryKey: ['intel-alerts'],
    queryFn: () => Promise.resolve(generateSampleAlerts()),
    refetchInterval: 30000,
    staleTime: 25000,
  })

  const { data: crossChainPrices } = useQuery({
    queryKey: ['cross-chain-prices'],
    queryFn: () => Promise.resolve(generateSampleCrossChainPrices()),
    refetchInterval: 15000,
    staleTime: 10000,
  })

  const { data: whaleActivity } = useQuery({
    queryKey: ['whale-activity'],
    queryFn: () => Promise.resolve(generateSampleWhaleActivity()),
    refetchInterval: 60000,
    staleTime: 55000,
  })

  const filteredAlerts = alerts?.filter(alert => {
    if (alertFilter === 'critical') return alert.severity === 'critical'
    if (alertFilter === 'opportunity') return alert.type === 'opportunity'
    return true
  }).filter(alert => selectedChains.includes(alert.chain))

  return (
    <div>
      {/* Demo Mode Banner */}
      {IS_DEMO_MODE && (
        <div className="mb-4 p-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10">
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <span>⚠️</span>
            <span>Demo Mode: Showing sample data. Connect to live feeds for real market intelligence.</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          🔮 Market Intel
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {IS_DEMO_MODE ? 'Sample market intelligence data' : 'Real-time market intelligence across chains'}
        </p>
      </div>

      {/* Market Metrics */}
      <div className="mb-6">
        <MarketMetrics />
      </div>

      {/* Chain Filter */}
      <div className="mb-6">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {CHAINS.map(chain => (
            <button
              key={chain.id}
              onClick={() => {
                setSelectedChains(prev =>
                  prev.includes(chain.id)
                    ? prev.filter(id => id !== chain.id)
                    : [...prev, chain.id]
                )
              }}
              className={`px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
                selectedChains.includes(chain.id) ? 'bg-bazaar-primary text-white' : ''
              }`}
              style={!selectedChains.includes(chain.id) ? {
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-secondary)'
              } : undefined}
            >
              <span>{chain.icon}</span>
              <span>{chain.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Alerts Column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Live Alerts</h2>
            <div className="flex gap-2">
              {(['all', 'critical', 'opportunity'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setAlertFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium ${
                    alertFilter === f ? 'bg-bazaar-primary text-white' : ''
                  }`}
                  style={alertFilter !== f ? {
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-secondary)'
                  } : undefined}
                >
                  {f === 'all' ? 'All' : f === 'critical' ? '🔴 Critical' : '✨ Opportunities'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredAlerts?.map(alert => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
            {filteredAlerts?.length === 0 && (
              <div className="card p-8 text-center">
                <div className="text-4xl mb-3">🔍</div>
                <p style={{ color: 'var(--text-tertiary)' }}>No alerts matching your filters</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <WhaleTracker activity={whaleActivity ?? []} />
        </div>
      </div>

      {/* Cross-Chain Prices */}
      <div className="mt-6">
        <CrossChainPriceTable prices={crossChainPrices ?? []} />
      </div>
    </div>
  )
}

