import React, { useState } from 'react'
import { Landing } from './pages/Landing'
import { Onboard } from './pages/Onboard'
import { Configure } from './pages/Configure'
import { Chat } from './pages/Chat'

type Page = 'landing' | 'onboard' | 'configure' | 'chat'

export function App() {
  const [page, setPage] = useState<Page>('landing')
  const [sessionId, setSessionId] = useState<string | null>(null)

  const navigate = (to: Page) => setPage(to)

  switch (page) {
    case 'landing':
      return <Landing onNavigate={navigate} />
    case 'onboard':
      return (
        <Onboard
          onNavigate={navigate}
          onSessionCreated={setSessionId}
        />
      )
    case 'configure':
      return <Configure onNavigate={navigate} sessionId={sessionId} />
    case 'chat':
      return <Chat onNavigate={navigate} sessionId={sessionId} />
    default:
      return <Landing onNavigate={navigate} />
  }
}
