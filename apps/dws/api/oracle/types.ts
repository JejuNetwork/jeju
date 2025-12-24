import type { Address, Hex } from 'viem'

export interface OracleNodeConfig {
  rpcUrl: string
  chainId: number
  operatorPrivateKey: Hex
  workerPrivateKey: Hex
  feedRegistry: Address
  reportVerifier: Address
  committeeManager: Address
  feeRouter: Address
  networkConnector: Address
  pollIntervalMs: number
  heartbeatIntervalMs: number
  metricsPort: number
  priceSources: PriceSourceConfig[]
}

export interface PriceSourceConfig {
  type: 'uniswap_v3' | 'chainlink' | 'manual'
  address: Address
  feedId: Hex
  decimals: number
}

export interface PriceReport {
  feedId: Hex
  price: bigint
  confidence: bigint
  timestamp: bigint
  round: bigint
  sourcesHash: Hex
}

export interface SignedReport {
  report: PriceReport
  signatures: Hex[]
  signers: Address[]
}

export interface FeedSpec {
  feedId: Hex
  symbol: string
  baseToken: Address
  quoteToken: Address
  decimals: number
  heartbeatSeconds: number
  twapWindowSeconds: number
  minLiquidityUSD: bigint
  maxDeviationBps: number
  minOracles: number
  quorumThreshold: number
  isActive: boolean
  category: number
}

export interface Committee {
  feedId: Hex
  round: bigint
  members: Address[]
  threshold: number
  activeUntil: bigint
  leader: Address
  isActive: boolean
}

export interface NodeMetrics {
  reportsSubmitted: number
  reportsAccepted: number
  reportsRejected: number
  lastReportTime: number
  lastHeartbeat: number
  feedPrices: Map<string, bigint>
  uptime: number
}

export type { NetworkType } from '@jejunetwork/types'
