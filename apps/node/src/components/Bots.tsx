import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  Droplets,
  Eye,
  Percent,
  Play,
  Shuffle,
  Square,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../store'
import type { BotWithStatus } from '../types'
import { formatEther } from '../utils'

const botIcons: Record<string, React.ReactNode> = {
  dex_arb: <Shuffle size={20} />,
  cross_chain_arb: <Zap size={20} />,
  sandwich: <Target size={20} />,
  liquidation: <Droplets size={20} />,
  oracle_keeper: <Eye size={20} />,
  solver: <TrendingUp size={20} />,
}

const riskColors: Record<string, string> = {
  Low: 'text-green-400 bg-green-400/10',
  Medium: 'text-yellow-400 bg-yellow-400/10',
  High: 'text-red-400 bg-red-400/10',
}

export function Bots() {
  const { bots, startBot, stopBot, wallet } = useAppStore()
  const [expandedBot, setExpandedBot] = useState<string | null>(null)
  const [startingBot, setStartingBot] = useState<string | null>(null)
  const [capitalAmount, setCapitalAmount] = useState('0.1')
  const [error, setError] = useState<string | null>(null)

  const handleStartBot = async (bot: BotWithStatus) => {
    if (!wallet) {
      alert('Please connect a wallet first')
      return
    }

    if (bot.metadata.id === 'sandwich') {
      const confirmed = confirm(
        'Sandwich attacks are controversial. By enabling this bot, you acknowledge that:\n\n' +
          '1. This is a legal MEV extraction strategy\n' +
          '2. 50% of profits go to the network treasury\n' +
          '3. This helps keep MEV within the network instead of being extracted by external actors\n\n' +
          'Do you want to proceed?',
      )
      if (!confirmed) return
    }

    setStartingBot(bot.metadata.id)
    setCapitalAmount(bot.metadata.min_capital_eth.toString())
    setError(null)
  }

  const handleConfirmStart = async () => {
    if (!startingBot) return

    // Validate capital amount
    if (!/^\d+(\.\d+)?$/.test(capitalAmount)) {
      setError('Invalid amount')
      return
    }

    const bot = bots.find((b) => b.metadata.id === startingBot)
    const amount = parseFloat(capitalAmount)

    if (bot && amount < bot.metadata.min_capital_eth) {
      setError(`Minimum capital is ${bot.metadata.min_capital_eth} ETH`)
      return
    }

    try {
      const capitalWei = (amount * 1e18).toString() // Safe due to regex check above
      await startBot(startingBot, capitalWei)
      setStartingBot(null)
      setCapitalAmount('0.1')
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleStopBot = async (botId: string) => {
    await stopBot(botId)
  }

  const totalProfit = bots.reduce((acc, bot) => {
    const profit = parseFloat(bot.status.net_profit_wei) || 0
    return acc + profit
  }, 0)

  const runningBots = bots.filter((b) => b.status.running)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Trading Bots</h1>
        <p className="text-volcanic-400 mt-1">
          Automated strategies that earn profits with 50/50 treasury split
        </p>
      </div>

      {/* Summary Card */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-volcanic-400">Active Bots</p>
            <p className="text-2xl font-bold">
              {runningBots.length} / {bots.length}
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">Total Net Profit</p>
            <p className="text-2xl font-bold text-jeju-400">
              {formatEther(totalProfit.toString())} ETH
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">Treasury Contribution</p>
            <p className="text-2xl font-bold text-purple-400">
              {formatEther(totalProfit.toString())} ETH
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">Opportunities Executed</p>
            <p className="text-2xl font-bold">
              {bots.reduce(
                (acc, b) => acc + b.status.opportunities_executed,
                0,
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Treasury Split Notice */}
      <div className="card bg-purple-500/10 border-purple-500/30">
        <div className="flex items-start gap-3">
          <Percent size={20} className="text-purple-400 mt-0.5" />
          <div>
            <h3 className="font-semibold text-purple-300">
              50/50 Treasury Split
            </h3>
            <p className="text-sm text-purple-200/70 mt-1">
              All bot profits are split 50/50 with the network treasury. This
              funds network operations, reduces fees for users, and rewards
              stakers. By keeping MEV within the network, we prevent value
              extraction by external actors.
            </p>
          </div>
        </div>
      </div>

      {/* Bots Grid */}
      <div className="space-y-4">
        {bots.map((bot) => (
          <motion.div
            key={bot.metadata.id}
            layout
            className={clsx(
              'card transition-all duration-200',
              bot.status.running &&
                'border-jeju-500/50 shadow-lg shadow-jeju-500/10',
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div
                  className={clsx(
                    'p-3 rounded-xl',
                    bot.status.running
                      ? 'bg-jeju-600/20 text-jeju-400'
                      : 'bg-volcanic-800 text-volcanic-400',
                  )}
                >
                  {botIcons[bot.metadata.id] || <Bot size={20} />}
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{bot.metadata.name}</h3>
                    <span
                      className={clsx(
                        'px-2 py-0.5 text-xs rounded',
                        riskColors[bot.metadata.risk_level],
                      )}
                    >
                      {bot.metadata.risk_level} Risk
                    </span>
                    {bot.status.running && <span className="status-healthy" />}
                  </div>

                  <p className="text-sm text-volcanic-400 mt-1 max-w-xl">
                    {bot.metadata.description}
                  </p>

                  <div className="flex items-center gap-4 mt-3 text-sm">
                    <span className="text-volcanic-500">
                      Min Capital: {bot.metadata.min_capital_eth} ETH
                    </span>
                    <span className="text-purple-400">
                      {bot.metadata.treasury_split_percent}% to treasury
                    </span>
                  </div>

                  {/* Warnings */}
                  {bot.metadata.warnings.length > 0 &&
                    expandedBot === bot.metadata.id && (
                      <div className="mt-3 p-3 bg-volcanic-800/50 rounded-lg space-y-1">
                        {bot.metadata.warnings.map((warning, i) => (
                          <p key={i} className="text-sm text-volcanic-400">
                            {warning}
                          </p>
                        ))}
                      </div>
                    )}

                  {/* Running Stats */}
                  {bot.status.running && (
                    <div className="flex items-center gap-6 mt-3 text-sm">
                      <span className="text-volcanic-400">
                        Detected: {bot.status.opportunities_detected}
                      </span>
                      <span className="text-volcanic-400">
                        Executed: {bot.status.opportunities_executed}
                      </span>
                      <span className="text-jeju-400">
                        Net Profit: {formatEther(bot.status.net_profit_wei)} ETH
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {bot.metadata.warnings.length > 0 && (
                  <button
                    onClick={() =>
                      setExpandedBot(
                        expandedBot === bot.metadata.id
                          ? null
                          : bot.metadata.id,
                      )
                    }
                    className="btn-ghost p-2"
                  >
                    {expandedBot === bot.metadata.id ? (
                      <ChevronUp size={18} />
                    ) : (
                      <ChevronDown size={18} />
                    )}
                  </button>
                )}

                {bot.status.running ? (
                  <button
                    onClick={() => handleStopBot(bot.metadata.id)}
                    className="btn btn-danger flex items-center gap-2"
                  >
                    <Square size={16} />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => handleStartBot(bot)}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    <Play size={16} />
                    Start
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Start Bot Modal */}
      <AnimatePresence>
        {startingBot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-volcanic-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setStartingBot(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="card max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold mb-4">
                Configure{' '}
                {bots.find((b) => b.metadata.id === startingBot)?.metadata.name}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="label">Capital Allocation (ETH)</label>
                  <input
                    type="number"
                    value={capitalAmount}
                    onChange={(e) => {
                      setCapitalAmount(e.target.value)
                      setError(null)
                    }}
                    className={clsx(
                      'input',
                      error && 'border-red-500 focus:border-red-500',
                    )}
                    step="0.01"
                    min={
                      bots.find((b) => b.metadata.id === startingBot)?.metadata
                        .min_capital_eth || 0
                    }
                  />
                  {error ? (
                    <p className="text-xs text-red-400 mt-1">{error}</p>
                  ) : (
                    <p className="text-xs text-volcanic-500 mt-1">
                      Minimum:{' '}
                      {
                        bots.find((b) => b.metadata.id === startingBot)
                          ?.metadata.min_capital_eth
                      }{' '}
                      ETH
                    </p>
                  )}
                </div>

                <div className="bg-volcanic-800/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm text-volcanic-400">
                    <AlertTriangle size={14} />
                    <span>50% of profits will go to network treasury</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setStartingBot(null)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmStart}
                  className="btn-primary flex-1"
                >
                  Start Bot
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
