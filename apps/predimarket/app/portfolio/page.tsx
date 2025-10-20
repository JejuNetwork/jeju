'use client';

import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useUserPositions } from '@/hooks/useUserPositions';
import Link from 'next/link';

export default function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const { positions, totalValue, totalPnL, loading } = useUserPositions(address);

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-600 bg-clip-text text-transparent">
              Predimarket
            </Link>
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-4xl font-bold text-white mb-8">Your Portfolio</h1>

        {!isConnected ? (
          <div className="text-center py-20">
            <div className="mb-6">
              <div className="text-6xl mb-4">🔐</div>
              <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
              <p className="text-gray-400">View your positions and claim winnings</p>
            </div>
            <ConnectButton />
          </div>
        ) : loading ? (
          <div className="text-center py-20 text-gray-400">Loading positions...</div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="text-sm text-gray-400 mb-1">Total Value</div>
                <div className="text-3xl font-bold text-white">
                  {(Number(totalValue) / 1e18).toLocaleString()} elizaOS
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="text-sm text-gray-400 mb-1">Total P&L</div>
                <div className={`text-3xl font-bold ${totalPnL >= 0n ? 'text-green-400' : 'text-red-400'}`}>
                  {totalPnL >= 0n ? '+' : ''}{(Number(totalPnL) / 1e18).toLocaleString()} elizaOS
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="text-sm text-gray-400 mb-1">Active Positions</div>
                <div className="text-3xl font-bold text-white">
                  {positions.filter(p => !p.market.resolved).length}
                </div>
              </div>
            </div>

            {/* Positions Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="p-6 border-b border-gray-800">
                <h2 className="text-xl font-bold text-white">Positions</h2>
              </div>
              
              {positions.length === 0 ? (
                <div className="p-12 text-center text-gray-400">
                  No positions yet. <Link href="/" className="text-green-400 hover:underline">Browse markets</Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-800/50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                          Market
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                          Position
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                          Value
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                          P&L
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {positions.map((pos) => {
                        const pnl = Number(pos.totalReceived) - Number(pos.totalSpent);
                        const currentValue = pos.market.resolved
                          ? (pos.market.outcome ? Number(pos.yesShares) : Number(pos.noShares))
                          : Number(pos.yesShares) + Number(pos.noShares);
                        
                        return (
                          <tr key={pos.id} className="hover:bg-gray-800/30">
                            <td className="px-6 py-4">
                              <Link href={`/market/${pos.market.sessionId}`} className="text-white hover:text-green-400">
                                {pos.market.question}
                              </Link>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex gap-2">
                                {Number(pos.yesShares) > 0 && (
                                  <span className="px-2 py-1 bg-green-600/20 text-green-400 rounded text-xs">
                                    YES {(Number(pos.yesShares) / 1e18).toFixed(2)}
                                  </span>
                                )}
                                {Number(pos.noShares) > 0 && (
                                  <span className="px-2 py-1 bg-red-600/20 text-red-400 rounded text-xs">
                                    NO {(Number(pos.noShares) / 1e18).toFixed(2)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-white">
                              {(currentValue / 1e18).toLocaleString()} elizaOS
                            </td>
                            <td className="px-6 py-4">
                              <span className={pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                                {pnl >= 0 ? '+' : ''}{(pnl / 1e18).toFixed(2)} elizaOS
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              {pos.market.resolved ? (
                                pos.hasClaimed ? (
                                  <span className="text-gray-400">Claimed</span>
                                ) : (
                                  <span className="text-green-400">Ready to claim</span>
                                )
                              ) : (
                                <span className="text-blue-400">Active</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {pos.market.resolved && !pos.hasClaimed && (
                                <button className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition">
                                  Claim
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

