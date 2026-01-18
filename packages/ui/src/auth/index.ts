/**
 * Jeju Auth UI Components
 *
 * Standardized authentication UI that integrates with the KMS-based OAuth3 system.
 * Re-exports from @jejunetwork/auth/react with additional convenience components.
 */

// Re-export all auth components and hooks from @jejunetwork/auth/react
export {
  ConnectedAccount,
  type ConnectedAccountProps,
  type LinkedAccount,
  LoginButton,
  type LoginButtonProps,
  LoginModal,
  type LoginModalProps,
  MFASetup,
  type MFASetupProps,
  type OAuth3ContextValue,
  OAuth3Provider,
  OAuth3Provider as JejuAuthProvider,
  type OAuth3ProviderProps,
  type TypedDataParams,
  type UseCredentialsReturn,
  type UseJejuAuthReturn,
  type UseJejuWalletReturn,
  type UseLoginOptions,
  type UseLoginReturn,
  type UseMFAOptions,
  type UseMFAReturn,
  type UseSessionReturn,
  useCredentials,
  useJejuAuth,
  useJejuWallet,
  useLogin,
  useMFA,
  useOAuth3,
  useOAuth3Client,
  useSession,
} from '@jejunetwork/auth/react'
// Export the auth header component
export {
  AuthHeaderButton,
  type AuthHeaderButtonProps,
} from './AuthHeaderButton'
// Export the unified auth button
export { JejuAuthButton, type JejuAuthButtonProps } from './JejuAuthButton'
