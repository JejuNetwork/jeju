/**
 * Extension Types
 *
 * Shared type definitions for browser extension messaging and EIP-1193 compatibility.
 */

import type { Address, Hex } from 'viem'

// ============================================================================
// EIP-1193 Provider Types
// ============================================================================

/**
 * EIP-1193 request arguments
 */
export interface EIP1193RequestArguments {
  method: string
  params?: EIP1193Params
}

/**
 * Valid parameter types for EIP-1193 requests
 * Based on the Ethereum JSON-RPC specification
 */
export type EIP1193Param =
  | string
  | number
  | boolean
  | null
  | EIP1193ParamObject
  | EIP1193Param[]

export interface EIP1193ParamObject {
  [key: string]: EIP1193Param
}

export type EIP1193Params = EIP1193Param[]

/**
 * EIP-1193 provider error
 */
export interface EIP1193ProviderError extends Error {
  code: number
  data?: EIP1193Param
}

/**
 * Standard Ethereum RPC error codes
 */
export const EIP1193ErrorCodes = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
} as const

// ============================================================================
// wallet_addEthereumChain Types (EIP-3085)
// ============================================================================

/**
 * Parameters for wallet_addEthereumChain request (EIP-3085)
 */
export interface AddEthereumChainParameter {
  chainId: Hex // Required. A 0x-prefixed hex string
  chainName: string
  nativeCurrency: {
    name: string
    symbol: string // 2-6 characters
    decimals: 18 // Must be 18
  }
  rpcUrls: string[] // At least one URL
  blockExplorerUrls?: string[]
  iconUrls?: string[]
}

// ============================================================================
// Cross-Chain Transfer Types (Jeju-specific)
// ============================================================================

/**
 * Parameters for jeju_crossChainTransfer
 */
export interface CrossChainTransferData {
  sourceChainId: number
  destinationChainId: number
  token: Address
  amount: string
  recipient: Address
  maxFee?: string
}

// ============================================================================
// Intent Types (Jeju-specific)
// ============================================================================

/**
 * Parameters for jeju_submitIntent
 */
export interface SubmitIntentData {
  inputToken: Address
  inputAmount: string
  outputToken: Address
  minOutputAmount: string
  destinationChainId: number
  recipient?: Address
  maxFee?: string
  deadline?: number
}

// ============================================================================
// Extension Message Types
// ============================================================================

/**
 * Message types supported by the extension
 */
export type ExtensionMessageType =
  | 'connect'
  | 'disconnect'
  | 'eth_requestAccounts'
  | 'eth_accounts'
  | 'eth_chainId'
  | 'eth_sendTransaction'
  | 'eth_signTypedData_v4'
  | 'personal_sign'
  | 'wallet_switchEthereumChain'
  | 'wallet_addEthereumChain'
  | 'jeju_crossChainTransfer'
  | 'jeju_submitIntent'

/**
 * Message from content script to background
 */
export interface ExtensionMessage {
  type: ExtensionMessageType
  data?: Record<string, EIP1193Param>
  id?: string
}

/**
 * Response from background to content script
 */
export type ExtensionMessageResponse =
  | { error: string }
  | string
  | string[]
  | null
  | boolean

// ============================================================================
// Popup Communication Types
// ============================================================================

/**
 * Response from popup after user interaction
 */
export interface PopupResponse {
  type: 'popup_response'
  requestId: string
  approved: boolean
  hash?: Hex
  signature?: Hex
  intentId?: Hex
}

/**
 * Response from popup for connection approval
 */
export interface ConnectionResponse {
  type: 'connection_response'
  origin: string
  approved: boolean
}

// ============================================================================
// Page <-> Content Script Communication Types
// ============================================================================

/**
 * Request from injected script to content script
 */
export interface PageRequest {
  type: 'jeju_request'
  method: string
  params?: EIP1193Params
  id: string
}

/**
 * Response from content script to injected script
 */
export interface PageResponse {
  type: 'jeju_response'
  id: string
  result?: EIP1193Param
  error?: { code: number; message: string }
}

/**
 * Event broadcast from content script to injected script
 */
export interface PageEvent {
  type: 'jeju_event'
  event: string
  data: BroadcastEventData
}

// ============================================================================
// Broadcast Event Types
// ============================================================================

/**
 * Events broadcast to connected tabs
 */
export type BroadcastEventData =
  | { type: 'chainChanged'; chainId: Hex }
  | { type: 'accountsChanged'; accounts: Address[] }
  | { type: 'connect'; chainId: Hex }
  | { type: 'disconnect'; code: number; message: string }

// ============================================================================
// Event Emitter Types
// ============================================================================

/**
 * Standard Ethereum provider events
 */
export type ProviderEventName =
  | 'chainChanged'
  | 'accountsChanged'
  | 'connect'
  | 'disconnect'
  | 'message'

/**
 * Callback argument types by event name
 */
export interface ProviderEventArgs {
  chainChanged: [chainId: Hex]
  accountsChanged: [accounts: Address[]]
  connect: [info: { chainId: Hex }]
  disconnect: [error: { code: number; message: string }]
  message: [message: { type: string; data: EIP1193Param }]
}

/**
 * Type-safe event callback
 */
export type ProviderEventCallback<
  T extends ProviderEventName = ProviderEventName,
> = (...args: ProviderEventArgs[T]) => void

// ============================================================================
// Provider Info (EIP-6963)
// ============================================================================

/**
 * Provider info for EIP-6963 announcement
 */
export interface EIP6963ProviderInfo {
  uuid: string
  name: string
  icon: string
  rdns: string
}

// ============================================================================
// Chrome Extension Message Types
// ============================================================================

/**
 * Message from background to content script for event broadcast
 */
export interface BackgroundEventMessage {
  type?: string
  chainId?: Hex
  accounts?: Address[]
}
