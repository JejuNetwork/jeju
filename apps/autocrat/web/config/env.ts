import {
  getApiKey,
  getChainId,
  getContract,
  getCurrentNetwork,
  getOAuth3Url,
  getRpcUrl,
  getServiceUrl,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'

// Network defaults - from centralized config
export const NETWORK = getCurrentNetwork()
export const CHAIN_ID = getChainId(NETWORK)
export const RPC_URL = getRpcUrl(NETWORK)

// External services - from config, empty means use relative URLs (same origin)
export const AUTOCRAT_API_URL =
  getServiceUrl('compute', 'nodeApi', NETWORK) || ''
export const OAUTH3_AGENT_URL = getOAuth3Url(NETWORK)

// Contract addresses - may not be deployed yet on localnet
function getAutocratAddress(): `0x${string}` {
  try {
    const addr = getContract('governance', 'autocrat', NETWORK)
    return (addr as `0x${string}`) || ZERO_ADDRESS
  } catch {
    // Contract not yet deployed - use zero address as fallback
    return ZERO_ADDRESS
  }
}
export const AUTOCRAT_ADDRESS = getAutocratAddress()

// WalletConnect - disabled by default in development
export const WALLETCONNECT_PROJECT_ID =
  NETWORK === 'localnet' ? '' : getApiKey('walletconnect') || ''
