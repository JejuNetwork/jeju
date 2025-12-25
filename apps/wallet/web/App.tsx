import {
  Activity,
  ArrowDownToLine,
  AtSign,
  Check,
  Copy,
  Droplets,
  Image,
  type LucideIcon,
  Menu,
  MessageSquare,
  RefreshCw,
  Rocket,
  Send,
  Settings,
  Shield,
  Wallet,
  X,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { ApprovalsView } from './components/approvals'
import { ChatInterface } from './components/chat'
import { LaunchpadView } from './components/launchpad'
import { NamesView } from './components/names'
import { NFTGallery } from './components/nft'
import { PerpsView } from './components/perps'
import { PoolsView } from './components/pools'
import { SettingsView } from './components/settings'
import { getNetworkName } from './config/branding'
import {
  formatTokenAmount,
  formatUsd,
  useMultiChainBalances,
  useWallet,
} from './hooks/useWallet'

const networkName = getNetworkName()

type ViewMode =
  | 'chat'
  | 'portfolio'
  | 'nfts'
  | 'approvals'
  | 'settings'
  | 'pools'
  | 'perps'
  | 'launchpad'
  | 'names'

interface NavItem {
  id: ViewMode
  label: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'portfolio', label: 'Portfolio', icon: Wallet },
  { id: 'pools', label: 'Pools', icon: Droplets },
  { id: 'perps', label: 'Perps', icon: Activity },
  { id: 'launchpad', label: 'Launch', icon: Rocket },
  { id: 'nfts', label: 'NFTs', icon: Image },
  { id: 'names', label: 'Names', icon: AtSign },
  { id: 'approvals', label: 'Security', icon: Shield },
]

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('chat')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const {
    isConnected,
    isConnecting,
    address,
    chain,
    connect,
    disconnect,
    connectors,
  } = useWallet()
  const {
    aggregatedBalances,
    totalUsdValue,
    isLoading: balancesLoading,
    refetch,
  } = useMultiChainBalances(address)

  const handleActionCompleted = useCallback(() => {
    refetch()
  }, [refetch])

  const copyAddress = useCallback(() => {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [address])

  const renderView = () => {
    switch (viewMode) {
      case 'chat':
        return <ChatInterface onActionCompleted={handleActionCompleted} />
      case 'portfolio':
        return (
          <PortfolioView
            isConnected={isConnected}
            address={address}
            aggregatedBalances={aggregatedBalances}
            totalUsdValue={totalUsdValue}
            balancesLoading={balancesLoading}
            onRefresh={refetch}
          />
        )
      case 'pools':
        return address ? (
          <PoolsView address={address} />
        ) : (
          <ConnectPrompt message="Connect your wallet to manage liquidity pools" />
        )
      case 'perps':
        return address ? (
          <PerpsView address={address} />
        ) : (
          <ConnectPrompt message="Connect your wallet to trade perpetuals" />
        )
      case 'launchpad':
        return address ? (
          <LaunchpadView address={address} />
        ) : (
          <ConnectPrompt message="Connect your wallet to launch or buy tokens" />
        )
      case 'nfts':
        return address ? (
          <NFTGallery address={address} />
        ) : (
          <ConnectPrompt message="Connect your wallet to view your NFTs" />
        )
      case 'names':
        return address ? (
          <NamesView address={address} />
        ) : (
          <ConnectPrompt message="Connect your wallet to register .jeju names" />
        )
      case 'approvals':
        return address ? (
          <ApprovalsView address={address} />
        ) : (
          <ConnectPrompt message="Connect your wallet to manage security" />
        )
      case 'settings':
        return <SettingsView />
      default:
        return null
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border
        transform transition-transform duration-200 ease-in-out
        lg:relative lg:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <span className="text-xl font-bold text-white">J</span>
              </div>
              <div>
                <h1 className="text-lg font-semibold">{networkName}</h1>
                <p className="text-xs text-muted-foreground">Agentic Wallet</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden p-2 rounded-lg hover:bg-accent"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                onClick={() => {
                  setViewMode(id)
                  setIsSidebarOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  viewMode === id
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{label}</span>
              </button>
            ))}
          </nav>

          {/* Quick Balance */}
          {isConnected && (
            <div className="p-4 border-t border-border">
              <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 rounded-xl p-4 border border-emerald-500/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">
                    Portfolio Value
                  </span>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="p-1 hover:bg-accent rounded"
                    title="Refresh"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${balancesLoading ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>
                <div className="text-2xl font-bold text-emerald-400">
                  {balancesLoading ? '...' : formatUsd(totalUsdValue)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {aggregatedBalances.length} token
                  {aggregatedBalances.length !== 1 ? 's' : ''} • All chains
                </div>
              </div>
            </div>
          )}

          {/* Wallet Status */}
          <div className="p-4 border-t border-border">
            {isConnected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {chain?.name ?? 'Multi-Chain'}
                    </p>
                    <button
                      type="button"
                      onClick={copyAddress}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-mono group"
                    >
                      {address?.slice(0, 6)}...{address?.slice(-4)}
                      {copied ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                  </div>
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>

                {/* Quick Actions */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setViewMode('chat')}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  >
                    <Send className="w-3 h-3" /> Send
                  </button>
                  <button
                    type="button"
                    onClick={copyAddress}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs rounded-lg bg-secondary hover:bg-secondary/80"
                  >
                    <ArrowDownToLine className="w-3 h-3" /> Receive
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="w-full px-4 py-2 text-xs rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {connectors.slice(0, 2).map((connector) => (
                  <button
                    type="button"
                    key={connector.id}
                    onClick={() => connect(connector.id)}
                    disabled={isConnecting}
                    className="w-full px-4 py-2.5 text-sm font-medium rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                  >
                    {connector.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="p-4 border-t border-border">
            <button
              type="button"
              onClick={() => {
                setViewMode('settings')
                setIsSidebarOpen(false)
              }}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                viewMode === 'settings'
                  ? 'bg-accent text-foreground'
                  : 'hover:bg-accent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Settings className="w-5 h-5" />
              <span className="text-sm">Settings</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {isSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden cursor-default"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-card">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-accent"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <span className="text-sm font-bold text-white">J</span>
            </div>
            <span className="font-semibold">{networkName}</span>
          </div>
          {isConnected && (
            <span className="text-xs font-medium text-emerald-400">
              {formatUsd(totalUsdValue)}
            </span>
          )}
          {!isConnected && <div className="w-10" />}
        </header>

        {/* Content */}
        <div className="flex-1 overflow-hidden">{renderView()}</div>
      </main>
    </div>
  )
}

function ConnectPrompt({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-6 shadow-xl shadow-emerald-500/20">
        <Wallet className="w-10 h-10 text-white" />
      </div>
      <h2 className="text-2xl font-semibold mb-2">Connect Your Wallet</h2>
      <p className="text-muted-foreground text-center max-w-md">{message}</p>
    </div>
  )
}

interface AggregatedBalance {
  symbol: string
  totalBalance: bigint
  totalUsdValue: number
  chains: Array<{
    token: { chainId: number; name: string }
    balance: bigint
    usdValue: number
  }>
}

interface PortfolioViewProps {
  isConnected: boolean
  address?: string
  aggregatedBalances: AggregatedBalance[]
  totalUsdValue: number
  balancesLoading: boolean
  onRefresh: () => void
}

function PortfolioView({
  isConnected,
  address,
  aggregatedBalances,
  totalUsdValue,
  balancesLoading,
  onRefresh,
}: PortfolioViewProps) {
  if (!isConnected) {
    return (
      <ConnectPrompt message="View your unified portfolio across all chains. No chain switching required." />
    )
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Portfolio</h2>
            <p className="text-muted-foreground">
              {address?.slice(0, 6)}...{address?.slice(-4)} • All chains
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={balancesLoading}
            className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-xl disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${balancesLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>

        {/* Total Value */}
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 p-8">
          <p className="text-sm text-muted-foreground mb-2">
            Total Portfolio Value
          </p>
          <div className="text-5xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {formatUsd(totalUsdValue)}
          </div>
          <p className="text-sm text-muted-foreground mt-3">
            {aggregatedBalances.length} token
            {aggregatedBalances.length !== 1 ? 's' : ''} across{' '}
            {aggregatedBalances.reduce((sum, a) => sum + a.chains.length, 0)}{' '}
            chain
            {aggregatedBalances.reduce((sum, a) => sum + a.chains.length, 0) !==
            1
              ? 's'
              : ''}
          </p>
        </div>

        {/* Token Balances */}
        <div className="rounded-2xl bg-card border border-border">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Assets</h3>
          </div>

          {balancesLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-20 bg-secondary/50 rounded-xl animate-pulse"
                />
              ))}
            </div>
          ) : aggregatedBalances.length > 0 ? (
            <div className="divide-y divide-border">
              {aggregatedBalances.map((agg) => (
                <div
                  key={agg.symbol}
                  className="p-4 hover:bg-secondary/30 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
                        <span className="text-sm font-bold text-emerald-400">
                          {agg.symbol.slice(0, 2)}
                        </span>
                      </div>
                      <div>
                        <p className="font-semibold">{agg.symbol}</p>
                        <p className="text-xs text-muted-foreground">
                          {agg.chains.length} chain
                          {agg.chains.length > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {formatUsd(agg.totalUsdValue)}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {formatTokenAmount(agg.totalBalance)} {agg.symbol}
                      </p>
                    </div>
                  </div>

                  {agg.chains.length > 1 && (
                    <div className="mt-3 pl-13 space-y-2">
                      {agg.chains.map((c) => (
                        <div
                          key={`${agg.symbol}-${c.token.chainId}-${c.token.name}`}
                          className="flex items-center justify-between text-sm py-1"
                        >
                          <span className="text-muted-foreground">
                            {c.token.name}
                          </span>
                          <div className="text-right">
                            <span className="text-muted-foreground">
                              {formatUsd(c.usdValue)}
                            </span>
                            <span className="ml-2 font-mono text-xs">
                              {formatTokenAmount(c.balance)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center">
              <p className="text-muted-foreground">
                No assets found across any chain.
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Deposit tokens to get started.
              </p>
            </div>
          )}
        </div>

        {/* Features */}
        <div className="rounded-2xl bg-card border border-border p-6">
          <h3 className="font-semibold mb-4">Why Network?</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { emoji: '⚡', title: 'Bridgeless', desc: 'No manual bridging' },
              { emoji: '🔗', title: 'Multi-Chain', desc: 'All chains unified' },
              { emoji: '🤖', title: 'AI Agent', desc: 'Chat to transact' },
              { emoji: '🛡️', title: 'Secure', desc: 'Transaction preview' },
            ].map(({ emoji, title, desc }) => (
              <div
                key={title}
                className="text-center p-4 rounded-xl bg-secondary/30"
              >
                <div className="text-2xl mb-2">{emoji}</div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
