/**
 * Auth frontend app
 */

// Check for existing session
async function checkSession() {
  const response = await fetch('/session', {
    credentials: 'include',
  })

  if (response.ok) {
    const data = await response.json()
    if (data.authenticated) {
      console.log('User authenticated:', data.session)
      updateUIForAuthenticatedUser(data.session)
    }
  }
}

function updateUIForAuthenticatedUser(session: {
  userId: string
  provider: string
  address?: string
  fid?: number
}) {
  // Could update UI to show logged-in state
  console.log('Authenticated as:', session.userId)
}

// Initialize
checkSession()

// Export for potential module use
export { checkSession }
