/**
 * Pools View - Liquidity pool management
 */

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Minus, DollarSign, TrendingUp, Droplets } from 'lucide-react';
import { poolsService, type V2Position, type V3Position } from '../../services';
import type { Address } from 'viem';
import { formatUnits } from 'viem';

interface PoolsViewProps {
  address: Address;
}

type TabType = 'positions' | 'add' | 'remove';

export function PoolsView({ address }: PoolsViewProps) {
  const [tab, setTab] = useState<TabType>('positions');
  const [v2Positions, setV2Positions] = useState<V2Position[]>([]);
  const [v3Positions, setV3Positions] = useState<V3Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPositions = useCallback(async () => {
    setIsLoading(true);
    const [v2, v3] = await Promise.all([
      poolsService.getAllV2Positions(address),
      poolsService.getAllV3Positions(address),
    ]);
    setV2Positions(v2);
    setV3Positions(v3);
    setIsLoading(false);
  }, [address]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  const totalPositions = v2Positions.length + v3Positions.length;
  const hasUnclaimedFees = v3Positions.some(p => p.tokensOwed0 > 0n || p.tokensOwed1 > 0n);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Droplets className="w-7 h-7 text-blue-400" />
              Liquidity Pools
            </h2>
            <p className="text-muted-foreground">Provide liquidity, earn trading fees</p>
          </div>
          <button
            onClick={fetchPositions}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-xl disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <TrendingUp className="w-4 h-4" />
              Positions
            </div>
            <div className="text-2xl font-bold mt-1">{totalPositions}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Droplets className="w-4 h-4" />
              V2 Pools
            </div>
            <div className="text-2xl font-bold mt-1">{v2Positions.length}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <DollarSign className="w-4 h-4" />
              V3 Positions
            </div>
            <div className="text-2xl font-bold mt-1">{v3Positions.length}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border pb-2">
          {[
            { id: 'positions' as const, label: 'My Positions', icon: TrendingUp },
            { id: 'add' as const, label: 'Add Liquidity', icon: Plus },
            { id: 'remove' as const, label: 'Remove', icon: Minus },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === id ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === 'positions' && (
          <div className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-24 bg-secondary/50 rounded-xl animate-pulse" />)}
              </div>
            ) : totalPositions === 0 ? (
              <div className="text-center py-12 bg-card border border-border rounded-xl">
                <Droplets className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No Liquidity Positions</h3>
                <p className="text-muted-foreground mt-2">Add liquidity to start earning trading fees</p>
                <button
                  onClick={() => setTab('add')}
                  className="mt-4 px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl"
                >
                  Add Liquidity
                </button>
              </div>
            ) : (
              <>
                {/* V2 Positions */}
                {v2Positions.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3">V2 Pools (Constant Product)</h3>
                    <div className="space-y-3">
                      {v2Positions.map((pos, i) => (
                        <div key={i} className="bg-card border border-border rounded-xl p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex -space-x-2">
                                <div className="w-8 h-8 rounded-full bg-blue-500/20 border-2 border-background flex items-center justify-center text-xs font-bold">T0</div>
                                <div className="w-8 h-8 rounded-full bg-purple-500/20 border-2 border-background flex items-center justify-center text-xs font-bold">T1</div>
                              </div>
                              <div>
                                <p className="font-medium">{pos.pool.token0.slice(0, 6)}.../{pos.pool.token1.slice(0, 6)}...</p>
                                <p className="text-xs text-muted-foreground">Share: {pos.share.toFixed(4)}%</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-medium">{formatUnits(pos.lpBalance, 18)} LP</p>
                              <p className="text-xs text-muted-foreground">
                                {formatUnits(pos.token0Amount, 18)} / {formatUnits(pos.token1Amount, 18)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* V3 Positions */}
                {v3Positions.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3">V3 Positions (Concentrated)</h3>
                    <div className="space-y-3">
                      {v3Positions.map((pos) => (
                        <div key={pos.tokenId.toString()} className="bg-card border border-border rounded-xl p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">Position #{pos.tokenId.toString()}</p>
                              <p className="text-xs text-muted-foreground">
                                Range: {pos.tickLower} → {pos.tickUpper} • Fee: {pos.fee / 10000}%
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-medium">{formatUnits(pos.liquidity, 18)} Liquidity</p>
                              {(pos.tokensOwed0 > 0n || pos.tokensOwed1 > 0n) && (
                                <p className="text-xs text-emerald-400">
                                  Fees: {formatUnits(pos.tokensOwed0, 18)} / {formatUnits(pos.tokensOwed1, 18)}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {hasUnclaimedFees && (
                      <button className="w-full mt-4 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-medium">
                        Collect All Fees
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'add' && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">Add Liquidity</h3>
            <p className="text-muted-foreground mb-6">
              Select a token pair and amount to provide liquidity.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Token A</label>
                <input
                  type="text"
                  placeholder="Select token..."
                  className="w-full px-4 py-3 bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Token B</label>
                <input
                  type="text"
                  placeholder="Select token..."
                  className="w-full px-4 py-3 bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Amount A</label>
                <input
                  type="text"
                  placeholder="0.0"
                  className="w-full px-4 py-3 bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <button className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium">
                Add Liquidity
              </button>
            </div>
            
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Or use the chat: "Add 0.5 ETH to ETH/USDC pool"
            </p>
          </div>
        )}

        {tab === 'remove' && (
          <div className="bg-card border border-border rounded-xl p-6 text-center">
            <Minus className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">Remove Liquidity</h3>
            <p className="text-muted-foreground mt-2">
              Select a position from "My Positions" to remove liquidity, or use the chat:
            </p>
            <p className="text-sm text-blue-400 mt-2">"Remove 50% of my ETH/USDC liquidity"</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default PoolsView;

