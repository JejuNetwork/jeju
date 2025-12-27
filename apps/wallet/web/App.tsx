import {
  Activity,
  ArrowDownToLine,
  AtSign,
  Check,
  Copy,
  Droplets,
  Image,
  type LucideIcon,
  Mail,
  Menu,
  MessageSquare,
  RefreshCw,
  Rocket,
  Send,
  Settings,
  Shield,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { ApprovalsView } from './components/approvals'
import { ChatInterface } from './components/chat'
import { LaunchpadView } from './components/launchpad'
import { MessagesView } from './components/messages'
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
  | 'messages'
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
  { id: 'messages', label: 'Messages', icon: Mail },
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
      case 'messages':
        return address ? (
          <MessagesView address={address} />
        ) : (
          <ConnectPrompt message="Connect to send and receive messages" />
        )
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
          <ConnectPrompt message="Connect to provide liquidity" />
        )
      case 'perps':
        return address ? (
          <PerpsView address={address} />
        ) : (
          <ConnectPrompt message="Connect to trade perps" />
        )
      case 'launchpad':
        return address ? (
          <LaunchpadView address={address} />
        ) : (
          <ConnectPrompt message="Connect to launch or buy tokens" />
        )
      case 'nfts':
        return address ? (
          <NFTGallery address={address} />
        ) : (
          <ConnectPrompt message="Connect to view your NFTs" />
        )
      case 'names':
        return address ? (
          <NamesView address={address} />
        ) : (
          <ConnectPrompt message="Connect to claim .jeju names" />
        )
      case 'approvals':
        return address ? (
          <ApprovalsView address={address} />
        ) : (
          <ConnectPrompt message="Connect to manage token approvals" />
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
        fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border
        transform transition-transform duration-300 ease-out
        lg:relative lg:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 animate-pulse-glow">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-lg font-bold gradient-text">{networkName}</h1>
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden p-2 rounded-lg hover:bg-accent"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav
            className="flex-1 p-3 space-y-1 overflow-y-auto"
            aria-label="Main navigation"
          >
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                onClick={() => {
                  setViewMode(id)
                  setIsSidebarOpen(false)
                }}
                aria-current={viewMode === id ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                  viewMode === id
                    ? 'bg-gradient-to-r from-emerald-600/20 to-teal-600/10 text-emerald-400 border border-emerald-500/30'
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
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground font-medium">
                    Total Balance
                  </span>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="p-1.5 hover:bg-accent rounded-lg transition-colors"
                    aria-label="Refresh balance"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${balancesLoading ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>
                <div className="text-2xl font-bold text-emerald-400">
                  {balancesLoading ? (
                    <span className="inline-block w-24 h-7 bg-emerald-500/20 rounded animate-pulse" />
                  ) : (
                    formatUsd(totalUsdValue)
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  {aggregatedBalances.length} asset
                  {aggregatedBalances.length !== 1 ? 's' : ''} across all chains
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
                    <p className="text-sm font-semibold flex items-center gap-1">
                      {chain?.name ?? 'Multi-Chain'}
                      <span className="text-emerald-400">✓</span>
                    </p>
                    <button
                      type="button"
                      onClick={copyAddress}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-mono group mt-0.5"
                      aria-label="Copy wallet address"
                    >
                      {address?.slice(0, 6)}...{address?.slice(-4)}
                      {copied ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                  </div>
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shadow-lg shadow-emerald-500/50" />
                </div>

                {/* Quick Actions */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setViewMode('chat')}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" /> Send
                  </button>
                  <button
                    type="button"
                    onClick={copyAddress}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-xl bg-secondary hover:bg-secondary/80 transition-colors"
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5" /> Receive
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="w-full px-4 py-2 text-xs font-medium rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground text-center mb-3">
                  Connect your wallet
                </p>
                {connectors.slice(0, 2).map((connector) => (
                  <button
                    type="button"
                    key={connector.id}
                    onClick={() => connect(connector.id)}
                    disabled={isConnecting}
                    className="w-full px-4 py-3 text-sm font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
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
              aria-current={viewMode === 'settings' ? 'page' : undefined}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                viewMode === 'settings'
                  ? 'bg-accent text-foreground'
                  : 'hover:bg-accent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Settings className="w-5 h-5" />
              <span className="text-sm font-medium">Settings</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {isSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden cursor-default"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-card safe-area-top">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 rounded-xl hover:bg-accent transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md shadow-emerald-500/20">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold">{networkName}</span>
          </div>
          {isConnected ? (
            <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg">
              {formatUsd(totalUsdValue)}
            </span>
          ) : (
            <div className="w-10" />
          )}
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
      <ConnectPrompt message="See all your assets across every chain in one view" />
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
          <h3 className="font-semibold mb-4">Why Use This Wallet?</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                emoji: '⚡',
                title: 'Bridgeless',
                desc: 'Move tokens instantly',
              },
              { emoji: '🔗', title: 'Multi-Chain', desc: 'One unified view' },
              { emoji: '🤖', title: 'AI Agent', desc: 'Just ask for it' },
              { emoji: '🛡️', title: 'Secure', desc: 'Preview before signing' },
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
