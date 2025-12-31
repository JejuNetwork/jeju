interface Session {
  sessionId: string
  userId: string
  provider: string
  address?: string
  fid?: number
  email?: string
  createdAt: number
  expiresAt: number
}

interface SessionResponse {
  authenticated: boolean
  session?: Session
  error?: string
}

type NetworkEnv = 'localnet' | 'testnet' | 'mainnet'

interface EnvUrls {
  docs: string
  gateway: string
  dws: string
  dwsOauth: string
}

/**
 * Detect the current network environment from the hostname
 */
function detectEnvironment(): NetworkEnv {
  const hostname = window.location.hostname

  if (hostname.includes('testnet')) {
    return 'testnet'
  }
  if (hostname.includes('local') || hostname === 'localhost' || hostname.startsWith('127.')) {
    return 'localnet'
  }
  // Default to mainnet for production domains
  return 'mainnet'
}

/**
 * Get environment-specific URLs
 */
function getEnvUrls(): EnvUrls {
  const env = detectEnvironment()
  
  const urlsByEnv: Record<NetworkEnv, EnvUrls> = {
    localnet: {
      docs: 'https://documentation.local.jejunetwork.org:8080/auth',
      gateway: 'https://gateway.local.jejunetwork.org:8080',
      dws: 'https://dws.local.jejunetwork.org:8080',
      dwsOauth: 'https://dws.local.jejunetwork.org:8080/oauth3',
    },
    testnet: {
      docs: 'https://documentation.testnet.jejunetwork.org/auth',
      gateway: 'https://gateway.testnet.jejunetwork.org',
      dws: 'https://dws.testnet.jejunetwork.org',
      dwsOauth: 'https://dws.testnet.jejunetwork.org/oauth3',
    },
    mainnet: {
      docs: 'https://documentation.jejunetwork.org/auth',
      gateway: 'https://gateway.jejunetwork.org',
      dws: 'https://dws.jejunetwork.org',
      dwsOauth: 'https://dws.jejunetwork.org/oauth3',
    },
  }

  return urlsByEnv[env]
}

/**
 * Update navigation links with environment-specific URLs
 */
function updateNavigationLinks(): void {
  const urls = getEnvUrls()
  
  // Header navigation
  const docsLink = document.getElementById('nav-docs')
  if (docsLink) docsLink.setAttribute('href', urls.docs)
  
  const gatewayLink = document.getElementById('nav-gateway')
  if (gatewayLink) gatewayLink.setAttribute('href', urls.gateway)
  
  const configureLink = document.getElementById('nav-configure')
  if (configureLink) configureLink.setAttribute('href', urls.dwsOauth)
  
  // Hero section
  const heroConfigureLink = document.getElementById('hero-configure')
  if (heroConfigureLink) heroConfigureLink.setAttribute('href', urls.dwsOauth)
  
  // Config section
  const configDwsLink = document.getElementById('config-dws')
  if (configDwsLink) configDwsLink.setAttribute('href', urls.dwsOauth)
  
  // Footer
  const footerDwsLink = document.getElementById('footer-dws')
  if (footerDwsLink) footerDwsLink.setAttribute('href', urls.dws)
  
  console.log(`[OAuth3] Environment: ${detectEnvironment()}, URLs configured`)
}

const API_BASE = ''

// Provider display configuration
const PROVIDER_CONFIG: Record<string, { icon: string; label: string }> = {
  wallet: { icon: '🔐', label: 'Wallet' },
  farcaster: { icon: '🟣', label: 'Farcaster' },
  github: { icon: '🐙', label: 'GitHub' },
  google: { icon: '🔵', label: 'Google' },
  twitter: { icon: '🐦', label: 'Twitter' },
  discord: { icon: '💬', label: 'Discord' },
}

const DEFAULT_PROVIDER = { icon: '👤', label: 'Unknown' }

/**
 * Fetch current session from API
 */
