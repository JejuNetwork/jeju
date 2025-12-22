/**
 * OAuth3 React SDK
 * 
 * Complete React integration with:
 * - OAuth3Provider context
 * - useOAuth3 hook
 * - Pre-built UI components
 * - Full TypeScript support
 */

export { OAuth3Provider, useOAuth3, useOAuth3Client, type OAuth3ProviderProps, type OAuth3ContextValue } from './provider.js';
export { useLogin, type UseLoginOptions, type UseLoginReturn } from './hooks/useLogin.js';
export { useMFA, type UseMFAOptions, type UseMFAReturn } from './hooks/useMFA.js';
export { useCredentials, type UseCredentialsReturn } from './hooks/useCredentials.js';
export { useSession, type UseSessionReturn } from './hooks/useSession.js';

// UI Components
export { LoginButton, type LoginButtonProps } from './components/LoginButton.js';
export { LoginModal, type LoginModalProps } from './components/LoginModal.js';
export { ConnectedAccount, type ConnectedAccountProps } from './components/ConnectedAccount.js';
export { MFASetup, type MFASetupProps } from './components/MFASetup.js';
