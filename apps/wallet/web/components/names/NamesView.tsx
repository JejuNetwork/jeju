/**
 * Names View - JNS Name Service
 */

import {
  AtSign,
  CheckCircle,
  Clock,
  ExternalLink,
  Globe,
  RefreshCw,
  Search,
  Server,
  Settings,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  type JNSName,
  type JNSPricing,
  type JNSResolution,
  jnsService,
} from '../../../api/services'
import { useJnsResolver } from '../../hooks/useJnsResolver'

interface NamesViewProps {
  address: string
}

type TabType = 'search' | 'my-names' | 'resolve' | 'settings'

export function NamesView({ address }: NamesViewProps) {
  const [tab, setTab] = useState<TabType>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<JNSPricing | null>(null)
  const [resolvedName, setResolvedName] = useState<JNSName | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [years, setYears] = useState(1)
  const [myPrimaryName, setMyPrimaryName] = useState<string | null>(null)

  // Gateway resolver state
  const [resolveQuery, setResolveQuery] = useState('')
  const [gatewayResolution, setGatewayResolution] =
    useState<JNSResolution | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [resolveError, setResolveError] = useState('')

  // JNS resolver hook
  const {
    settings,
    isLoading: settingsLoading,
    gatewayStatus,
    resolve: resolveViaGateway,
    updateSettings,
    clearCache,
    checkStatus,
    getRedirectUrl,
  } = useJnsResolver()

  // Fetch primary name on mount
  useEffect(() => {
    jnsService.reverseLookup(address as `0x${string}`).then(setMyPrimaryName)
  }, [address])

  // Check gateway status on mount and when switching to settings tab
  useEffect(() => {
    if (tab === 'settings' || tab === 'resolve') {
      checkStatus()
    }
  }, [tab, checkStatus])

  const handleSearch = useCallback(async () => {
    if (!searchQuery || searchQuery.length < 3) {
      setSearchError('Name must be at least 3 characters')
      return
    }

    setIsSearching(true)
    setSearchError('')
    setSearchResult(null)
    setResolvedName(null)

    const name = searchQuery.replace('.jeju', '')

    // First check if it's already registered
    const info = await jnsService.getNameInfo(name)
    if (info) {
      setResolvedName(info)
    } else {
      // Get pricing for registration
      const pricing = await jnsService.getPrice(name, years)
      setSearchResult(pricing)
    }

    setIsSearching(false)
  }, [searchQuery, years])

  const handleGatewayResolve = useCallback(async () => {
    if (!resolveQuery) {
      setResolveError('Enter a domain to resolve')
      return
    }

    setIsResolving(true)
    setResolveError('')
    setGatewayResolution(null)

    const domain = resolveQuery.endsWith('.jeju')
      ? resolveQuery
      : `${resolveQuery}.jeju`

    const result = await resolveViaGateway(domain)
    if (result) {
      setGatewayResolution(result)
    } else {
      setResolveError('Domain not found or resolution failed')
    }

    setIsResolving(false)
  }, [resolveQuery, resolveViaGateway])

  const handleOpenResolved = useCallback(() => {
    if (!gatewayResolution) return
    const url = getRedirectUrl(gatewayResolution)
    window.open(url, '_blank')
  }, [gatewayResolution, getRedirectUrl])

  const formatPrice = (price: bigint) => {
    return (Number(price) / 1e18).toFixed(4)
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center mb-4 shadow-xl shadow-teal-500/20">
            <AtSign className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold">Network Name Service</h2>
          <p className="text-muted-foreground mt-1">
            Register .jeju names for your wallet
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 justify-center border-b border-border pb-2 flex-wrap">
          {[
            { id: 'search' as const, label: 'Register', icon: Search },
            { id: 'resolve' as const, label: 'Resolve', icon: Globe },
            { id: 'my-names' as const, label: 'My Names', icon: AtSign },
            { id: 'settings' as const, label: 'Settings', icon: Settings },
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

        {/* Search Tab */}
        {tab === 'search' && (
          <div className="space-y-6">
            {/* Search Box */}
            <div className="bg-card border border-border rounded-2xl p-6">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) =>
                      setSearchQuery(
                        e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                      )
                    }
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search for a name..."
                    className="w-full px-4 py-3 pr-16 bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground">
                    .jeju
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={isSearching || searchQuery.length < 3}
                  className="px-6 py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-medium disabled:opacity-50"
                >
                  {isSearching ? 'Searching...' : 'Search'}
                </button>
              </div>

              {searchError && (
                <p className="text-red-400 text-sm mt-2">{searchError}</p>
              )}
            </div>

            {/* Search Result - Available */}
            {searchResult && (
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  {searchResult.available ? (
                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-400" />
                  )}
                  <div>
                    <h3 className="text-xl font-bold">
                      {searchResult.name}.jeju
                    </h3>
                    <p
                      className={
                        searchResult.available
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }
                    >
                      {searchResult.available
                        ? 'Available'
                        : 'Already registered'}
                    </p>
                  </div>
                </div>

                {searchResult.available && (
                  <>
                    <div className="bg-secondary/50 rounded-xl p-4 mb-4">
                      <div className="flex justify-between mb-2">
                        <span className="text-muted-foreground">
                          Registration Period
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setYears(Math.max(1, years - 1))}
                            className="w-8 h-8 rounded bg-secondary hover:bg-secondary/80"
                          >
                            -
                          </button>
                          <span className="w-12 text-center font-medium">
                            {years} yr{years > 1 ? 's' : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => setYears(Math.min(10, years + 1))}
                            className="w-8 h-8 rounded bg-secondary hover:bg-secondary/80"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="flex justify-between text-lg">
                        <span className="text-muted-foreground">Price</span>
                        <span className="font-bold">
                          {formatPrice(searchResult.price)} ETH
                        </span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground mt-1">
                        <span>Per year</span>
                        <span>
                          {formatPrice(searchResult.pricePerYear)} ETH/year
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="w-full px-6 py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-medium"
                    >
                      Register {searchResult.name}.jeju
                    </button>

                    <p className="text-xs text-muted-foreground mt-4 text-center">
                      Or use chat: "Register {searchResult.name}.jeju for{' '}
                      {years} year{years > 1 ? 's' : ''}"
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Search Result - Resolved Name */}
            {resolvedName && (
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle className="w-6 h-6 text-blue-400" />
                  <div>
                    <h3 className="text-xl font-bold">{resolvedName.name}</h3>
                    <p className="text-blue-400">Already registered</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Owner</span>
                    <span className="font-mono text-sm">
                      {resolvedName.owner.slice(0, 10)}...
                      {resolvedName.owner.slice(-8)}
                    </span>
                  </div>
                  {resolvedName.address && (
                    <div className="flex justify-between py-2 border-b border-border">
                      <span className="text-muted-foreground">Points to</span>
                      <span className="font-mono text-sm">
                        {resolvedName.address.slice(0, 10)}...
                        {resolvedName.address.slice(-8)}
                      </span>
                    </div>
                  )}
                  {resolvedName.description && (
                    <div className="flex justify-between py-2 border-b border-border">
                      <span className="text-muted-foreground">Description</span>
                      <span className="text-sm">
                        {resolvedName.description}
                      </span>
                    </div>
                  )}
                  {resolvedName.expiresAt && (
                    <div className="flex justify-between py-2">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        Expires
                      </span>
                      <span className="text-sm">
                        {new Date(resolvedName.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pricing Info */}
            <div className="bg-gradient-to-br from-teal-500/10 to-emerald-500/10 border border-teal-500/20 rounded-2xl p-6">
              <h3 className="font-semibold mb-4">Pricing</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-teal-400">
                    0.1 ETH
                  </div>
                  <div className="text-xs text-muted-foreground">
                    3 characters/year
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-teal-400">
                    0.01 ETH
                  </div>
                  <div className="text-xs text-muted-foreground">
                    4 characters/year
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-teal-400">
                    0.001 ETH
                  </div>
                  <div className="text-xs text-muted-foreground">
                    5+ characters/year
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Resolve Tab - Gateway Resolution */}
        {tab === 'resolve' && (
          <div className="space-y-6">
            {/* Gateway Status */}
            <div className="bg-card border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Gateway Status</h3>
                <button
                  type="button"
                  onClick={checkStatus}
                  className="p-2 hover:bg-secondary rounded-lg"
                  title="Refresh status"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3 p-3 bg-secondary/50 rounded-xl">
                  <Server className="w-5 h-5 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Local Node</p>
                    <p className="text-xs text-muted-foreground">
                      {gatewayStatus?.localDwsLatency
                        ? `${gatewayStatus.localDwsLatency}ms`
                        : 'Not checked'}
                    </p>
                  </div>
                  <div
                    className={`w-3 h-3 rounded-full ${
                      gatewayStatus?.localDws === 'online'
                        ? 'bg-emerald-500'
                        : 'bg-red-500'
                    }`}
                  />
                </div>
                <div className="flex items-center gap-3 p-3 bg-secondary/50 rounded-xl">
                  <Globe className="w-5 h-5 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Public Gateway</p>
                    <p className="text-xs text-muted-foreground">
                      {gatewayStatus?.publicGatewayLatency
                        ? `${gatewayStatus.publicGatewayLatency}ms`
                        : 'Not checked'}
                    </p>
                  </div>
                  <div
                    className={`w-3 h-3 rounded-full ${
                      gatewayStatus?.publicGateway === 'online'
                        ? 'bg-emerald-500'
                        : 'bg-red-500'
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Quick Lookup */}
            <div className="bg-card border border-border rounded-2xl p-6">
              <h3 className="font-semibold mb-4">Resolve Domain</h3>
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={resolveQuery}
                    onChange={(e) =>
                      setResolveQuery(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9.-]/g, ''),
                      )
                    }
                    onKeyDown={(e) =>
                      e.key === 'Enter' && handleGatewayResolve()
                    }
                    placeholder="example.jeju"
                    className="w-full px-4 py-3 bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleGatewayResolve}
                  disabled={isResolving || !resolveQuery}
                  className="px-6 py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-medium disabled:opacity-50"
                >
                  {isResolving ? 'Resolving...' : 'Resolve'}
                </button>
              </div>

              {resolveError && (
                <p className="text-red-400 text-sm mt-2">{resolveError}</p>
              )}
            </div>

            {/* Resolution Result */}
            {gatewayResolution && (
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                    <div>
                      <h3 className="text-xl font-bold">
                        {gatewayResolution.domain}
                      </h3>
                      <p className="text-emerald-400 text-sm">Resolved</p>
                    </div>
                  </div>
                  {(gatewayResolution.workerEndpoint ||
                    gatewayResolution.ipfsHash) && (
                    <button
                      type="button"
                      onClick={handleOpenResolved}
                      className="flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open
                    </button>
                  )}
                </div>

                <div className="space-y-3 font-mono text-sm">
                  {gatewayResolution.ipfsHash && (
                    <div className="flex flex-col gap-1 py-2 border-b border-border">
                      <span className="text-muted-foreground text-xs">
                        IPFS Hash
                      </span>
                      <span className="break-all">
                        {gatewayResolution.ipfsHash}
                      </span>
                    </div>
                  )}
                  {gatewayResolution.workerEndpoint && (
                    <div className="flex flex-col gap-1 py-2 border-b border-border">
                      <span className="text-muted-foreground text-xs">
                        Worker Endpoint
                      </span>
                      <span className="break-all">
                        {gatewayResolution.workerEndpoint}
                      </span>
                    </div>
                  )}
                  {gatewayResolution.address && (
                    <div className="flex flex-col gap-1 py-2 border-b border-border">
                      <span className="text-muted-foreground text-xs">
                        Address
                      </span>
                      <span className="break-all">
                        {gatewayResolution.address}
                      </span>
                    </div>
                  )}
                  {gatewayResolution.contenthash && (
                    <div className="flex flex-col gap-1 py-2 border-b border-border">
                      <span className="text-muted-foreground text-xs">
                        Contenthash
                      </span>
                      <span className="break-all">
                        {gatewayResolution.contenthash}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col gap-1 py-2">
                    <span className="text-muted-foreground text-xs">
                      Resolved via
                    </span>
                    <span className="break-all">
                      {gatewayResolution.resolvedVia}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Info */}
            <div className="bg-gradient-to-br from-teal-500/10 to-emerald-500/10 border border-teal-500/20 rounded-2xl p-6">
              <h3 className="font-semibold mb-2">About JNS Resolution</h3>
              <p className="text-sm text-muted-foreground">
                The Jeju Name Service (JNS) resolves .jeju domains to content
                hosted on IPFS or worker endpoints. You can configure your local
                DWS node in Settings for faster resolution.
              </p>
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {tab === 'settings' && (
          <div className="space-y-6">
            {settingsLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <>
                {/* Enable Toggle */}
                <div className="bg-card border border-border rounded-2xl p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">Enable JNS Resolution</h3>
                      <p className="text-sm text-muted-foreground">
                        Resolve .jeju domains automatically
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateSettings({ enabled: !settings?.enabled })
                      }
                      className={`w-12 h-6 rounded-full transition-colors ${
                        settings?.enabled ? 'bg-teal-500' : 'bg-secondary'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white transition-transform ${
                          settings?.enabled
                            ? 'translate-x-6'
                            : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Prefer Local Toggle */}
                <div className="bg-card border border-border rounded-2xl p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">Prefer Local Node</h3>
                      <p className="text-sm text-muted-foreground">
                        Use local DWS node when available
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateSettings({ preferLocal: !settings?.preferLocal })
                      }
                      className={`w-12 h-6 rounded-full transition-colors ${
                        settings?.preferLocal ? 'bg-teal-500' : 'bg-secondary'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white transition-transform ${
                          settings?.preferLocal
                            ? 'translate-x-6'
                            : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Gateway URLs */}
                <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
                  <h3 className="font-semibold">Gateway URLs</h3>

                  <div>
                    <label className="text-sm text-muted-foreground block mb-2">
                      Local DWS URL
                    </label>
                    <input
                      type="text"
                      value={settings?.localDwsUrl ?? ''}
                      onChange={(e) =>
                        updateSettings({ localDwsUrl: e.target.value })
                      }
                      className="w-full px-4 py-2 bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground block mb-2">
                      Public Gateway URL
                    </label>
                    <input
                      type="text"
                      value={settings?.gatewayUrl ?? ''}
                      onChange={(e) =>
                        updateSettings({ gatewayUrl: e.target.value })
                      }
                      className="w-full px-4 py-2 bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground block mb-2">
                      IPFS Gateway URL
                    </label>
                    <input
                      type="text"
                      value={settings?.ipfsGateway ?? ''}
                      onChange={(e) =>
                        updateSettings({ ipfsGateway: e.target.value })
                      }
                      className="w-full px-4 py-2 bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono text-sm"
                    />
                  </div>
                </div>

                {/* Cache Management */}
                <div className="bg-card border border-border rounded-2xl p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">Clear Resolution Cache</h3>
                      <p className="text-sm text-muted-foreground">
                        Remove cached domain resolutions
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={clearCache}
                      className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-xl text-sm"
                    >
                      Clear Cache
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* My Names Tab */}
        {tab === 'my-names' &&
          (myPrimaryName ? (
            <div className="bg-card border border-border rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-4">Your Primary Name</h3>
              <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-teal-500/10 to-emerald-500/10 rounded-xl border border-teal-500/20">
                <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center">
                  <AtSign className="w-6 h-6 text-teal-400" />
                </div>
                <div>
                  <p className="text-xl font-bold">{myPrimaryName}</p>
                  <p className="text-sm text-muted-foreground font-mono">
                    {address.slice(0, 10)}...{address.slice(-8)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 bg-card border border-border rounded-2xl">
              <AtSign className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No Names Registered</h3>
              <p className="text-muted-foreground mt-2">
                Register a .jeju name to get started
              </p>
              <button
                type="button"
                onClick={() => setTab('search')}
                className="mt-4 px-6 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl"
              >
                Search Names
              </button>
            </div>
          ))}
      </div>
    </div>
  )
}

export default NamesView
