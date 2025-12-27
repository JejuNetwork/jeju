/**
 * Jeju VPN Browser Extension - Background Service Worker
 *
 * Provides:
 * 1. SOCKS5/HTTP proxy routing through VPN nodes (via chrome.proxy API)
 * 2. JNS (.jeju) domain resolution
 * 3. WebRTC leak protection
 * 4. VPN node discovery and session management
 */

// ============================================================================
// State & Configuration
// ============================================================================

const DEFAULT_SETTINGS = {
  // Proxy settings
  proxyEnabled: false,
  proxyProtocol: 'socks5', // 'socks5' | 'http'
  selectedNodeId: null,
  autoSelectNode: true,

  // JNS settings
  jnsEnabled: true,
  gatewayUrl: 'https://gateway.jejunetwork.org',
  localDwsUrl: 'http://localhost:4030',
  preferLocalDws: true,
  ipfsGateway: 'https://ipfs.jejunetwork.org',

  // Privacy settings
  webrtcProtection: true,
  dnsLeakProtection: true,

  // Cache
  jnsCache: {},
  cacheExpiry: 300000, // 5 minutes

  // API
  vpnApiUrl: 'https://vpn.jejunetwork.org',
  localVpnApiUrl: 'http://localhost:4021',
}

let settings = { ...DEFAULT_SETTINGS }
let vpnNodes = []
let currentSession = null
let proxyConfig = null

// ============================================================================
// Initialization
// ============================================================================

// Load settings on startup
chrome.storage.local.get('jejuVpnSettings', (result) => {
  if (result.jejuVpnSettings) {
    settings = { ...DEFAULT_SETTINGS, ...result.jejuVpnSettings }
  }
  // Apply proxy settings if enabled
  if (settings.proxyEnabled) {
    applyProxyConfig()
  }
  // Fetch nodes on startup
  discoverNodes()
})

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.jejuVpnSettings) {
    settings = { ...DEFAULT_SETTINGS, ...changes.jejuVpnSettings.newValue }
  }
})

// ============================================================================
// VPN Node Discovery & Session Management
// ============================================================================

/**
 * Discover available VPN nodes from the network
 */
async function discoverNodes() {
  const endpoints = settings.preferLocalDws
    ? [settings.localVpnApiUrl, settings.vpnApiUrl]
    : [settings.vpnApiUrl, settings.localVpnApiUrl]

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(`${endpoint}/api/nodes`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      clearTimeout(timeoutId)

      if (response.ok) {
        const data = await response.json()
        vpnNodes = data.nodes || []
        console.log(`[Jeju VPN] Discovered ${vpnNodes.length} nodes from ${endpoint}`)

        // Auto-select best node if needed
        if (settings.autoSelectNode && vpnNodes.length > 0 && !settings.selectedNodeId) {
          const bestNode = selectBestNode(vpnNodes)
          if (bestNode) {
            settings.selectedNodeId = bestNode.node_id
            saveSettings()
          }
        }
        return
      }
    } catch (e) {
      console.warn(`[Jeju VPN] Failed to fetch nodes from ${endpoint}:`, e.message)
    }
  }

  console.warn('[Jeju VPN] Could not discover nodes from any endpoint')
}

/**
 * Select the best node based on latency and load
 */
function selectBestNode(nodes) {
  const proxyNodes = nodes.filter((n) =>
    n.capabilities?.supports_socks5 || n.capabilities?.supports_http
  )

  if (proxyNodes.length === 0) return null

  // Score: lower is better (latency + load * 10)
  return proxyNodes.reduce((best, node) => {
    const bestScore = (best?.latency_ms || 9999) + (best?.load || 100) * 10
    const nodeScore = (node.latency_ms || 9999) + (node.load || 100) * 10
    return nodeScore < bestScore ? node : best
  }, null)
}

/**
 * Create a VPN session with a node
 */
