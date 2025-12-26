/**
 * Type declarations for Synpress modules
 * These packages don't have properly resolved type declarations in bun
 */

declare module '@synthetixio/synpress-cache' {
  import type { BrowserContext, Page } from '@playwright/test'

  export function defineWalletSetup(
    password: string,
    setupFn: (context: BrowserContext, walletPage: Page) => Promise<void>,
  ): unknown
}

declare module '@synthetixio/synpress/playwright' {
  import type { test as base } from '@playwright/test'
  import type { BrowserContext, Page } from '@playwright/test'

  // Wallet setup function result from defineWalletSetup
  type WalletSetup = unknown

  // MetaMask fixtures function
  export function metaMaskFixtures(
    walletSetup: WalletSetup,
    extensionIndex?: number,
  ): typeof base

  // Network configuration for MetaMask
  export interface NetworkConfig {
    name: string
    rpcUrl: string
    chainId: number
    symbol: string
  }

  // MetaMask class for wallet interactions
  export class MetaMask {
    constructor(
      context: BrowserContext,
      walletPage: Page,
      password: string,
      extensionId?: string,
    )
    importWallet(seedPhrase: string): Promise<void>
    addNewAccount(accountName: string): Promise<void>
    importWalletFromPrivateKey(privateKey: string): Promise<void>
    switchAccount(accountName: string): Promise<void>
    addNetwork(network: NetworkConfig): Promise<void>
    getAccountAddress(): Promise<string>
    switchNetwork(networkName: string, isTestnet?: boolean): Promise<void>
    connectToDapp(accounts?: string[]): Promise<void>
    lock(): Promise<void>
    unlock(): Promise<void>
    confirmSignature(): Promise<void>
    confirmSignatureWithRisk(): Promise<void>
    rejectSignature(): Promise<void>
    approveNewNetwork(): Promise<void>
    rejectNewNetwork(): Promise<void>
    approveSwitchNetwork(): Promise<void>
    rejectSwitchNetwork(): Promise<void>
    confirmTransaction(options?: { gasSetting?: unknown }): Promise<void>
    rejectTransaction(): Promise<void>
    approveTokenPermission(options?: {
      spendLimit?: 'max' | number
      gasSetting?: unknown
    }): Promise<void>
    rejectTokenPermission(): Promise<void>
    goBackToHomePage(): Promise<void>
    resetAccount(): Promise<void>
    addNewToken(): Promise<void>
    providePublicEncryptionKey(): Promise<void>
    decrypt(): Promise<void>
    confirmTransactionAndWaitForMining(options?: {
      gasSetting?: unknown
    }): Promise<void>
  }
}

declare module '@synthetixio/synpress-metamask/playwright' {
  import type { test as base } from '@playwright/test'
  import type { BrowserContext, Page } from '@playwright/test'

  // Wallet setup function result from defineWalletSetup
  type WalletSetup = unknown

  // MetaMask fixtures function
  export function metaMaskFixtures(
    walletSetup: WalletSetup,
    extensionIndex?: number,
  ): typeof base

  export interface NetworkConfig {
    name: string
    rpcUrl: string
    chainId: number
    symbol: string
  }

  export class MetaMask {
    constructor(
      context: BrowserContext,
      walletPage: Page,
      password: string,
      extensionId?: string,
    )
    importWallet(seedPhrase: string): Promise<void>
    addNewAccount(accountName: string): Promise<void>
    importWalletFromPrivateKey(privateKey: string): Promise<void>
    switchAccount(accountName: string): Promise<void>
    addNetwork(network: NetworkConfig): Promise<void>
    getAccountAddress(): Promise<string>
    switchNetwork(networkName: string, isTestnet?: boolean): Promise<void>
    connectToDapp(accounts?: string[]): Promise<void>
    lock(): Promise<void>
    unlock(): Promise<void>
    confirmSignature(): Promise<void>
    confirmSignatureWithRisk(): Promise<void>
    rejectSignature(): Promise<void>
    approveNewNetwork(): Promise<void>
    rejectNewNetwork(): Promise<void>
    approveSwitchNetwork(): Promise<void>
    rejectSwitchNetwork(): Promise<void>
    confirmTransaction(options?: { gasSetting?: unknown }): Promise<void>
    rejectTransaction(): Promise<void>
    approveTokenPermission(options?: {
      spendLimit?: 'max' | number
      gasSetting?: unknown
    }): Promise<void>
    rejectTokenPermission(): Promise<void>
    goBackToHomePage(): Promise<void>
    resetAccount(): Promise<void>
    addNewToken(): Promise<void>
    providePublicEncryptionKey(): Promise<void>
    decrypt(): Promise<void>
    confirmTransactionAndWaitForMining(options?: {
      gasSetting?: unknown
    }): Promise<void>
  }
}
