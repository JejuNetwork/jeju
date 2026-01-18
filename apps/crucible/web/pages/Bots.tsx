import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { API_URL } from '../config'

interface BotMetrics {
  opportunitiesDetected: number
  opportunitiesExecuted: number
  opportunitiesFailed: number
  totalProfitWei: string
  totalProfitUsd: string
  totalGasSpent: string
  avgExecutionTimeMs: number
  uptime: number
  lastUpdate: number
  byStrategy: Record<
    string,
    {
      detected: number
      executed: number
      failed: number
      profitWei: string
    }
  >
}

interface Bot {
  agentId: string
  metrics: BotMetrics
  healthy: boolean
}

interface BotsResponse {
  bots: Bot[]
}

function useBots() {
  return useQuery({
    queryKey: ['bots'],
    queryFn: async (): Promise<Bot[]> => {
      const response = await fetch(`${API_URL}/api/v1/bots`)
      if (!response.ok) throw new Error('Failed to fetch bots')
      const data: BotsResponse = await response.json()
      return data.bots
    },
    refetchInterval: 10000,
  })
}

function useStartBot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (botId: string) => {
      const response = await fetch(`${API_URL}/api/v1/bots/${botId}/start`, {
        method: 'POST',
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to start bot')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] })
    },
  })
}

function useStopBot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (botId: string) => {
      const response = await fetch(`${API_URL}/api/v1/bots/${botId}/stop`, {
        method: 'POST',
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to stop bot')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] })
    },
  })
}

const STRATEGY_LABELS: Record<string, { label: string; icon: string }> = {
  DEX_ARBITRAGE: { label: 'DEX Arbitrage', icon: '🔄' },
  CROSS_CHAIN_ARBITRAGE: { label: 'Cross-Chain Arb', icon: '🌉' },
  SANDWICH: { label: 'Sandwich', icon: '🥪' },
  LIQUIDATION: { label: 'Liquidation', icon: '💧' },
  SOLVER: { label: 'Intent Solver', icon: '🧩' },
  ORACLE_KEEPER: { label: 'Oracle Keeper', icon: '🔮' },
}

