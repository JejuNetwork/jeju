import { OAuth3Provider } from '@jejunetwork/auth/react'
import type { OAuth3AppConfig } from '@jejunetwork/shared'
import type { ReactNode } from 'react'
import { CHAIN_ID, NETWORK, OAUTH3_AGENT_URL, RPC_URL } from './config'

interface GatewayOAuth3ProviderProps {
  children: ReactNode
}

const oauth3Config: OAuth3AppConfig = {
  appId: 'gateway.apps.jeju',
  redirectUri:
    typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : '',
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  teeAgentUrl: OAUTH3_AGENT_URL,
  network: NETWORK,
  decentralized: NETWORK !== 'localnet',
}

export function GatewayOAuth3Provider({
  children,
}: GatewayOAuth3ProviderProps) {
  return (
    <OAuth3Provider
      config={oauth3Config}
      autoConnect={true}
      onSessionChange={(session) => {
        if (session) {
          console.log('[OAuth3] Session established')
        } else {
          console.log('[OAuth3] Session ended')
        }
      }}
    >
      {children}
    </OAuth3Provider>
  )
}

export default GatewayOAuth3Provider
