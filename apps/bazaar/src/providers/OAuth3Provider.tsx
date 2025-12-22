/**
 * OAuth3 Provider for Bazaar
 *
 * Re-exports the OAuth3 provider from @jejunetwork/oauth3 for consistent
 * authentication across the network.
 */

// Re-export from the canonical OAuth3 package
export {
  OAuth3Provider,
  useOAuth3,
  type OAuth3ContextValue,
  type OAuth3ProviderProps,
} from '@jejunetwork/oauth3/react'

export type { OAuth3Config, OAuth3Session } from '@jejunetwork/oauth3'
