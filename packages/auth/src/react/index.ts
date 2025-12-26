/**
 * OAuth3 React SDK
 *
 * Complete React integration with:
 * - OAuth3Provider context
 * - useOAuth3 hook
 * - Pre-built UI components
 * - Full TypeScript support
 */

export {
  ConnectedAccount,
  type ConnectedAccountProps,
} from './components/ConnectedAccount'
// UI Components
export { LoginButton, type LoginButtonProps } from './components/LoginButton'
export { LoginModal, type LoginModalProps } from './components/LoginModal'
export { MFASetup, type MFASetupProps } from './components/MFASetup'
export {
  type UseCredentialsReturn,
  useCredentials,
} from './hooks/useCredentials'
// Convenience hooks
export {
  type LinkedAccount,
  type UseJejuAuthReturn,
  useJejuAuth,
} from './hooks/useJejuAuth'
export { type UseJejuWalletReturn, useJejuWallet } from './hooks/useJejuWallet'
export {
  type UseLoginOptions,
  type UseLoginReturn,
  useLogin,
} from './hooks/useLogin'
export {
  type UseMFAOptions,
  type UseMFAReturn,
  useMFA,
} from './hooks/useMFA'
export { type UseSessionReturn, useSession } from './hooks/useSession'
// Alias for convenience
export {
  type OAuth3ContextValue,
  OAuth3Provider,
  OAuth3Provider as JejuAuthProvider,
  type OAuth3ProviderProps,
  useOAuth3,
  useOAuth3Client,
} from './provider'
