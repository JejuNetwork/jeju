/**
 * Coins Page
 *
 * Browse and trade ERC-20 tokens on the network
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  type Address,
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
} from 'viem'
import { CONTRACTS, RPC_URL } from '../../config'
import {
  checkIndexerHealth,
  fetchTokensWithMarketData,
  type Token,
} from '../../lib/data-client'
import { LoadingSpinner } from '../components/LoadingSpinner'
import {
  EmptyState,
  ErrorState,
  FilterTabs,
  Grid,
  InfoCard,
  PageHeader,
} from '../components/ui'
import { JEJU_CHAIN_ID } from '../config/chains'

type FilterType = 'all' | 'verified' | 'new'
type OrderByType = 'volume' | 'recent' | 'holders'

const FILTER_OPTIONS = [
  { value: 'all' as const, label: 'All Coins' },
  { value: 'verified' as const, label: 'Verified', icon: '✓' },
  { value: 'new' as const, label: 'New', icon: '🆕' },
]

function formatNumber(num: number | bigint): string {
  const n = typeof num === 'bigint' ? Number(num) : num
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

function TokenCard({ token }: { token: Token }) {
  const initials = token.symbol.slice(0, 2).toUpperCase()
  const supplyFormatted = formatNumber(
    Number(formatUnits(token.totalSupply, token.decimals)),
  )

  return (
    <Link
      to={`/coins/${JEJU_CHAIN_ID}/${token.address}`}
      className="group block animate-fade-in-up"
    >
      <article className="card p-5 h-full hover:scale-[1.02] transition-all duration-300">
        <div className="flex items-center gap-3 mb-4">
          {token.logoUrl ? (
            <img
              src={token.logoUrl}
              alt=""
              className="w-12 h-12 rounded-2xl"
              aria-hidden="true"
            />
          ) : (
            <div
              className="w-12 h-12 rounded-2xl gradient-warm flex items-center justify-center text-lg font-bold text-white group-hover:scale-110 transition-transform"
              aria-hidden="true"
            >
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-primary truncate">
                {token.name}
              </h3>
              {token.verified && (
                <span className="text-blue-400 text-sm" title="Verified token">
                  ✓
                </span>
              )}
            </div>
            <p className="text-sm font-mono text-tertiary">${token.symbol}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-tertiary">Supply</dt>
            <dd className="font-semibold text-primary">{supplyFormatted}</dd>
          </div>
          <div>
            <dt className="text-tertiary">Holders</dt>
            <dd className="font-semibold text-primary">
              {token.holders ? formatNumber(token.holders) : '—'}
            </dd>
          </div>
        </dl>
      </article>
    </Link>
  )
}

// Fetch default tokens directly from RPC when indexer is down
async function fetchDefaultTokens(): Promise<Token[]> {
  const tokens: Token[] = []

  // Use RPC proxy in browser to avoid CORS
  const rpcUrl = typeof window !== 'undefined' ? '/api/rpc' : RPC_URL
  const client = createPublicClient({ transport: http(rpcUrl) })

  // Known localnet tokens
  const knownTokens: Array<{ address: Address; verified: boolean }> = [
    { address: CONTRACTS.jeju, verified: true },
  ]

  for (const { address, verified } of knownTokens) {
    // Skip zero addresses
    if (!address || address === '0x0000000000000000000000000000000000000000') {
      continue
    }

    try {
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        client.readContract({
          address,
          abi: erc20Abi,
          functionName: 'name',
        }),
        client.readContract({
          address,
          abi: erc20Abi,
          functionName: 'symbol',
        }),
        client.readContract({
          address,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
        client.readContract({
          address,
          abi: erc20Abi,
          functionName: 'totalSupply',
        }),
      ])

      tokens.push({
        address,
        chainId: JEJU_CHAIN_ID,
        name: name as string,
        symbol: symbol as string,
        decimals: decimals as number,
        totalSupply: totalSupply as bigint,
        creator: '0x0000000000000000000000000000000000000000',
        createdAt: new Date(),
        verified,
      })
    } catch {
      // Token doesn't exist or contract error - skip
    }
  }

  return tokens
}

export default function CoinsPage() {
  const [filter, setFilter] = useState<FilterType>('all')
  const [orderBy, setOrderBy] = useState<OrderByType>('recent')

  // Check if indexer is healthy
  const { data: indexerUp } = useQuery({
    queryKey: ['indexer-health'],
    queryFn: checkIndexerHealth,
    staleTime: 30000,
  })

  const {
    data: tokens,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['tokens', filter, orderBy, indexerUp],
    queryFn: async () => {
      // If indexer is up, try to use it
      if (indexerUp) {
        try {
          const result = await fetchTokensWithMarketData({
            limit: 50,
            verified: filter === 'verified' ? true : undefined,
            orderBy,
          })
          if (result.length > 0) return result
        } catch {
          // Indexer error, fall through to default tokens
        }
      }
      // Fetch default tokens directly from RPC
      return fetchDefaultTokens()
    },
    refetchInterval: 15000,
    staleTime: 10000,
  })

  const filteredTokens = useMemo(() => {
    if (!tokens) return []
    if (filter === 'new') {
      return tokens.filter(
        (t) => t.createdAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      )
    }
    return tokens
  }, [tokens, filter])

  return (
    <div className="animate-fade-in">
      <PageHeader
        icon="🪙"
        title="Coins"
        description="Discover, trade, and launch tokens on the network"
        action={{ label: 'Create Token', href: '/coins/launch' }}
      />

      {/* Indexer Status Warning */}
      {!indexerUp && (
        <InfoCard variant="warning" className="mb-6">
          <p className="font-medium">Limited Data Available</p>
          <p className="text-sm opacity-80">
            The indexer is offline. Showing deployed tokens only.
          </p>
        </InfoCard>
      )}

      {/* Filters and Sort */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <FilterTabs
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
          className="flex-1"
        />

        <select
          value={orderBy}
          onChange={(e) => setOrderBy(e.target.value as OrderByType)}
          className="input text-sm py-2 w-full sm:w-44"
          aria-label="Sort tokens by"
        >
          <option value="recent">Most Recent</option>
          <option value="volume">Top Volume</option>
          <option value="holders">Most Holders</option>
        </select>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Failed to load tokens'}
          onRetry={() => refetch()}
        />
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredTokens.length === 0 && (
        <EmptyState
          icon="🪙"
          title="No Tokens Yet"
          description="Be the first to create a token on the network and start building your community."
          action={{ label: 'Create First Token', href: '/coins/launch' }}
        />
      )}

      {/* Tokens Grid */}
      {!isLoading && !error && filteredTokens.length > 0 && (
        <Grid cols={3}>
          {filteredTokens.map((token, index) => (
            <div key={token.address} className={`stagger-${(index % 6) + 1}`}>
              <TokenCard token={token} />
            </div>
          ))}
        </Grid>
      )}
    </div>
  )
}
