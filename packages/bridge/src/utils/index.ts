/**
 * Utility Functions
 */

import { keccak_256 } from '@noble/hashes/sha3'
import pRetry from 'p-retry'

// Re-export logger
export { createLogger, type Logger, type LogLevel } from './logger.js'

// Re-export validation utilities
export {
  type AWSNitroConfig as ValidationAWSNitroConfig,
  AWSNitroConfigSchema,
  type BatchProofResponse,
  BatchProofResponseSchema,
  ConsensusSnapshotSchema,
  CrossChainTransferSchema,
  computeMerkleRoot,
  EthereumUpdateSchema,
  EVMChainConfigSchema,
  type EVMRPCResponse,
  EVMRPCResponseSchema,
  type GCPConfidentialConfig as ValidationGCPConfidentialConfig,
  GCPConfidentialConfigSchema,
  GCPTokenResponseSchema,
  type Groth16Data,
  Groth16DataSchema,
  getHomeDir,
  HyperCoreClearinghouseResponseSchema,
  HyperCoreL2BookResponseSchema,
  type HyperCoreMarket,
  HyperCoreMarketSchema,
  HyperCoreMarketsResponseSchema,
  HyperCoreOrderResponseSchema,
  type HyperCorePosition,
  HyperCorePositionSchema,
  hashToHex,
  hexToHash32,
  JupiterQuoteResponseSchema,
  type NitroDocument,
  NitroDocumentSchema,
  OrchestratorConfigSchema,
  OrderbookLevelSchema,
  OrderbookResponseSchema,
  type PhalaAttestationResponse,
  PhalaAttestationResponseSchema,
  type PhalaConfig as ValidationPhalaConfig,
  PhalaConfigSchema,
  type PhalaHealthResponse,
  PhalaHealthResponseSchema,
  PhalaVerifyResponseSchema,
  // Types
  type ProofData,
  // Schemas
  ProofDataSchema,
  RelayerEnvSchema,
  requireEnv,
  SolanaConfigSchema,
  type SolanaHealthResponse as SolanaHealthResponseType,
  SolanaHealthResponseSchema,
  type SP1Config as ValidationSP1Config,
  SP1ConfigSchema,
  type SP1ProofResponse,
  SP1ProofResponseSchema,
  type SuccinctProveResponse,
  SuccinctProveResponseSchema,
  TransferSubmissionSchema,
  // Relayer schemas
  ValidatorVoteSchema,
  type WormholeVAAResponse,
  WormholeVAAResponseSchema,
} from './validation.js'

import type { Hash32 } from '../types/index.js'
import { toHash32 } from '../types/index.js'

/**
 * Convert a hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array, prefix = true): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return prefix ? `0x${hex}` : hex
}

/**
 * Convert a 20-byte EVM address to 32-byte format
 */
export function evmAddressTo32Bytes(address: string): Uint8Array {
  const bytes = hexToBytes(address)
  if (bytes.length !== 20) {
    throw new Error(`Invalid EVM address length: ${bytes.length}`)
  }
  const padded = new Uint8Array(32)
  padded.set(bytes, 12) // Right-align
  return padded
}

/**
 * Extract 20-byte EVM address from 32-byte format
 */
export function bytes32ToEvmAddress(bytes: Uint8Array): string {
  if (bytes.length !== 32) {
    throw new Error(`Invalid bytes32 length: ${bytes.length}`)
  }
  return bytesToHex(bytes.slice(12))
}

/**
 * Keccak256 hash using @noble/hashes
 */
export function keccak256(data: Uint8Array): Hash32 {
  return toHash32(keccak_256(data))
}

/**
 * Async keccak256 for compatibility
 */
export async function keccak256Async(data: Uint8Array): Promise<Hash32> {
  return keccak256(data)
}

/**
 * Pad a number to bytes
 */
export function numberToBytes(num: bigint, length: number): Uint8Array {
  const hex = num.toString(16).padStart(length * 2, '0')
  return hexToBytes(hex)
}

/**
 * Read a big-endian uint from bytes
 */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = BigInt(0)
  for (const byte of bytes) {
    result = (result << BigInt(8)) + BigInt(byte)
  }
  return result
}

/**
 * Compare two byte arrays
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Concatenate multiple byte arrays
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry a function with exponential backoff using p-retry
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  return pRetry(fn, {
    retries: maxRetries,
    minTimeout: baseDelayMs,
    factor: 2, // Exponential backoff factor
  })
}
