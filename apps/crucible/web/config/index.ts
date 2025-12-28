import {
  CORE_PORTS,
  getCurrentNetwork,
  getLocalhostHost,
} from '@jejunetwork/config'

export const NETWORK_NAME = 'Jeju Network'

const NETWORK = getCurrentNetwork()

// Crucible API runs on the executor port (4021)
export const CRUCIBLE_PORT = CORE_PORTS.CRUCIBLE_API.DEFAULT
export const CRUCIBLE_API_PORT = CORE_PORTS.CRUCIBLE_EXECUTOR.DEFAULT

// API URL - crucible API server runs on executor port
const getApiBaseUrl = (): string => {
  const localhost = getLocalhostHost()
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local.jejunetwork.org')
    ) {
      return `http://${localhost}:${CRUCIBLE_API_PORT}`
    }
  }
  if (NETWORK === 'mainnet') {
    return 'https://crucible-api.jejunetwork.org'
  }
  if (NETWORK === 'testnet') {
    return 'https://crucible-api-testnet.jejunetwork.org'
  }
  return `http://${localhost}:${CRUCIBLE_API_PORT}`
}

export const API_URL = getApiBaseUrl()