function formatWei(wei: string): string {
  const value = BigInt(wei)
  const eth = Number(value) / 1e18
  if (eth >= 1) return `${eth.toFixed(4)} ETH`
  if (eth >= 0.001) return `${(eth * 1000).toFixed(2)} mETH`
  return `${wei} wei`
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

export default function BotsPage() {
  const { data: bots, isLoading, error } = useBots()
  const startBot = useStartBot()
  const stopBot = useStopBot()
  const [selectedBot, setSelectedBot] = useState<string | null>(null)

  if (isLoading) {
    return (
      <output className="flex flex-col items-center justify-center py-20">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading bots
        </p>
      </output>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card-static p-8 text-center" role="alert">
          <div className="text-5xl mb-4">⚠️</div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--color-error)' }}
          >
            Failed to load bots
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>{error.message}</p>
        </div>
      </div>
    )
  }

  const selectedBotData = bots?.find((b) => b.agentId === selectedBot)

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <header className="mb-8">
        <h1
          className="text-3xl md:text-4xl font-bold mb-2 font-display"
          style={{ color: 'var(--text-primary)' }}
        >
          Trading Bots
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Automated trading strategies with real-time metrics
        </p>
      </header>

      {/* Stats Overview */}
      {bots && bots.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="card-static p-5 text-center">
            <p
              className="text-sm font-medium mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Active Bots
            </p>
            <p
              className="text-2xl font-bold font-display"
              style={{ color: 'var(--color-success)' }}
            >
              {bots.filter((b) => b.healthy).length}
            </p>
          </div>
          <div className="card-static p-5 text-center">
            <p
              className="text-sm font-medium mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Total Opportunities
            </p>
            <p
              className="text-2xl font-bold font-display tabular-nums"
              style={{ color: 'var(--text-primary)' }}
            >
              {bots.reduce(
                (sum, b) => sum + b.metrics.opportunitiesDetected,
                0,
              )}
            </p>
          </div>
          <div className="card-static p-5 text-center">
            <p
              className="text-sm font-medium mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Executed
            </p>
            <p
              className="text-2xl font-bold font-display tabular-nums"
              style={{ color: 'var(--text-primary)' }}
            >
              {bots.reduce(
                (sum, b) => sum + b.metrics.opportunitiesExecuted,
                0,
              )}
            </p>
          </div>
          <div className="card-static p-5 text-center">
            <p
              className="text-sm font-medium mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Total Profit
            </p>
            <p
              className="text-2xl font-bold font-display"
              style={{ color: 'var(--color-success)' }}
            >
              {formatWei(
                bots
                  .reduce(
                    (sum, b) => sum + BigInt(b.metrics.totalProfitWei),
                    0n,
                  )
                  .toString(),
              )}
            </p>
          </div>
        </div>
      )}

      {/* No Bots */}
      {(!bots || bots.length === 0) && (
        <div className="card-static p-12 text-center">
          <div className="text-6xl mb-6 animate-float">📈</div>
          <h2
            className="text-2xl font-bold mb-3 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            No Trading Bots
          </h2>
          <p
            className="mb-6 max-w-md mx-auto"
            style={{ color: 'var(--text-secondary)' }}
          >
            Trading bots are registered automatically when you deploy an agent
            with bot_type = "trading_bot". Configure strategies in the agent
            character.
          </p>
          <code
            className="block p-4 rounded-lg text-sm font-mono text-left max-w-lg mx-auto"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            {`{
  "botType": "trading_bot",
  "strategies": [
    { "type": "DEX_ARBITRAGE", "enabled": true }
  ]
}`}
          </code>
        </div>
      )}

      {/* Bot Grid */}
      {bots && bots.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Bot List */}
          <div className="lg:col-span-1 space-y-4">
            <h2
              className="text-lg font-bold font-display mb-4"
              style={{ color: 'var(--text-primary)' }}
            >
              Bots
            </h2>
            {bots.map((bot) => (
              <button
                key={bot.agentId}
                type="button"
                onClick={() => setSelectedBot(bot.agentId)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  selectedBot === bot.agentId
                    ? 'ring-2 ring-[var(--color-primary)] border-[var(--color-primary)]'
                    : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                }`}
                style={{
                  backgroundColor:
                    selectedBot === bot.agentId
                      ? 'rgba(99, 102, 241, 0.1)'
                      : 'var(--surface)',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">📈</span>
                    <span
                      className="font-bold font-display"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      Bot #{bot.agentId}
                    </span>
                  </div>
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      bot.healthy ? 'status-dot-active' : 'status-dot-error'
                    }`}
                  />
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-tertiary)' }}>Profit</span>
                  <span
                    className="font-mono"
                    style={{ color: 'var(--color-success)' }}
                  >
                    {formatWei(bot.metrics.totalProfitWei)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-tertiary)' }}>Uptime</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {formatUptime(bot.metrics.uptime)}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Bot Details */}
          <div className="lg:col-span-2">
            {selectedBotData ? (
              <div className="card-static p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                      style={{ backgroundColor: 'var(--bg-secondary)' }}
                    >
                      📈
                    </div>
                    <div>
                      <h2
                        className="text-xl font-bold font-display"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        Bot #{selectedBotData.agentId}
                      </h2>
                      <span
                        className={
                          selectedBotData.healthy
                            ? 'badge-success'
                            : 'badge-error'
                        }
                      >
                        {selectedBotData.healthy ? 'Healthy' : 'Unhealthy'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startBot.mutate(selectedBotData.agentId)}
                      disabled={startBot.isPending}
                      className="btn-primary btn-sm"
                    >
                      {startBot.isPending ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        'Start'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => stopBot.mutate(selectedBotData.agentId)}
                      disabled={stopBot.isPending}
                      className="btn-secondary btn-sm"
                    >
                      {stopBot.isPending ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        'Stop'
                      )}
                    </button>
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                  <MetricCard
                    label="Detected"
                    value={selectedBotData.metrics.opportunitiesDetected}
                  />
                  <MetricCard
                    label="Executed"
                    value={selectedBotData.metrics.opportunitiesExecuted}
                  />
                  <MetricCard
                    label="Failed"
                    value={selectedBotData.metrics.opportunitiesFailed}
                    color="var(--color-error)"
                  />
                  <MetricCard
                    label="Profit (ETH)"
                    value={formatWei(selectedBotData.metrics.totalProfitWei)}
                    color="var(--color-success)"
                  />
                  <MetricCard
                    label="Profit (USD)"
                    value={`$${selectedBotData.metrics.totalProfitUsd}`}
                    color="var(--color-success)"
                  />
                  <MetricCard
                    label="Avg Execution"
                    value={`${selectedBotData.metrics.avgExecutionTimeMs.toFixed(0)}ms`}
                  />
                </div>

                {/* Strategy Breakdown */}
                <h3
                  className="text-lg font-bold mb-4 font-display"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Strategy Performance
                </h3>
                <div className="space-y-3">
                  {Object.entries(selectedBotData.metrics.byStrategy).map(
                    ([strategy, stats]) => {
                      const config = STRATEGY_LABELS[strategy] ?? {
                        label: strategy,
                        icon: '📊',
                      }
                      const successRate =
                        stats.detected > 0
                          ? Math.round((stats.executed / stats.detected) * 100)
                          : 0

                      return (
                        <div
                          key={strategy}
                          className="p-4 rounded-xl"
                          style={{ backgroundColor: 'var(--bg-secondary)' }}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span>{config.icon}</span>
                              <span
                                className="font-medium"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {config.label}
                              </span>
                            </div>
                            <span
                              className="text-sm font-mono"
                              style={{ color: 'var(--color-success)' }}
                            >
                              {formatWei(stats.profitWei)}
                            </span>
                          </div>
                          <div className="flex gap-4 text-sm">
                            <span style={{ color: 'var(--text-tertiary)' }}>
                              {stats.detected} detected
                            </span>
                            <span style={{ color: 'var(--text-tertiary)' }}>
                              {stats.executed} executed
                            </span>
                            <span style={{ color: 'var(--text-tertiary)' }}>
                              {successRate}% success
                            </span>
                          </div>
                        </div>
                      )
                    },
                  )}
                  {Object.keys(selectedBotData.metrics.byStrategy).length ===
                    0 && (
                    <p
                      className="text-center p-4"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      No strategy data yet
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div
                className="card-static p-12 text-center flex flex-col items-center justify-center min-h-[400px]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <div className="text-5xl mb-4">👈</div>
                <p>Select a bot to view details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface MetricCardProps {
  label: string
  value: string | number
  color?: string
}

function MetricCard({ label, value, color }: MetricCardProps) {
  return (
    <div
      className="p-4 rounded-xl"
      style={{ backgroundColor: 'var(--bg-secondary)' }}
    >
      <p className="text-sm mb-1" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </p>
      <p
        className="text-xl font-bold font-display tabular-nums"
        style={{ color: color ?? 'var(--text-primary)' }}
      >
        {value}
      </p>
    </div>
  )
}
