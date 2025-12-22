/**
 * Eden Client for DWS API
 * Provides end-to-end type-safe API calls
 */

import { treaty } from '@elysiajs/eden'
import type { App } from '@jejunetwork/dws/server'
import { DWS_API_URL } from '../config'

// Create type-safe Eden client
export const api = treaty<App>(DWS_API_URL)

// Export types for use in components
export type { App }
