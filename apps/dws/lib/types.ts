/**
 * DWS Types
 */

import type { Address } from 'viem'

export interface DWSConfig {
  rpcUrl: string
  privateKey?: string
  contracts: {
    storageRegistry?: Address
    computeRegistry?: Address
    jnsRegistry?: Address
  }
}

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  service: string
  version: string
  uptime: number
}

export interface AuthHeaders {
  'x-jeju-address': string
  'x-jeju-nonce': string
  'x-jeju-signature': string
  'x-jeju-timestamp': string
}

export type StorageTier = 0 | 1 | 2 | 3
export type BackendType = 'ipfs' | 'cloud' | 'arweave' | 'local'

export interface UploadResult {
  cid: string
  url: string
  size: number
  backend: string
  provider?: string
}

export interface InferenceRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

export interface InferenceResponse {
  id: string
  model: string
  choices: Array<{
    index: number
    message: { role: string; content: string }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ContentHash {
  protocol: 'ipfs' | 'ipns' | 'arweave' | 'http' | 'https'
  hash: string
}

export interface JNSGatewayConfig {
  port: number
  rpcUrl: string
  jnsRegistryAddress: Address
  jnsResolverAddress: Address
  ipfsGateway: string
  arweaveGateway: string
  domain: string
}