async function createSession(nodeId) {
  const node = vpnNodes.find((n) => n.node_id === nodeId)
  if (!node) {
    throw new Error('Node not found')
  }

  const endpoints = settings.preferLocalDws
    ? [settings.localVpnApiUrl, settings.vpnApiUrl]
    : [settings.vpnApiUrl, settings.localVpnApiUrl]

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          node_id: nodeId,
          protocol: settings.proxyProtocol,
        }),
      })

      if (response.ok) {
        const session = await response.json()
        currentSession = session
        console.log('[Jeju VPN] Session created:', session.session_id)
        return session
      }
    } catch (e) {
      console.warn(`[Jeju VPN] Failed to create session at ${endpoint}:`, e.message)
    }
  }

  throw new Error('Failed to create VPN session')
}

// ============================================================================
// Proxy Configuration (chrome.proxy API)
// ============================================================================

/**
 * Apply proxy configuration to route browser traffic through VPN node
 */
async function applyProxyConfig() {
  if (!settings.proxyEnabled) {
    clearProxyConfig()
    return
  }

  const node = vpnNodes.find((n) => n.node_id === settings.selectedNodeId)
  if (!node) {
    console.warn('[Jeju VPN] No node selected, cannot enable proxy')
    return
  }

  // Create session if needed
  if (!currentSession || currentSession.node_id !== node.node_id) {
    try {
      await createSession(node.node_id)
    } catch (e) {
      console.error('[Jeju VPN] Failed to create session:', e.message)
      notifyUser('Failed to connect to VPN node', 'error')
      return
    }
  }

  // Parse endpoint for proxy config
  const [host, port] = node.endpoint.split(':')
  const proxyPort = currentSession?.proxy_port || parseInt(port, 10) || 1080

  // Configure chrome.proxy
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: settings.proxyProtocol === 'socks5' ? 'socks5' : 'http',
        host: host,
        port: proxyPort,
      },
      // Bypass local addresses
      bypassList: [
        'localhost',
        '127.0.0.1',
        '::1',
        '*.local',
        '10.*',
        '172.16.*',
        '172.17.*',
        '172.18.*',
        '172.19.*',
        '172.20.*',
        '172.21.*',
        '172.22.*',
        '172.23.*',
        '172.24.*',
        '172.25.*',
        '172.26.*',
        '172.27.*',
        '172.28.*',
        '172.29.*',
        '172.30.*',
        '172.31.*',
        '192.168.*',
      ],
    },
  }

  proxyConfig = config

  chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => {
    console.log('[Jeju VPN] Proxy enabled:', host, proxyPort, settings.proxyProtocol)
    notifyUser(`Connected to ${node.region || node.country_code}`, 'success')
  })

  // Apply WebRTC protection if enabled
  if (settings.webrtcProtection) {
    applyWebRTCProtection()
  }
}

/**
 * Clear proxy configuration
 */
function clearProxyConfig() {
  chrome.proxy.settings.clear({ scope: 'regular' }, () => {
    console.log('[Jeju VPN] Proxy disabled')
    proxyConfig = null
    currentSession = null
  })

  // Clear WebRTC protection
  clearWebRTCProtection()
}

// ============================================================================
// WebRTC Leak Protection
// ============================================================================

/**
 * Apply WebRTC leak protection to prevent IP leaks
 */
function applyWebRTCProtection() {
  // Chrome doesn't have a direct WebRTC disable API in MV3
  // We inject a content script to override RTCPeerConnection
  console.log('[Jeju VPN] WebRTC protection enabled (via content script)')
}

function clearWebRTCProtection() {
  console.log('[Jeju VPN] WebRTC protection disabled')
}

// ============================================================================
// JNS Domain Resolution (from browser-extension)
// ============================================================================

/**
 * Resolve a .jeju domain to its content
 */
