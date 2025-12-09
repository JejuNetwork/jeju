'use client'

import { useQuery } from '@tanstack/react-query'
import { getContractDetails, getTokenTransfers, getTokenHolders } from '@/lib/indexer-client'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useAccount } from 'wagmi'
import { useState } from 'react'
import { toast } from 'sonner'

interface PageProps {
  params: {
    chainId: string
    address: string
  }
}

export default function TokenDetailPage({ params }: PageProps) {
  const { isConnected } = useAccount()
  const [buyAmount, setBuyAmount] = useState('')
  const [sellAmount, setSellAmount] = useState('')

  const { data: tokenData, isLoading: isLoadingToken } = useQuery({
    queryKey: ['token-details', params.address],
    queryFn: () => getContractDetails(params.address),
    refetchInterval: 10000,
  })

  const { data: transfers, isLoading: isLoadingTransfers } = useQuery({
    queryKey: ['token-transfers', params.address],
    queryFn: () => getTokenTransfers(params.address, 20),
    refetchInterval: 10000,
  })

  const { data: holders, isLoading: isLoadingHolders } = useQuery({
    queryKey: ['token-holders', params.address],
    queryFn: () => getTokenHolders(params.address, 20),
    refetchInterval: 10000,
  })

  if (isLoadingToken) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!tokenData) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl md:text-7xl mb-4">❌</div>
        <h2 className="text-xl md:text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
          Token Not Found
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          This token hasn't been indexed yet or doesn't exist
        </p>
      </div>
    )
  }

  const handleBuy = async () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }
    toast.info('Buy functionality coming soon.')
  }

  const handleSell = async () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }
    toast.info('Sell functionality coming soon.')
  }

  return (
    <div>
      {/* Token Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-2xl md:text-3xl font-bold text-white">
            {tokenData.address.slice(2, 4).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl md:text-4xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              {tokenData.address.slice(0, 6)}...{tokenData.address.slice(-4)}
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>ERC20 Token on Jeju</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <div className="stat-card">
            <p className="stat-label">Contract</p>
            <p className="font-mono text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {tokenData.address.slice(0, 10)}...
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Creator</p>
            <p className="font-mono text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {tokenData.creator.address.slice(0, 10)}...
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Created</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {new Date(tokenData.creationBlock.timestamp).toLocaleDateString()}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Block</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              #{tokenData.creationBlock.number}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trading Panel */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-5 md:p-6">
            <h2 className="text-xl md:text-2xl font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>
              Trade
            </h2>

            {/* Buy Section */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Buy Amount (ETH)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={buyAmount}
                  onChange={(e) => setBuyAmount(e.target.value)}
                  placeholder="0.0"
                  className="input flex-1"
                />
                <button
                  onClick={handleBuy}
                  disabled={!isConnected || !buyAmount}
                  className="btn-accent px-6 md:px-8 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Buy
                </button>
              </div>
            </div>

            {/* Sell Section */}
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Sell Amount (Tokens)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  placeholder="0.0"
                  className="input flex-1"
                />
                <button
                  onClick={handleSell}
                  disabled={!isConnected || !sellAmount}
                  className="px-6 md:px-8 py-3 rounded-xl font-semibold bg-bazaar-error text-white hover:bg-bazaar-error/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Sell
                </button>
              </div>
            </div>
          </div>

          {/* Recent Transfers */}
          <div className="card p-5 md:p-6">
            <h2 className="text-lg md:text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Recent Transfers
            </h2>
            {isLoadingTransfers && <LoadingSpinner />}
            {transfers && transfers.length === 0 && (
              <p className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>No transfers yet</p>
            )}
            {transfers && transfers.length > 0 && (
              <div className="space-y-3">
                {transfers.map((transfer) => (
                  <div
                    key={transfer.id}
                    className="p-4 rounded-xl"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                          {transfer.from.address.slice(0, 6)}...
                        </span>
                        <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                        <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                          {transfer.to.address.slice(0, 6)}...
                        </span>
                      </div>
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {new Date(transfer.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {Number(transfer.value) / 1e18} tokens
                      </span>
                      <a
                        href={`http://localhost:4004/tx/${transfer.transaction.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-bazaar-primary hover:underline"
                      >
                        View Tx
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Holders Panel */}
        <div className="card p-5 md:p-6 h-fit">
          <h2 className="text-lg md:text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Top Holders
          </h2>
          {isLoadingHolders && <LoadingSpinner />}
          {holders && holders.length === 0 && (
            <p className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>No holders yet</p>
          )}
          {holders && holders.length > 0 && (
            <div className="space-y-3">
              {holders.map((holder, index) => (
                <div
                  key={holder.id}
                  className="flex items-center justify-between p-3 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                      #{index + 1}
                    </span>
                    <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {holder.account.address.slice(0, 6)}...{holder.account.address.slice(-4)}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {(Number(holder.balance) / 1e18).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {holder.transferCount} transfers
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
