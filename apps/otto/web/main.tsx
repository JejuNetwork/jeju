/**
 * Otto Web Frontend Entry Point
 */

import { OAuth3Provider } from '@jejunetwork/auth/react'
import {
  getChainId,
  getCurrentNetwork,
  getOAuth3Url,
  getRpcUrl,
} from '@jejunetwork/config'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './globals.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element not found')
}

const network = getCurrentNetwork()

createRoot(container).render(
  <StrictMode>
    <OAuth3Provider
      config={{
        appId: 'otto.apps.jeju',
        redirectUri: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
        chainId: getChainId(network),
        rpcUrl: getRpcUrl(network),
        teeAgentUrl: getOAuth3Url(network),
        network,
        decentralized: network !== 'localnet',
      }}
      autoConnect={true}
    >
      <App />
    </OAuth3Provider>
  </StrictMode>,
)