async function resolveJejuDomain(domain) {
  const normalizedDomain = domain.toLowerCase().replace(/\.$/, '')

  // Check cache first
  const cached = settings.jnsCache[normalizedDomain]
  if (cached && Date.now() - cached.timestamp < settings.cacheExpiry) {
    return cached.resolution
  }

  const endpoints = settings.preferLocalDws
    ? [settings.localDwsUrl, settings.gatewayUrl]
    : [settings.gatewayUrl, settings.localDwsUrl]

  for (const endpoint of endpoints) {
    const resolution = await tryResolve(endpoint, normalizedDomain)
    if (resolution) {
      // Cache successful resolution
      settings.jnsCache[normalizedDomain] = {
        resolution,
        timestamp: Date.now(),
      }
      saveSettings()
      return resolution
    }
  }

  return null
}

async function tryResolve(endpoint, domain) {
  try {
    const url = `${endpoint}/dns/jns/${domain}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    if (!data || data.error) {
      return null
    }

    return {
      domain,
      name: data.name,
      node: data.node,
      contenthash: data.records?.contenthash,
      ipfsHash: data.records?.ipfsHash,
      workerEndpoint: data.records?.workerEndpoint,
      address: data.records?.address,
      textRecords: data.records?.text,
      resolvedAt: Date.now(),
      resolvedVia: endpoint,
    }
  } catch {
    return null
  }
}

/**
 * Get the redirect URL for a .jeju domain
 */
function getRedirectUrl(resolution, originalPath) {
  // Priority 1: Worker endpoint (for dynamic apps)
  if (resolution.workerEndpoint) {
    return `${resolution.workerEndpoint}${originalPath}`
  }

  // Priority 2: IPFS content
  if (resolution.ipfsHash) {
    return `${settings.ipfsGateway}/ipfs/${resolution.ipfsHash}${originalPath}`
  }

  // Priority 3: Contenthash (decode and serve)
  if (resolution.contenthash) {
    const decoded = decodeContenthash(resolution.contenthash)
    if (decoded) {
      return `${settings.ipfsGateway}/ipfs/${decoded}${originalPath}`
    }
  }

  // Fallback: Gateway proxy
  return `${settings.gatewayUrl}/cdn/jns/${resolution.domain}${originalPath}`
}

/**
 * Decode EIP-1577 contenthash to IPFS CID
 */
function decodeContenthash(hash) {
  if (!hash.startsWith('0xe3')) {
    return null // Not IPFS namespace
  }

  const hexData = hash.slice(4)

  // Check for CIDv1 prefix (01 70 = CIDv1 dag-pb)
  if (hexData.startsWith('0170')) {
    const multihashHex = hexData.slice(4)
    const bytes = new Uint8Array(multihashHex.length / 2)
    for (let i = 0; i < multihashHex.length; i += 2) {
      bytes[i / 2] = parseInt(multihashHex.slice(i, i + 2), 16)
    }
    return base58Encode(bytes)
  }

  return null
}

/**
 * Base58 encoding (Bitcoin alphabet)
 */
function base58Encode(bytes) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

  let leadingZeros = 0
  for (const byte of bytes) {
    if (byte === 0) leadingZeros++
    else break
  }

  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) {
      const n = digits[i] * 256 + carry
      digits[i] = n % 58
      carry = Math.floor(n / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }

  let result = ''
  for (let i = 0; i < leadingZeros; i++) {
    result += '1'
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += ALPHABET[digits[i]]
  }

  return result
}

// ============================================================================
// Navigation Handling
// ============================================================================

/**
 * Handle navigation to .jeju domains
 */
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (!settings.jnsEnabled) return
    if (details.frameId !== 0) return // Only handle main frame

    const url = new URL(details.url)
    const hostname = url.hostname

    if (!hostname.endsWith('.jeju')) return

    const resolution = await resolveJejuDomain(hostname)

    if (resolution) {
      const redirectUrl = getRedirectUrl(resolution, url.pathname + url.search)
      chrome.tabs.update(details.tabId, { url: redirectUrl })
    } else {
      // Show error page
      chrome.tabs.update(details.tabId, {
        url: chrome.runtime.getURL(
          `error.html?domain=${encodeURIComponent(hostname)}`,
        ),
      })
    }
  },
  { url: [{ hostSuffix: '.jeju' }] },
)

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }))
  return true // Indicates async response
})

async function handleMessage(message) {
  switch (message.type) {
    // Settings
    case 'getSettings':
      return settings

    case 'updateSettings':
      settings = { ...settings, ...message.settings }
      saveSettings()
      // Apply proxy changes
      if (message.settings.proxyEnabled !== undefined) {
        if (message.settings.proxyEnabled) {
          await applyProxyConfig()
        } else {
          clearProxyConfig()
        }
      }
      return { success: true }

    // VPN
    case 'getNodes':
      return { nodes: vpnNodes }

    case 'refreshNodes':
      await discoverNodes()
      return { nodes: vpnNodes }

    case 'connect':
      settings.selectedNodeId = message.nodeId
      settings.proxyEnabled = true
      saveSettings()
      await applyProxyConfig()
      return { success: true, session: currentSession }

    case 'disconnect':
      settings.proxyEnabled = false
      saveSettings()
      clearProxyConfig()
      return { success: true }

    case 'getStatus':
      return {
        connected: settings.proxyEnabled && currentSession !== null,
        session: currentSession,
        selectedNode: vpnNodes.find((n) => n.node_id === settings.selectedNodeId),
        nodeCount: vpnNodes.length,
      }

    // JNS
    case 'jns_resolve':
      return resolveJejuDomain(message.domain)

    case 'jns_clearCache':
      settings.jnsCache = {}
      saveSettings()
      return { success: true }

    case 'checkGatewayStatus':
      return checkGatewayStatus()

    default:
      throw new Error(`Unknown message type: ${message.type}`)
  }
}

// ============================================================================
// Utilities
// ============================================================================

function saveSettings() {
  chrome.storage.local.set({ jejuVpnSettings: settings })
}

function notifyUser(message, type = 'info') {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Jeju VPN',
    message,
    priority: type === 'error' ? 2 : 1,
  })
}

/**
 * Check gateway connectivity
 */
async function checkGatewayStatus() {
  const status = {
    localDws: 'unknown',
    publicGateway: 'unknown',
    vpnApi: 'unknown',
    localDwsLatency: null,
    publicGatewayLatency: null,
    vpnApiLatency: null,
  }

  // Check local DWS
  try {
    const localStart = Date.now()
    const localResponse = await fetch(`${settings.localDwsUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (localResponse.ok) {
      status.localDws = 'online'
      status.localDwsLatency = Date.now() - localStart
    } else {
      status.localDws = 'offline'
    }
  } catch {
    status.localDws = 'offline'
  }

  // Check public gateway
  try {
    const publicStart = Date.now()
    const publicResponse = await fetch(`${settings.gatewayUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (publicResponse.ok) {
      status.publicGateway = 'online'
      status.publicGatewayLatency = Date.now() - publicStart
    } else {
      status.publicGateway = 'offline'
    }
  } catch {
    status.publicGateway = 'offline'
  }

  // Check VPN API
  try {
    const vpnStart = Date.now()
    const vpnResponse = await fetch(`${settings.vpnApiUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (vpnResponse.ok) {
      status.vpnApi = 'online'
      status.vpnApiLatency = Date.now() - vpnStart
    } else {
      status.vpnApi = 'offline'
    }
  } catch {
    status.vpnApi = 'offline'
  }

  return status
}

// ============================================================================
// Lifecycle
// ============================================================================

// Keep service worker alive (MV3)
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Refresh nodes periodically
    discoverNodes()
  }
})

// Context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'jejuVpnInfo',
    title: 'View JNS Info',
    contexts: ['page'],
    documentUrlPatterns: ['*://*.jeju/*'],
  })

  console.log('[Jeju VPN] Extension installed/updated')
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'jejuVpnInfo' && tab?.url) {
    const url = new URL(tab.url)
    if (url.hostname.endsWith('.jeju')) {
      chrome.tabs.create({
        url: chrome.runtime.getURL(
          `info.html?domain=${encodeURIComponent(url.hostname)}`,
        ),
      })
    }
  }
})

console.log('[Jeju VPN] Background service worker initialized')
