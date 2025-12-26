/**
 * Crucible Web Config
 */

import {
  CORE_PORTS,
  getCurrentNetwork,
  getServiceUrl,
} from '@jejunetwork/config'

export const NETWORK_NAME = 'Jeju Network'

const NETWORK = getCurrentNetwork()

// API URL - use config, fall back to empty for proxied dev
export const API_URL = getServiceUrl('compute', 'nodeApi', NETWORK) || ''

// Default ports from config
export const CRUCIBLE_PORT = CORE_PORTS.CRUCIBLE.DEFAULT
export const CRUCIBLE_API_PORT = CORE_PORTS.CRUCIBLE_API.DEFAULT
