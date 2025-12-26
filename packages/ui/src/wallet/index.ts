/**
 * Decentralized Wallet Module
 *
 * Provides wallet connection without centralized dependencies like WalletConnect.
 * Uses only injected wallets (MetaMask, etc.) via wagmi.
 *
 * @example
 * ```tsx
 * import { createDecentralizedWagmiConfig, JEJU_CHAINS, WalletButton } from '@jejunetwork/ui'
 *
 * const config = createDecentralizedWagmiConfig({
 *   chains: [JEJU_CHAINS.localnet],
 *   appName: 'My App',
 * })
 *
 * function App() {
 *   return (
 *     <WagmiProvider config={config}>
 *       <WalletButton />
 *     </WagmiProvider>
 *   )
 * }
 * ```
 */

export {
  type ChainConfig,
  type CreateWagmiConfigOptions,
  createDecentralizedWagmiConfig,
  ETHEREUM_MAINNET,
  JEJU_CHAINS,
} from './config'

export { useWallet, WalletButton, type WalletButtonProps } from './WalletButton'
