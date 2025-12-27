/**
 * Jeju VPN Browser Extension - Popup Script
 */

// Elements
const connectBtn = document.getElementById('connectBtn')
const statusBadge = document.getElementById('statusBadge')
const locationSelect = document.getElementById('locationSelect')
const statsSection = document.getElementById('stats')
const latencyDisplay = document.getElementById('latency')
const nodeCountDisplay = document.getElementById('nodeCount')
const protocolDisplay = document.getElementById('protocol')

// Toggles
const jnsEnabledToggle = document.getElementById('jnsEnabled')
const webrtcProtectionToggle = document.getElementById('webrtcProtection')
const preferLocalToggle = document.getElementById('preferLocal')

// JNS
const jnsDomainInput = document.getElementById('jnsDomain')
const jnsLookupBtn = document.getElementById('jnsLookup')
const jnsResult = document.getElementById('jnsResult')
const resultAddress = document.getElementById('resultAddress')
const resultContent = document.getElementById('resultContent')

// State
let settings = {}
let nodes = []
let isConnected = false

// ============================================================================
// Initialization
// ============================================================================

async function init() {
  // Load settings
  settings = await sendMessage({ type: 'getSettings' })
  
  // Load nodes
  const nodesResponse = await sendMessage({ type: 'getNodes' })
  nodes = nodesResponse.nodes || []
  
  // Get status
  const status = await sendMessage({ type: 'getStatus' })
  
  // Update UI
  updateUI(status)
  populateLocations()
  loadToggles()
}

// ============================================================================
// UI Updates
// ============================================================================

function updateUI(status) {
  isConnected = status.connected
  
  if (isConnected) {
    statusBadge.textContent = 'Connected'
    statusBadge.className = 'status-badge connected'
    connectBtn.classList.add('connected')
    connectBtn.querySelector('span').textContent = 'Disconnect'
    connectBtn.querySelector('svg').innerHTML = '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
    
    statsSection.style.display = 'grid'
    
    if (status.selectedNode) {
      latencyDisplay.textContent = `${status.selectedNode.latency_ms || '--'}ms`
      protocolDisplay.textContent = settings.proxyProtocol?.toUpperCase() || 'SOCKS5'
    }
  } else {
    statusBadge.textContent = 'Disconnected'
    statusBadge.className = 'status-badge disconnected'
    connectBtn.classList.remove('connected')
    connectBtn.querySelector('span').textContent = 'Connect'
    connectBtn.querySelector('svg').innerHTML = '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'
    
    statsSection.style.display = 'none'
  }
  
  nodeCountDisplay.textContent = nodes.length
}

function populateLocations() {
  // Clear existing options except Auto
  while (locationSelect.options.length > 1) {
    locationSelect.remove(1)
  }
  
  // Group nodes by country
  const byCountry = {}
  for (const node of nodes) {
    const country = node.country_code || 'Unknown'
    if (!byCountry[country]) {
      byCountry[country] = []
    }
    byCountry[country].push(node)
  }
  
  // Add countries as options
  for (const [country, countryNodes] of Object.entries(byCountry).sort()) {
    const bestNode = countryNodes.reduce((best, node) => {
      return (node.latency_ms || 9999) < (best?.latency_ms || 9999) ? node : best
    }, null)
    
    if (bestNode) {
      const option = document.createElement('option')
      option.value = bestNode.node_id
      option.textContent = `${getCountryFlag(country)} ${country} (${bestNode.latency_ms || '?'}ms)`
      locationSelect.appendChild(option)
    }
  }
  
  // Select current node
  if (settings.selectedNodeId) {
    locationSelect.value = settings.selectedNodeId
  }
}

function loadToggles() {
  jnsEnabledToggle.checked = settings.jnsEnabled !== false
  webrtcProtectionToggle.checked = settings.webrtcProtection !== false
  preferLocalToggle.checked = settings.preferLocalDws !== false
}

function getCountryFlag(countryCode) {
  const flags = {
    'US': '🇺🇸',
    'NL': '🇳🇱',
    'DE': '🇩🇪',
    'JP': '🇯🇵',
    'GB': '🇬🇧',
    'FR': '🇫🇷',
    'CA': '🇨🇦',
    'AU': '🇦🇺',
    'SG': '🇸🇬',
    'KR': '🇰🇷',
  }
  return flags[countryCode] || '🌍'
}

// ============================================================================
// Event Handlers
// ============================================================================

connectBtn.addEventListener('click', async () => {
  if (isConnected) {
    await sendMessage({ type: 'disconnect' })
  } else {
    const nodeId = locationSelect.value || null
    await sendMessage({ type: 'connect', nodeId })
  }
  
  // Refresh status
  const status = await sendMessage({ type: 'getStatus' })
  updateUI(status)
})

locationSelect.addEventListener('change', async () => {
  settings.selectedNodeId = locationSelect.value || null
  settings.autoSelectNode = !locationSelect.value
  await sendMessage({ type: 'updateSettings', settings })
  
  // If connected, reconnect to new node
  if (isConnected && locationSelect.value) {
    await sendMessage({ type: 'connect', nodeId: locationSelect.value })
    const status = await sendMessage({ type: 'getStatus' })
    updateUI(status)
  }
})

// Toggle handlers
jnsEnabledToggle.addEventListener('change', async () => {
  await sendMessage({
    type: 'updateSettings',
    settings: { jnsEnabled: jnsEnabledToggle.checked }
  })
})

webrtcProtectionToggle.addEventListener('change', async () => {
  await sendMessage({
    type: 'updateSettings',
    settings: { webrtcProtection: webrtcProtectionToggle.checked }
  })
})

preferLocalToggle.addEventListener('change', async () => {
  await sendMessage({
    type: 'updateSettings',
    settings: { preferLocalDws: preferLocalToggle.checked }
  })
})

// JNS Lookup
jnsLookupBtn.addEventListener('click', async () => {
  const domain = jnsDomainInput.value.trim()
  if (!domain) return
  
  // Add .jeju suffix if not present
  const fullDomain = domain.endsWith('.jeju') ? domain : `${domain}.jeju`
  
  jnsLookupBtn.textContent = 'Looking up...'
  jnsLookupBtn.disabled = true
  
  try {
    const resolution = await sendMessage({ type: 'jns_resolve', domain: fullDomain })
    
    if (resolution) {
      jnsResult.classList.add('visible')
      resultAddress.textContent = resolution.address || '--'
      resultContent.textContent = resolution.ipfsHash || resolution.contenthash || resolution.workerEndpoint || '--'
    } else {
      jnsResult.classList.add('visible')
      resultAddress.textContent = 'Not found'
      resultContent.textContent = '--'
    }
  } catch (e) {
    jnsResult.classList.add('visible')
    resultAddress.textContent = 'Error'
    resultContent.textContent = e.message
  } finally {
    jnsLookupBtn.textContent = 'Lookup'
    jnsLookupBtn.disabled = false
  }
})

// Enter key for JNS lookup
jnsDomainInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    jnsLookupBtn.click()
  }
})

// ============================================================================
// Message Helper
// ============================================================================

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else if (response?.error) {
        reject(new Error(response.error))
      } else {
        resolve(response)
      }
    })
  })
}

// ============================================================================
// Initialize
// ============================================================================

init().catch(console.error)