async function checkSession(): Promise<Session | null> {
  const response = await fetch(`${API_BASE}/session`, {
    credentials: 'include',
  })

  if (!response.ok) {
    return null
  }

  const data: SessionResponse = await response.json()
  return data.authenticated && data.session ? data.session : null
}

/**
 * Format user display ID based on provider type
 */
function formatDisplayId(session: Session): string {
  if (session.address) {
    return `${session.address.slice(0, 6)}...${session.address.slice(-4)}`
  }
  if (session.fid) {
    return `FID: ${session.fid}`
  }
  return session.email ?? session.userId.split(':')[1] ?? session.userId
}

/**
 * Format timestamp to locale string
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/**
 * Render profile section content
 */
function renderProfile(session: Session): void {
  const container = document.getElementById('profile-content')
  if (!container) return

  const config = PROVIDER_CONFIG[session.provider] ?? DEFAULT_PROVIDER
  const displayId = formatDisplayId(session)

  container.innerHTML = `
    <div class="profile-header">
      <span class="provider-icon" aria-hidden="true">${config.icon}</span>
      <div>
        <div class="user-id">${displayId}</div>
        <div style="font-size: 14px; color: var(--text-secondary);">via ${config.label}</div>
      </div>
    </div>
    <div class="profile-details" role="list" aria-label="Session details">
      <p role="listitem">
        <strong>Session ID</strong>
        <span style="font-family: 'JetBrains Mono', monospace;">${session.sessionId.slice(0, 8)}...</span>
      </p>
      <p role="listitem">
        <strong>Created</strong>
        <span>${formatDate(session.createdAt)}</span>
      </p>
      <p role="listitem">
        <strong>Expires</strong>
        <span>${formatDate(session.expiresAt)}</span>
      </p>
    </div>
  `
}

/**
 * Toggle visibility between login and profile sections
 */
function updateUI(session: Session | null): void {
  const loginSection = document.getElementById('login-section')
  const profileSection = document.getElementById('profile-section')

  if (!loginSection || !profileSection) return

  if (session) {
    loginSection.style.display = 'none'
    profileSection.style.display = 'block'
    renderProfile(session)
  } else {
    loginSection.style.display = 'block'
    profileSection.style.display = 'none'
  }
}

/**
 * Handle user logout
 */
async function logout(): Promise<void> {
  const response = await fetch(`${API_BASE}/session`, {
    method: 'DELETE',
    credentials: 'include',
  })

  if (response.ok) {
    updateUI(null)
  }
}

/**
 * Initialize demo login button
 */
function initDemoLogin(): void {
  const btn = document.getElementById('demo-login-btn')
  if (!btn) return

  btn.addEventListener('click', () => {
    const redirectUri = encodeURIComponent(`${window.location.origin}/callback`)
    window.location.href = `/oauth/authorize?client_id=jeju-default&redirect_uri=${redirectUri}`
  })
}

/**
 * Handle OAuth callback - exchange code for session
 */
async function handleCallback(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')

  if (error) {
    console.error('[OAuth3] OAuth error:', error)
    return
  }

  if (!code) return

  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: 'jeju-default',
      redirect_uri: `${window.location.origin}/callback`,
    }),
  })

  if (response.ok) {
    // Clear URL params and check session
    window.history.replaceState({}, '', '/')
    const session = await checkSession()
    updateUI(session)
  }
}

/**
 * Initialize application
 */
async function init(): Promise<void> {
  // Set environment-specific navigation URLs
  updateNavigationLinks()

  // Handle OAuth callback if on callback path
  if (window.location.pathname === '/callback') {
    await handleCallback()
  }

  // Check for existing session
  const session = await checkSession()
  updateUI(session)

  // Setup event listeners
  initDemoLogin()

  const logoutBtn = document.getElementById('logout-btn')
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout)
  }

  console.log('[OAuth3] App initialized')
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

export { checkSession, logout }
