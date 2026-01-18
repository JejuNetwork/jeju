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
  if (
    hostname.includes('local') ||
    hostname === 'localhost' ||
    hostname.startsWith('127.')
  ) {
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
      docs: 'http://docs.local.jejunetwork.org:8080/',
      gateway: 'https://gateway.local.jejunetwork.org:8080',
      dws: 'https://dws.local.jejunetwork.org:8080',
      dwsOauth: 'https://dws.local.jejunetwork.org:8080/oauth3',
    },
    testnet: {
      docs: 'https://docs.testnet.jejunetwork.org/',
      gateway: 'https://gateway.testnet.jejunetwork.org',
      dws: 'https://dws.testnet.jejunetwork.org',
      dwsOauth: 'https://dws.testnet.jejunetwork.org/oauth3',
    },
    mainnet: {
      docs: 'https://docs.jejunetwork.org/',
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
 * Handle /authorize route - show login providers or auto-start a specific provider
 */
function handleAuthorize(): void {
  const params = new URLSearchParams(window.location.search)
  const redirectUri = params.get('redirect_uri')
  const state = params.get('state')
  const providerHint = params.get('provider')

  if (!redirectUri) {
    console.error('[OAuth3] No redirect_uri provided')
    return
  }

  // Store auth params for after login
  sessionStorage.setItem('oauth3_redirect_uri', redirectUri)
  if (state) sessionStorage.setItem('oauth3_state', state)

  // If a provider hint is provided, auto-start that provider's flow
  if (providerHint) {
    console.log(`[OAuth3] Provider hint: ${providerHint}, starting auth flow`)
    startAuth(providerHint)
    return
  }

  // Otherwise show the authorization UI for user to pick a provider
  showAuthorizationUI(redirectUri, state)
}

/**
 * Show authorization UI with provider buttons
 */
function showAuthorizationUI(redirectUri: string, _state: string | null): void {
  const main = document.querySelector('main')
  if (!main) return

  // Parse the redirect URI to show which app is requesting access
  let appName = 'Unknown App'
  try {
    const url = new URL(redirectUri)
    appName = url.hostname
  } catch {
    appName = redirectUri
  }

  main.innerHTML = `
    <section class="authorize-section" style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem;">
      <div class="authorize-card" style="background: var(--bg-card); border-radius: 16px; padding: 2.5rem; max-width: 420px; width: 100%; box-shadow: var(--shadow-md); border: 1px solid var(--border-light);">
        <div style="text-align: center; margin-bottom: 2rem;">
          <div style="font-size: 48px; margin-bottom: 1rem;">🔐</div>
          <h1 style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem;">Sign In</h1>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">
            <strong>${appName}</strong> is requesting access
          </p>
        </div>
        
        <div class="provider-buttons" style="display: flex; flex-direction: column; gap: 0.75rem;">
          <button onclick="startAuth('wallet')" class="provider-btn" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem 1rem; border: 1px solid var(--border-light); border-radius: 10px; background: var(--bg-card); cursor: pointer; font-size: 1rem; transition: all 0.2s;">
            <span style="font-size: 1.25rem;">🔐</span>
            <span style="font-weight: 500;">Continue with Wallet</span>
          </button>
          <button onclick="startPasskey()" class="provider-btn" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem 1rem; border: 1px solid var(--border-light); border-radius: 10px; background: var(--bg-card); cursor: pointer; font-size: 1rem; transition: all 0.2s;">
            <span style="font-size: 1.25rem;">🔑</span>
            <span style="font-weight: 500;">Continue with Passkey</span>
          </button>
          <button onclick="startAuth('farcaster')" class="provider-btn" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem 1rem; border: 1px solid var(--border-light); border-radius: 10px; background: var(--bg-card); cursor: pointer; font-size: 1rem; transition: all 0.2s;">
            <span style="font-size: 1.25rem;">🟣</span>
            <span style="font-weight: 500;">Continue with Farcaster</span>
          </button>
          
          <div style="display: flex; align-items: center; gap: 0.75rem; margin: 0.5rem 0;">
            <div style="flex: 1; height: 1px; background: var(--border-light);"></div>
            <span style="color: var(--text-muted); font-size: 0.85rem;">or continue with</span>
            <div style="flex: 1; height: 1px; background: var(--border-light);"></div>
          </div>
          
          <button onclick="startAuth('google')" class="provider-btn" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem 1rem; border: 1px solid var(--border-light); border-radius: 10px; background: var(--bg-card); cursor: pointer; font-size: 1rem; transition: all 0.2s;">
            <span style="font-size: 1.25rem;">🔵</span>
            <span style="font-weight: 500;">Google</span>
          </button>
          <button onclick="startAuth('github')" class="provider-btn" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem 1rem; border: 1px solid var(--border-light); border-radius: 10px; background: var(--bg-card); cursor: pointer; font-size: 1rem; transition: all 0.2s;">
            <span style="font-size: 1.25rem;">🐙</span>
            <span style="font-weight: 500;">GitHub</span>
          </button>
          <button onclick="startAuth('discord')" class="provider-btn" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem 1rem; border: 1px solid var(--border-light); border-radius: 10px; background: var(--bg-card); cursor: pointer; font-size: 1rem; transition: all 0.2s;">
            <span style="font-size: 1.25rem;">💬</span>
            <span style="font-weight: 500;">Discord</span>
          </button>
          <button onclick="startAuth('twitter')" class="provider-btn" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem 1rem; border: 1px solid var(--border-light); border-radius: 10px; background: var(--bg-card); cursor: pointer; font-size: 1rem; transition: all 0.2s;">
            <span style="font-size: 1.25rem;">🐦</span>
            <span style="font-weight: 500;">Twitter</span>
          </button>
        </div>
        
        <p style="text-align: center; margin-top: 1.5rem; font-size: 0.8rem; color: var(--text-muted);">
          Powered by OAuth3 • Decentralized Identity
        </p>
      </div>
    </section>
  `

  // Add hover styles
  const style = document.createElement('style')
  style.textContent = `
    .provider-btn:hover {
      background: var(--bg-elevated) !important;
      border-color: var(--accent-primary) !important;
    }
  `
  document.head.appendChild(style)
}

/**
 * Start authentication with a specific provider
 */
function startAuth(provider: string): void {
  const redirectUri = sessionStorage.getItem('oauth3_redirect_uri')
  const state = sessionStorage.getItem('oauth3_state')

  if (!redirectUri) {
    console.error('[OAuth3] No redirect_uri in session')
    return
  }

  // Different flows for different providers
  let authUrl: URL

  if (provider === 'wallet') {
    // Wallet uses /wallet/challenge endpoint
    authUrl = new URL(`${window.location.origin}/wallet/challenge`)
  } else if (provider === 'farcaster') {
    // Farcaster uses /farcaster/init endpoint
    authUrl = new URL(`${window.location.origin}/farcaster/init`)
  } else {
    // Social providers (google, github, discord, twitter) use /oauth/social/{provider}
    authUrl = new URL(`${window.location.origin}/oauth/social/${provider}`)
  }

  authUrl.searchParams.set('client_id', 'jeju-default') // Default client
  authUrl.searchParams.set('redirect_uri', redirectUri)
  if (state) authUrl.searchParams.set('state', state)

  window.location.href = authUrl.toString()
}

/**
 * Start passkey authentication flow
 */
async function startPasskey(): Promise<void> {
  const redirectUri = sessionStorage.getItem('oauth3_redirect_uri')
  const state = sessionStorage.getItem('oauth3_state')

  if (!redirectUri) {
    console.error('[OAuth3] No redirect_uri in session')
    return
  }

  try {
    // Get passkey options from the server
    const optionsRes = await fetch(`${window.location.origin}/auth/passkey/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: window.location.origin, appId: 'jeju-default' }),
    })

    if (!optionsRes.ok) {
      throw new Error('Failed to get passkey options')
    }

    const options = await optionsRes.json()
    const publicKey = options.publicKey

    // Convert base64url strings to ArrayBuffers
    publicKey.challenge = base64urlToBuffer(publicKey.challenge)
    if (publicKey.user?.id) {
      publicKey.user.id = base64urlToBuffer(publicKey.user.id)
    }
    if (publicKey.allowCredentials) {
      publicKey.allowCredentials = publicKey.allowCredentials.map(
        (cred: { id: string; type: string; transports?: string[] }) => ({
          ...cred,
          id: base64urlToBuffer(cred.id),
        }),
      )
    }

    // Call WebAuthn API
    let credential: PublicKeyCredential | null
    if (options.mode === 'registration') {
      credential = (await navigator.credentials.create({
        publicKey,
      })) as PublicKeyCredential | null
    } else {
      credential = (await navigator.credentials.get({
        publicKey,
      })) as PublicKeyCredential | null
    }

    if (!credential) {
      throw new Error('No credential returned')
    }

    // Prepare credential for verification
    const response: Record<string, string> = {
      clientDataJSON: bufferToBase64url(
        new Uint8Array((credential.response as AuthenticatorAttestationResponse).clientDataJSON),
      ),
    }

    if (options.mode === 'registration') {
      response.attestationObject = bufferToBase64url(
        new Uint8Array(
          (credential.response as AuthenticatorAttestationResponse).attestationObject,
        ),
      )
    } else {
      const assertionResponse = credential.response as AuthenticatorAssertionResponse
      response.authenticatorData = bufferToBase64url(
        new Uint8Array(assertionResponse.authenticatorData),
      )
      response.signature = bufferToBase64url(new Uint8Array(assertionResponse.signature))
      if (assertionResponse.userHandle) {
        response.userHandle = bufferToBase64url(new Uint8Array(assertionResponse.userHandle))
      }
    }

    // Verify with server
    const verifyRes = await fetch(`${window.location.origin}/auth/passkey/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: 'jeju-default',
        mode: options.mode,
        challengeId: options.challengeId,
        credential: {
          id: credential.id,
          rawId: bufferToBase64url(new Uint8Array(credential.rawId)),
          type: credential.type,
          response,
        },
      }),
    })

    if (!verifyRes.ok) {
      const err = await verifyRes.json()
      throw new Error(err.error || 'Passkey verification failed')
    }

    const session = await verifyRes.json()

    // Generate auth code and redirect
    const code = session.sessionId
    const redirectUrl = new URL(redirectUri)
    redirectUrl.searchParams.set('code', code)
    if (state) redirectUrl.searchParams.set('state', state)
    window.location.href = redirectUrl.toString()
  } catch (err) {
    console.error('[OAuth3] Passkey auth failed:', err)
    alert(`Passkey authentication failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (base64.length % 4)) % 4
  const padded = base64 + '='.repeat(padLen)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function bufferToBase64url(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Expose startAuth and startPasskey to window for onclick handlers
declare global {
  interface Window {
    startAuth: (provider: string) => void
    startPasskey: () => Promise<void>
  }
}
window.startAuth = startAuth
window.startPasskey = startPasskey

/**
 * Initialize application
 */
async function init(): Promise<void> {
  // Set environment-specific navigation URLs
  updateNavigationLinks()

  // Handle /authorize route - show login providers
  if (window.location.pathname === '/authorize') {
    handleAuthorize()
    console.log('[OAuth3] Authorize flow initialized')
    return
  }

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
