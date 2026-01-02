import { type Address, keccak256, toBytes } from 'viem'
import { z } from 'zod'
import { ORACLE_STAKING_MANAGER_ABI } from '../abis'
import type { SecureNodeClient } from '../contracts'

const OracleServiceConfigSchema = z.object({
  agentId: z.bigint(),
  stakeAmount: z.bigint(),
  markets: z.array(z.string().min(1)).min(1),
})

export interface OracleServiceConfig {
  agentId: bigint
  stakeAmount: bigint
  markets: string[] // Market identifiers to provide prices for
}

const OracleServiceStateSchema = z.object({
  isRegistered: z.boolean(),
  stake: z.bigint(),
  reputation: z.bigint(),
  accuracy: z.bigint(),
  submissionsCount: z.bigint(),
})

export interface OracleServiceState {
  isRegistered: boolean
  stake: bigint
  reputation: bigint
  accuracy: bigint
  submissionsCount: bigint
}

const PriceSubmissionSchema = z.object({
  market: z.string().min(1),
  price: z.bigint(),
  timestamp: z.number().int().positive(),
})

export interface PriceSubmission {
  market: string
  price: bigint
  timestamp: number
}

export function validateOracleServiceConfig(
  data: unknown,
): OracleServiceConfig {
  return OracleServiceConfigSchema.parse(data)
}

export function validateOracleServiceState(data: unknown): OracleServiceState {
  return OracleServiceStateSchema.parse(data)
}

export function validatePriceSubmission(data: unknown): PriceSubmission {
  return PriceSubmissionSchema.parse(data)
}

export class OracleService {
  private client: SecureNodeClient
  private submissionHistory: PriceSubmission[] = []

  constructor(client: SecureNodeClient) {
    this.client = client
  }

  async getState(address: Address): Promise<OracleServiceState> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error(`Invalid address: ${address}`)
    }

    const info = await this.client.publicClient.readContract({
      address: this.client.addresses.oracleStakingManager,
      abi: ORACLE_STAKING_MANAGER_ABI,
      functionName: 'getOracleInfo',
      args: [address],
    })

    const rawState = {
      isRegistered: info[0] > 0n,
      stake: info[0],
      reputation: info[1],
      accuracy: info[2],
      submissionsCount: info[3],
    }

    return validateOracleServiceState(rawState)
  }

  async register(config: OracleServiceConfig): Promise<string> {
    const validatedConfig = validateOracleServiceConfig(config)

    const hash = await this.client.txExecutor.writeContract({
      address: this.client.addresses.oracleStakingManager,
      abi: ORACLE_STAKING_MANAGER_ABI,
      functionName: 'registerOracle',
      args: [validatedConfig.agentId],
      value: validatedConfig.stakeAmount,
    })

    return hash
  }

  async submitPrice(market: string, price: bigint): Promise<string> {
    const marketHash = keccak256(toBytes(market))

    const hash = await this.client.txExecutor.writeContract({
      address: this.client.addresses.oracleStakingManager,
      abi: ORACLE_STAKING_MANAGER_ABI,
      functionName: 'submitPrice',
      args: [marketHash, price],
    })

    this.submissionHistory.push({
      market,
      price,
      timestamp: Date.now(),
    })

    return hash
  }

  getSubmissionHistory(): PriceSubmission[] {
    return [...this.submissionHistory]
  }

  /**
   * Start the oracle service
   * This begins periodic price fetching and submission
   */
  private running = false
  private priceUpdateInterval: ReturnType<typeof setInterval> | null = null

  async start(): Promise<void> {
    if (this.running) return

    console.log('[OracleService] Starting oracle service...')
    this.running = true

    // In production, this would fetch prices from external sources
    // and submit them periodically
    console.log('[OracleService] Oracle service started')
    console.log(
      '[OracleService] Note: Price submissions require manual registration first',
    )
  }

  async stop(): Promise<void> {
    if (!this.running) return

    console.log('[OracleService] Stopping oracle service...')

    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval)
      this.priceUpdateInterval = null
    }

    this.running = false
    console.log('[OracleService] Oracle service stopped')
  }

  isRunning(): boolean {
    return this.running
  }
}

export function createOracleService(client: SecureNodeClient): OracleService {
  return new OracleService(client)
}
