/**
 * Jeju Name Service Browser Extension - Background Service Worker
 *
 * Handles .jeju domain resolution via the decentralized JNS system.
 * Intercepts navigation to .jeju domains and resolves them through:
 * 1. Local DWS node (if running)
 * 2. Public JNS gateway
 * 3. IPFS content delivery
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  gatewayUrl: 'https://gateway.jejunetwork.org',
  localDwsUrl: 'http://localhost:4030',
  preferLocal: true,
  ipfsGateway: 'https://ipfs.jejunetwork.org',
  resolverCache: {},
  cacheExpiry: 300000, // 5 minutes
}

let settings = { ...DEFAULT_SETTINGS }

// Load settings on startup
chrome.storage.local.get('jejuSettings', (result) => {
  if (result.jejuSettings) {
    settings = { ...DEFAULT_SETTINGS, ...result.jejuSettings }
  }
})

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.jejuSettings) {
    settings = { ...DEFAULT_SETTINGS, ...changes.jejuSettings.newValue }
  }
})

/**
 * Resolve a .jeju domain to its content
 */
async function resolveJejuDomain(domain) {
  const normalizedDomain = domain.toLowerCase().replace(/\.$/, '')

  // Check cache first
  const cached = settings.resolverCache[normalizedDomain]
  if (cached && Date.now() - cached.timestamp < settings.cacheExpiry) {
    return cached.resolution
  }

  const endpoints = settings.preferLocal
    ? [settings.localDwsUrl, settings.gatewayUrl]
    : [settings.gatewayUrl, settings.localDwsUrl]

  for (const endpoint of endpoints) {
    const resolution = await tryResolve(endpoint, normalizedDomain)
    if (resolution) {
      // Cache successful resolution
      settings.resolverCache[normalizedDomain] = {
        resolution,
        timestamp: Date.now(),
      }
      chrome.storage.local.set({ jejuSettings: settings })
      return resolution
    }
  }

  return null
}

async function tryResolve(endpoint, domain) {
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

/**
 * Handle navigation to .jeju domains
 */
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (!settings.enabled) return
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
          `src/error.html?domain=${encodeURIComponent(hostname)}`,
        ),
      })
    }
  },
  { url: [{ hostSuffix: '.jeju' }] },
)

/**
 * Handle messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getSettings') {
    sendResponse(settings)
    return true
  }

  if (message.type === 'updateSettings') {
    settings = { ...settings, ...message.settings }
    chrome.storage.local.set({ jejuSettings: settings })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'resolve') {
    resolveJejuDomain(message.domain).then((resolution) => {
      sendResponse(resolution)
    })
    return true // Indicates async response
  }

  if (message.type === 'clearCache') {
    settings.resolverCache = {}
    chrome.storage.local.set({ jejuSettings: settings })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'getStatus') {
    checkGatewayStatus().then((status) => {
      sendResponse(status)
    })
    return true
  }

  return false
})

/**
 * Check gateway connectivity
 */
async function checkGatewayStatus() {
  const status = {
    localDws: 'unknown',
    publicGateway: 'unknown',
    localDwsLatency: null,
    publicGatewayLatency: null,
  }

  // Check local DWS
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

  // Check public gateway
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

  return status
}

/**
 * Context menu for .jeju domain info
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'jejuInfo',
    title: 'View JNS Info',
    contexts: ['page'],
    documentUrlPatterns: ['*://*.jeju/*'],
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'jejuInfo' && tab?.url) {
    const url = new URL(tab.url)
    if (url.hostname.endsWith('.jeju')) {
      chrome.tabs.create({
        url: chrome.runtime.getURL(
          `src/info.html?domain=${encodeURIComponent(url.hostname)}`,
        ),
      })
    }
  }
})

console.log('[JNS Extension] Background service worker initialized')
