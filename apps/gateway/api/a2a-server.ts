/**
 * A2A Server Type Exports for Gateway
 *
 * The actual A2A server implementation is in a separate service.
 * This file provides type exports for the API client.
 */

import type { Elysia } from 'elysia'

// Export the App type for use by the API client
export type App = Elysia
