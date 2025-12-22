/**
 * OAuth3 Provider for Bazaar
 *
 * Re-exports the OAuth3 provider from @jejunetwork/oauth3 for consistent
 * authentication across the network.
 */

export type { OAuth3Config, OAuth3Session } from '@jejunetwork/oauth3'
// Re-export from the canonical OAuth3 package
export {
  type OAuth3ContextValue,
  OAuth3Provider,
  type OAuth3ProviderProps,
  useOAuth3,
} from '@jejunetwork/oauth3/react'
