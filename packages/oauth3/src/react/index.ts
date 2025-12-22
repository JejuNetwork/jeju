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
} from './components/ConnectedAccount.js'
// UI Components
export { LoginButton, type LoginButtonProps } from './components/LoginButton.js'
export { LoginModal, type LoginModalProps } from './components/LoginModal.js'
export { MFASetup, type MFASetupProps } from './components/MFASetup.js'
export {
  type UseCredentialsReturn,
  useCredentials,
} from './hooks/useCredentials.js'
export {
  type UseLoginOptions,
  type UseLoginReturn,
  useLogin,
} from './hooks/useLogin.js'
export {
  type UseMFAOptions,
  type UseMFAReturn,
  useMFA,
} from './hooks/useMFA.js'
export { type UseSessionReturn, useSession } from './hooks/useSession.js'
export {
  type OAuth3ContextValue,
  OAuth3Provider,
  type OAuth3ProviderProps,
  useOAuth3,
  useOAuth3Client,
} from './provider.js'
