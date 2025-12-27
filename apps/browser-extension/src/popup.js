/**
 * Jeju Name Service Browser Extension - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Load current settings
  const settings = await chrome.runtime.sendMessage({ type: 'getSettings' })

  // Initialize toggles
  const enableToggle = document.getElementById('enableToggle')
  const preferLocalToggle = document.getElementById('preferLocalToggle')

  if (settings.enabled) enableToggle.classList.add('active')
  if (settings.preferLocal) preferLocalToggle.classList.add('active')

  // Initialize inputs
  document.getElementById('localDwsUrl').value = settings.localDwsUrl
  document.getElementById('gatewayUrl').value = settings.gatewayUrl
  document.getElementById('ipfsGateway').value = settings.ipfsGateway

  // Update cache info
  const cacheSize = Object.keys(settings.resolverCache || {}).length
  document.getElementById('cacheInfo').textContent = `Cache: ${cacheSize} entries`

  // Check gateway status
  updateStatus()

  // Toggle handlers
  enableToggle.addEventListener('click', async () => {
    enableToggle.classList.toggle('active')
    await saveSettings()
  })

  preferLocalToggle.addEventListener('click', async () => {
    preferLocalToggle.classList.toggle('active')
    await saveSettings()
  })

  // Input handlers (save on blur)
  const inputs = ['localDwsUrl', 'gatewayUrl', 'ipfsGateway']
  for (const id of inputs) {
    document.getElementById(id).addEventListener('blur', saveSettings)
  }

  // Lookup button
  document.getElementById('lookupBtn').addEventListener('click', async () => {
    const domain = document.getElementById('lookupInput').value.trim()
    if (!domain) return

    const normalizedDomain = domain.endsWith('.jeju')
      ? domain
      : `${domain}.jeju`

    const result = await chrome.runtime.sendMessage({
      type: 'resolve',
      domain: normalizedDomain,
    })

    const resultDiv = document.getElementById('lookupResult')
    resultDiv.classList.add('visible')

    if (result) {
      document.getElementById('resultDomain').textContent = result.domain
      document.getElementById('resultIpfs').textContent =
        result.ipfsHash || 'Not set'
      document.getElementById('resultWorker').textContent =
        result.workerEndpoint || 'Not set'
      document.getElementById('resultVia').textContent = result.resolvedVia
    } else {
      document.getElementById('resultDomain').textContent = normalizedDomain
      document.getElementById('resultIpfs').textContent = 'Resolution failed'
      document.getElementById('resultWorker').textContent = '-'
      document.getElementById('resultVia').textContent = '-'
    }
  })

  // Enter key for lookup
  document.getElementById('lookupInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('lookupBtn').click()
    }
  })

  // Clear cache button
  document.getElementById('clearCacheBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'clearCache' })
    document.getElementById('cacheInfo').textContent = 'Cache: 0 entries'
  })
})

async function saveSettings() {
  const newSettings = {
    enabled: document.getElementById('enableToggle').classList.contains('active'),
    preferLocal: document
      .getElementById('preferLocalToggle')
      .classList.contains('active'),
    localDwsUrl: document.getElementById('localDwsUrl').value,
    gatewayUrl: document.getElementById('gatewayUrl').value,
    ipfsGateway: document.getElementById('ipfsGateway').value,
  }

  await chrome.runtime.sendMessage({
    type: 'updateSettings',
    settings: newSettings,
  })
}

async function updateStatus() {
  const status = await chrome.runtime.sendMessage({ type: 'getStatus' })

  const localDot = document.getElementById('localStatus')
  const gatewayDot = document.getElementById('gatewayStatus')
  const localLatency = document.getElementById('localLatency')
  const gatewayLatency = document.getElementById('gatewayLatency')

  localDot.classList.remove('online', 'offline')
  gatewayDot.classList.remove('online', 'offline')

  if (status.localDws === 'online') {
    localDot.classList.add('online')
    localLatency.textContent = `${status.localDwsLatency}ms`
  } else {
    localDot.classList.add('offline')
    localLatency.textContent = 'offline'
  }

  if (status.publicGateway === 'online') {
    gatewayDot.classList.add('online')
    gatewayLatency.textContent = `${status.publicGatewayLatency}ms`
  } else {
    gatewayDot.classList.add('offline')
    gatewayLatency.textContent = 'offline'
  }
}
