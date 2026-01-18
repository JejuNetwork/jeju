/**
 * Otto App - Main Application Component
 */

import { AuthCallback, useJejuAuth } from '@jejunetwork/auth/react'
import { useCallback, useMemo, useState } from 'react'
import { Chat } from './pages/Chat'
import { Landing } from './pages/Landing'

type Page = 'landing' | 'chat'

export function App() {
  const [page, setPage] = useState<Page>('landing')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const { walletAddress, loginWithWallet } = useJejuAuth()

  const handleStartChat = useCallback(() => {
    // Create a new session
    const newSessionId = crypto.randomUUID()
    setSessionId(newSessionId)
    setPage('chat')
  }, [])

  const isCallbackRoute = useMemo(() => {
    if (typeof window === 'undefined') return false
    return window.location.pathname === '/auth/callback'
  }, [])

  const handleBack = useCallback(() => {
    setPage('landing')
  }, [])

  if (isCallbackRoute) {
    return <AuthCallback />
  }

  if (page === 'chat' && sessionId) {
    return (
      <Chat
        sessionId={sessionId}
        walletAddress={walletAddress}
        onConnect={loginWithWallet}
        onBack={handleBack}
      />
    )
  }

  return <Landing onStartChat={handleStartChat} />
}
