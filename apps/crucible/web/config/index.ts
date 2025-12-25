/**
 * Crucible Web Config
 *
 * Uses @jejunetwork/config for configuration.
 */

import { CORE_PORTS } from '@jejunetwork/config'

export const NETWORK_NAME = 'Jeju Network'

// API URL - proxied through frontend dev server in development
export const API_URL = ''

// Default ports from config
export const CRUCIBLE_PORT = CORE_PORTS.CRUCIBLE.DEFAULT
export const CRUCIBLE_API_PORT = CORE_PORTS.CRUCIBLE_API.DEFAULT
