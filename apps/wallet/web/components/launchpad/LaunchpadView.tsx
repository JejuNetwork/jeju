/**
 * Launchpad View - Token creation and bonding curves
 */

import {
  DollarSign,
  Plus,
  RefreshCw,
  Rocket,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { formatUnits } from 'viem'
import {
  type BondingCurveInfo,
  type Launch,
  LaunchType,
  launchpadService,
} from '../../../api/services'

interface LaunchpadViewProps {
  address: Address
}

type TabType = 'trending' | 'create' | 'my-launches'

export function LaunchpadView({ address }: LaunchpadViewProps) {
  const [tab, setTab] = useState<TabType>('trending')
  const [launches, setLaunches] = useState<Launch[]>([])
  const [myLaunches, setMyLaunches] = useState<Launch[]>([])
  const [curveInfos, setCurveInfos] = useState<Map<string, BondingCurveInfo>>(
    new Map(),
  )
  const [isLoading, setIsLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    const [recent, mine] = await Promise.all([
      launchpadService.getRecentLaunches(20),
      launchpadService.getCreatorLaunches(address),
    ])
    setLaunches(recent)
    setMyLaunches(mine)

    // Fetch curve info for bonding curve launches
    const infos = new Map<string, BondingCurveInfo>()
    for (const launch of [...recent, ...mine]) {
      if (
        launch.launchType === LaunchType.BondingCurve &&
        launch.bondingCurve !== '0x0000000000000000000000000000000000000000'
      ) {
        const info = await launchpadService.getBondingCurveInfo(
          launch.bondingCurve,
        )
        if (info) infos.set(launch.bondingCurve, info)
      }
    }
    setCurveInfos(infos)
    setIsLoading(false)
  }, [address])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const renderLaunchCard = (launch: Launch) => {
    const curveInfo = curveInfos.get(launch.bondingCurve)
    const typeStr =
      launch.launchType === LaunchType.BondingCurve
        ? 'Bonding Curve'
        : 'ICO Presale'

    return (
      <div
        key={launch.id.toString()}
        className="bg-card border border-border rounded-xl p-4 hover:border-purple-500/50 transition-colors"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Rocket className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold">Launch #{launch.id.toString()}</p>
              <p className="text-xs text-muted-foreground">{typeStr}</p>
            </div>
          </div>
          <div
            className={`px-2 py-1 rounded-full text-xs font-medium ${
              launch.graduated
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-purple-500/20 text-purple-400'
            }`}
          >
            {launch.graduated ? '✅ Graduated' : '🔄 Active'}
          </div>
        </div>

        <div className="text-xs text-muted-foreground mb-3 font-mono truncate">
          Token: {launch.token}
        </div>

        {curveInfo && (
          <>
            <div className="w-full bg-secondary rounded-full h-2 mb-2">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all"
                style={{ width: `${curveInfo.progress}%` }}
              />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {curveInfo.progress}% to graduation
              </span>
              <span className="font-medium">
                {formatUnits(curveInfo.realEthReserves, 18)} ETH raised
              </span>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                className="flex-1 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium"
              >
                Buy
              </button>
              <button
                type="button"
                className="flex-1 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg text-sm font-medium"
              >
                Sell
              </button>
            </div>
          </>
        )}

        {!curveInfo && launch.launchType === LaunchType.ICOPresale && (
          <button
            type="button"
            className="w-full mt-4 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium"
          >
            Join Presale
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Rocket className="w-7 h-7 text-purple-400" />
              Token Launchpad
            </h2>
            <p className="text-muted-foreground">
              Create tokens with fair launch mechanics
            </p>
          </div>
          <button
            type="button"
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-xl disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Rocket className="w-4 h-4" />
              Total Launches
            </div>
            <div className="text-2xl font-bold mt-1">{launches.length}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <TrendingUp className="w-4 h-4" />
              Active
            </div>
            <div className="text-2xl font-bold mt-1">
              {launches.filter((l) => !l.graduated).length}
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Users className="w-4 h-4" />
              My Launches
            </div>
            <div className="text-2xl font-bold mt-1">{myLaunches.length}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <DollarSign className="w-4 h-4" />
              Graduated
            </div>
            <div className="text-2xl font-bold mt-1">
              {launches.filter((l) => l.graduated).length}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border pb-2">
          {[
            { id: 'trending' as const, label: 'Trending', icon: TrendingUp },
            { id: 'create' as const, label: 'Create Token', icon: Plus },
            {
              id: 'my-launches' as const,
              label: `My Launches (${myLaunches.length})`,
              icon: Users,
            },
          ].map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-secondary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Trending Tab */}
        {tab === 'trending' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoading ? (
              [1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="h-48 bg-secondary/50 rounded-xl animate-pulse"
                />
              ))
            ) : launches.length === 0 ? (
              <div className="col-span-full text-center py-12 bg-card border border-border rounded-xl">
                <Rocket className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No Launches Yet</h3>
                <p className="text-muted-foreground mt-2">
                  Be the first to launch a token
                </p>
                <button
                  type="button"
                  onClick={() => setTab('create')}
                  className="mt-4 px-6 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-xl"
                >
                  Create Token
                </button>
              </div>
            ) : (
              launches.map(renderLaunchCard)
            )}
          </div>
        )}

        {/* Create Tab */}
        {tab === 'create' && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-6">Launch Your Token</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Bonding Curve Option */}
              <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl p-6 hover:border-purple-500/50 transition-colors cursor-pointer">
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center mb-4">
                  <TrendingUp className="w-6 h-6 text-purple-400" />
                </div>
                <h4 className="text-lg font-semibold mb-2">Bonding Curve</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Pump.fun style fair launch. Price increases as more people
                  buy. Auto-graduates to AMM when target reached.
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 mb-4">
                  <li>✓ No presale, fair launch</li>
                  <li>✓ Automatic price discovery</li>
                  <li>✓ Graduates to LP</li>
                </ul>
                <button
                  type="button"
                  className="w-full px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium"
                >
                  Launch with Curve
                </button>
              </div>

              {/* ICO Option */}
              <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/30 rounded-xl p-6 hover:border-blue-500/50 transition-colors cursor-pointer">
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-blue-400" />
                </div>
                <h4 className="text-lg font-semibold mb-2">ICO Presale</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Traditional presale with fixed price. Set soft/hard caps,
                  vesting periods, and LP lock duration.
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 mb-4">
                  <li>✓ Fixed presale price</li>
                  <li>✓ Soft/hard cap goals</li>
                  <li>✓ LP locked after sale</li>
                </ul>
                <button
                  type="button"
                  className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium"
                >
                  Launch ICO
                </button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-6 text-center">
              Or use chat: "Launch MEME token with bonding curve"
            </p>
          </div>
        )}

        {/* My Launches Tab */}
        {tab === 'my-launches' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myLaunches.length === 0 ? (
              <div className="col-span-full text-center py-12 bg-card border border-border rounded-xl">
                <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No Launches Yet</h3>
                <p className="text-muted-foreground mt-2">
                  You haven't launched any tokens
                </p>
                <button
                  type="button"
                  onClick={() => setTab('create')}
                  className="mt-4 px-6 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-xl"
                >
                  Create Token
                </button>
              </div>
            ) : (
              myLaunches.map(renderLaunchCard)
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default LaunchpadView
