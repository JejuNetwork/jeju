/**
 * Auth frontend app
 */

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

const API_BASE = ''

// Check for existing session
async function checkSession(): Promise<Session | null> {
  const response = await fetch(`${API_BASE}/session`, {
    credentials: 'include',
  })

  if (response.ok) {
    const data: SessionResponse = await response.json()
    if (data.authenticated && data.session) {
      return data.session
    }
  }
  return null
}

// Update UI based on auth state
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

// Render user profile
function renderProfile(session: Session): void {
  const profileContent = document.getElementById('profile-content')
  if (!profileContent) return

  const providerIcon = getProviderIcon(session.provider)
  const displayId = session.address
    ? `${session.address.slice(0, 6)}...${session.address.slice(-4)}`
    : session.fid
      ? `FID: ${session.fid}`
      : (session.email ?? session.userId)

  profileContent.innerHTML = `
    <div class="profile-header">
      <span class="provider-icon">${providerIcon}</span>
      <span class="user-id">${displayId}</span>
    </div>
    <div class="profile-details">
      <p><strong>Provider:</strong> ${session.provider}</p>
      <p><strong>Session ID:</strong> ${session.sessionId.slice(0, 8)}...</p>
      <p><strong>Expires:</strong> ${new Date(session.expiresAt).toLocaleString()}</p>
    </div>
  `
}

function getProviderIcon(provider: string): string {
  const icons: Record<string, string> = {
    wallet: '🔐',
    farcaster: '🟣',
    github: '🐙',
    google: '🔵',
    twitter: '🐦',
    discord: '💬',
  }
  return icons[provider] ?? '👤'
}

// Logout handler
async function logout(): Promise<void> {
  const response = await fetch(`${API_BASE}/session`, {
    method: 'DELETE',
    credentials: 'include',
  })

  if (response.ok) {
    updateUI(null)
  }
}

// Initialize demo login
function initDemoLogin(): void {
  const demoBtn = document.getElementById('demo-login-btn')
  if (demoBtn) {
    demoBtn.addEventListener('click', () => {
      const redirectUri = encodeURIComponent(
        `${window.location.origin}/callback`,
      )
      window.location.href = `/oauth/authorize?client_id=jeju-default&redirect_uri=${redirectUri}`
    })
  }
}

// Handle OAuth callback
async function handleCallback(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')

  if (error) {
    console.error('OAuth error:', error)
    return
  }

  if (code) {
    // Exchange code for token
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
      // Clear URL params and refresh
      window.history.replaceState({}, '', '/')
      const session = await checkSession()
      updateUI(session)
    }
  }
}

// Initialize app
async function init(): Promise<void> {
  // Check if this is a callback
  if (window.location.pathname === '/callback') {
    await handleCallback()
  }

  // Check session
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
