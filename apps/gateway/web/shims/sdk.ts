/**
 * Browser shim for @jejunetwork/sdk
 *
 * Provides browser-safe stubs for SDK functions that may require Node.js
 */

// Type definitions
export interface JejuClientConfig {
  network?: string
  account?: unknown
  rpcUrl?: string
}

export interface JejuClient {
  network: string
  publicClient: unknown
  walletClient: unknown
  compute: unknown
  storage: unknown
  identity: unknown
  governance: unknown
  payments: unknown
  crossChain: unknown
  names: unknown
  defi: unknown
}

export interface UploadOptions {
  name?: string
  metadata?: Record<string, string>
}

export interface UploadResult {
  cid: string
  name: string
  size: number
}

export interface PinInfo {
  cid: string
  name: string
  size: number
  pinned: boolean
}

// Create a mock client for browser environments
export function createJejuClient(_config?: JejuClientConfig): JejuClient {
  console.warn('JejuClient in browser mode - some features may be limited')
  return {
    network: 'localnet',
    publicClient: null,
    walletClient: null,
    compute: {},
    storage: {},
    identity: {},
    governance: {},
    payments: {},
    crossChain: {},
    names: {},
    defi: {},
  }
}

// Export browser-safe functions
export function getClient() {
  console.warn('SDK getClient not available in browser')
  return null
}

export function getPublicClient() {
  console.warn('SDK getPublicClient not available in browser')
  return null
}

export function getWalletClient() {
  console.warn('SDK getWalletClient not available in browser')
  return null
}

// Export constants
export const SDK_VERSION = '0.0.0-browser'

