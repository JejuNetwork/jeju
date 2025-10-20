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
        <div className="text-6xl mb-4">❌</div>
        <h2 className="text-2xl font-semibold mb-2">Token Not Found</h2>
        <p className="text-slate-400">
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
    toast.info('Buy functionality coming soon!')
  }

  const handleSell = async () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }
    toast.info('Sell functionality coming soon!')
  }

  return (
    <div>
      {/* Token Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-3xl font-bold">
            {tokenData.address.slice(2, 4).toUpperCase()}
          </div>
          <div>
            <h1 className="text-4xl font-bold mb-1">
              {tokenData.address.slice(0, 6)}...{tokenData.address.slice(-4)}
            </h1>
            <p className="text-slate-400">ERC20 Token on Jeju</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm text-slate-400 mb-1">Contract</p>
            <p className="font-mono text-sm">{tokenData.address.slice(0, 10)}...</p>
          </div>
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm text-slate-400 mb-1">Creator</p>
            <p className="font-mono text-sm">{tokenData.creator.address.slice(0, 10)}...</p>
          </div>
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm text-slate-400 mb-1">Created</p>
            <p className="text-sm">{new Date(tokenData.creationBlock.timestamp).toLocaleDateString()}</p>
          </div>
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm text-slate-400 mb-1">Block</p>
            <p className="text-sm">#{tokenData.creationBlock.number}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trading Panel */}
        <div className="lg:col-span-2">
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 mb-6">
            <h2 className="text-2xl font-semibold mb-6">Trade</h2>

            {/* Buy Section */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Buy Amount (ETH)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={buyAmount}
                  onChange={(e) => setBuyAmount(e.target.value)}
                  placeholder="0.0"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={handleBuy}
                  disabled={!isConnected || !buyAmount}
                  className="px-8 py-3 rounded-lg bg-green-600 hover:bg-green-500 font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Buy
                </button>
              </div>
            </div>

            {/* Sell Section */}
            <div>
              <label className="block text-sm font-medium mb-2">Sell Amount (Tokens)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  placeholder="0.0"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={handleSell}
                  disabled={!isConnected || !sellAmount}
                  className="px-8 py-3 rounded-lg bg-red-600 hover:bg-red-500 font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Sell
                </button>
              </div>
            </div>
          </div>

          {/* Recent Transfers */}
          <div className="p-6 rounded-xl bg-white/5 border border-white/10">
            <h2 className="text-xl font-semibold mb-4">Recent Transfers</h2>
            {isLoadingTransfers && <LoadingSpinner />}
            {transfers && transfers.length === 0 && (
              <p className="text-slate-400 text-center py-8">No transfers yet</p>
            )}
            {transfers && transfers.length > 0 && (
              <div className="space-y-3">
                {transfers.map((transfer) => (
                  <div
                    key={transfer.id}
                    className="p-4 rounded-lg bg-white/5 border border-white/10"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono">
                          {transfer.from.address.slice(0, 6)}...
                        </span>
                        <span className="text-slate-400">→</span>
                        <span className="text-sm font-mono">
                          {transfer.to.address.slice(0, 6)}...
                        </span>
                      </div>
                      <span className="text-sm text-slate-400">
                        {new Date(transfer.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold">
                        {Number(transfer.value) / 1e18} tokens
                      </span>
                      <a
                        href={`http://localhost:4004/tx/${transfer.transaction.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-400 hover:text-purple-300"
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
        <div className="p-6 rounded-xl bg-white/5 border border-white/10">
          <h2 className="text-xl font-semibold mb-4">Top Holders</h2>
          {isLoadingHolders && <LoadingSpinner />}
          {holders && holders.length === 0 && (
            <p className="text-slate-400 text-center py-8">No holders yet</p>
          )}
          {holders && holders.length > 0 && (
            <div className="space-y-3">
              {holders.map((holder, index) => (
                <div
                  key={holder.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/5"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-400">#{index + 1}</span>
                    <span className="text-sm font-mono">
                      {holder.account.address.slice(0, 6)}...{holder.account.address.slice(-4)}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {(Number(holder.balance) / 1e18).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    <p className="text-xs text-slate-400">{holder.transferCount} transfers</p>
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



