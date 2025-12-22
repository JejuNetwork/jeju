/**
 * TFMM Smart Pools Page
 */

export default function TFMMPage() {
  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          🎯 Smart Pools
        </h1>
        <p
          className="text-sm sm:text-base"
          style={{ color: 'var(--text-secondary)' }}
        >
          Auto-rebalancing pools powered by TFMM
        </p>
      </div>

      <div className="card p-6 border-purple-500/30 bg-gradient-to-r from-purple-500/10 to-blue-500/10 mb-6">
        <div className="flex items-start gap-4">
          <div className="text-3xl">🎯</div>
          <div>
            <h3
              className="font-semibold mb-1"
              style={{ color: 'var(--text-primary)' }}
            >
              Time-Weighted Function Market Maker
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Smart pools automatically adjust weights based on market trends,
              using Pyth, Chainlink, and TWAP oracles for optimal pricing.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="card p-4">
          <div
            className="text-xs mb-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Total TVL
          </div>
          <div
            className="text-xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            $4.19M
          </div>
        </div>
        <div className="card p-4">
          <div
            className="text-xs mb-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Active Pools
          </div>
          <div
            className="text-xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            3
          </div>
        </div>
        <div className="card p-4">
          <div
            className="text-xs mb-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            24h Volume
          </div>
          <div
            className="text-xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            $1.55M
          </div>
        </div>
        <div className="card p-4">
          <div
            className="text-xs mb-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Avg APY
          </div>
          <div className="text-xl font-bold text-green-400">12.0%</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="card p-5 hover:scale-[1.02] transition-transform cursor-pointer">
          <div className="flex items-start justify-between gap-2 mb-3">
            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>
              Momentum ETH/BTC
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs bg-purple-500/20 text-purple-400">
              momentum
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-sm mb-4">
            <div>
              <div
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                TVL
              </div>
              <div
                className="font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                $2.4M
              </div>
            </div>
            <div>
              <div
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                APY
              </div>
              <div className="font-semibold text-green-400">12.5%</div>
            </div>
            <div>
              <div
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                24h
              </div>
              <div
                className="font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                $890K
              </div>
            </div>
          </div>

          <button className="btn-primary w-full py-2.5">Add Liquidity</button>
        </div>

        <div className="card p-5 hover:scale-[1.02] transition-transform cursor-pointer">
          <div className="flex items-start justify-between gap-2 mb-3">
            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>
              Mean Reversion Stables
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">
              mean_reversion
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-sm mb-4">
            <div>
              <div
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                TVL
              </div>
              <div
                className="font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                $1.2M
              </div>
            </div>
            <div>
              <div
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                APY
              </div>
              <div className="font-semibold text-green-400">8.2%</div>
            </div>
            <div>
              <div
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                24h
              </div>
              <div
                className="font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                $450K
              </div>
            </div>
          </div>

          <button className="btn-primary w-full py-2.5">Add Liquidity</button>
        </div>
      </div>
    </div>
  )
}
