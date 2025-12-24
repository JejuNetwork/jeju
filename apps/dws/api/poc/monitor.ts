/**
 * Proof-of-Cloud Monitor - Continuous monitoring for TEE verification status
 */

import { getCurrentNetwork, getPoCConfig } from '@jejunetwork/config'
import { safeReadContract } from '@jejunetwork/contracts'
import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  http,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { createRegistryClient, type PoCRegistryClient } from './registry-client'
import type {
  PoCEventListener,
  PoCRevocation,
  PoCVerificationEvent,
} from './types'
import type { PoCVerifier } from './verifier'

interface PoCMonitorConfig {
  chain: Chain
  rpcUrl: string
  validatorAddress: Address
  identityRegistryAddress: Address
  checkInterval: number
  reverificationThreshold: number
  enableRevocationWatch: boolean
  batchSize: number
}

const POC_VALIDATOR_ABI = [
  {
    name: 'getAgentStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'verified', type: 'bool' },
      { name: 'level', type: 'uint8' },
      { name: 'hardwareIdHash', type: 'bytes32' },
      { name: 'expiresAt', type: 'uint256' },
    ],
  },
  {
    name: 'getHardwareRecord',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'hardwareIdHash', type: 'bytes32' }],
    outputs: [
      { name: 'hardwareIdHash', type: 'bytes32' },
      { name: 'level', type: 'uint8' },
      { name: 'agentId', type: 'uint256' },
      { name: 'verifiedAt', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'revoked', type: 'bool' },
      { name: 'cloudProvider', type: 'string' },
      { name: 'region', type: 'string' },
    ],
  },
] as const

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'totalAgents',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'agentExists',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getAgentTags',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string[]' }],
  },
] as const

interface MonitoredAgent {
  agentId: bigint
  hardwareIdHash: Hex | null
  lastChecked: number
  expiresAt: number
  status: 'verified' | 'pending' | 'expired' | 'revoked' | 'unknown'
}

interface RevocationAlert {
  hardwareIdHash: Hex
  agentId: bigint
  reason: string
  timestamp: number
  handled: boolean
}

export class PoCMonitor {
  private readonly config: PoCMonitorConfig
  private readonly publicClient
  private readonly registryClient: PoCRegistryClient
  private readonly verifier: PoCVerifier | null
  private readonly monitoredAgents = new Map<string, MonitoredAgent>()
  private readonly revocationAlerts: RevocationAlert[] = []
  private readonly eventListeners = new Set<PoCEventListener>()
  private checkIntervalId: ReturnType<typeof setInterval> | null = null
  private revocationUnsubscribe: (() => void) | null = null
  private isRunning = false

  constructor(config: PoCMonitorConfig, verifier?: PoCVerifier) {
    this.config = config
    this.verifier = verifier ?? null
    this.publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    })
    this.registryClient = createRegistryClient()
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[PoCMonitor] Already running')
      return
    }

    console.log('[PoCMonitor] Starting...')
    this.isRunning = true
    await this.scanTEEAgents()

    this.checkIntervalId = setInterval(
      () => this.runChecks(),
      this.config.checkInterval,
    )

    if (this.config.enableRevocationWatch) {
      this.revocationUnsubscribe = this.registryClient.subscribeToRevocations(
        (rev: PoCRevocation) => this.handleRevocation(rev),
      )
    }

    console.log('[PoCMonitor] Started')
  }

  stop(): void {
    if (!this.isRunning) return

    console.log('[PoCMonitor] Stopping...')
    this.isRunning = false

    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId)
      this.checkIntervalId = null
    }

    this.revocationUnsubscribe?.()
    this.revocationUnsubscribe = null

    console.log('[PoCMonitor] Stopped')
  }

  addAgent(agentId: bigint): void {
    const key = agentId.toString()
    if (!this.monitoredAgents.has(key)) {
      this.monitoredAgents.set(key, {
        agentId,
        hardwareIdHash: null,
        lastChecked: 0,
        expiresAt: 0,
        status: 'unknown',
      })
    }
  }

  removeAgent(agentId: bigint): void {
    this.monitoredAgents.delete(agentId.toString())
  }

  getAgentMonitorStatus(agentId: bigint): MonitoredAgent | null {
    return this.monitoredAgents.get(agentId.toString()) ?? null
  }

  getAllMonitoredAgents(): MonitoredAgent[] {
    return Array.from(this.monitoredAgents.values())
  }

  getAgentsNeedingAttention(): MonitoredAgent[] {
    const now = Date.now()
    return this.getAllMonitoredAgents().filter(
      (a) =>
        a.status === 'revoked' ||
        a.status === 'expired' ||
        (a.status === 'verified' &&
          a.expiresAt > 0 &&
          a.expiresAt - now < this.config.reverificationThreshold),
    )
  }

  private async scanTEEAgents(): Promise<void> {
    const totalAgents = await safeReadContract<bigint>(this.publicClient, {
      address: this.config.identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'totalAgents',
    })

    console.log(`[PoCMonitor] Scanning ${totalAgents} agents for TEE tags...`)

    for (let i = 1n; i <= totalAgents; i += BigInt(this.config.batchSize)) {
      const batch: bigint[] = []
      for (
        let j = i;
        j < i + BigInt(this.config.batchSize) && j <= totalAgents;
        j++
      ) {
        batch.push(j)
      }

      await Promise.all(
        batch.map(async (agentId) => {
          const exists = await safeReadContract<boolean>(this.publicClient, {
            address: this.config.identityRegistryAddress,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'agentExists',
            args: [agentId],
          })

          if (!exists) return

          const tags = await safeReadContract<string[]>(this.publicClient, {
            address: this.config.identityRegistryAddress,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'getAgentTags',
            args: [agentId],
          })

          const hasTEETag = tags.some(
            (tag: string) =>
              tag.toLowerCase().includes('tee') ||
              tag.toLowerCase().includes('tdx') ||
              tag.toLowerCase().includes('sgx') ||
              tag.toLowerCase().includes('sev'),
          )

          if (hasTEETag) this.addAgent(agentId)
        }),
      )
    }

    console.log(`[PoCMonitor] Found ${this.monitoredAgents.size} TEE agents`)
  }

  private async runChecks(): Promise<void> {
    if (!this.isRunning) return

    const agents = this.getAllMonitoredAgents()
    for (let i = 0; i < agents.length; i += this.config.batchSize) {
      const batch = agents.slice(i, i + this.config.batchSize)
      await Promise.all(batch.map((a) => this.checkAgent(a)))
    }

    await this.processRevocationAlerts()
  }

  private async checkAgent(agent: MonitoredAgent): Promise<void> {
    const result = await safeReadContract<[boolean, number, Hex, bigint]>(
      this.publicClient,
      {
        address: this.config.validatorAddress,
        abi: POC_VALIDATOR_ABI,
        functionName: 'getAgentStatus',
        args: [agent.agentId],
      },
    )

    const [verified, level, hardwareIdHash, expiresAt] = result

    agent.lastChecked = Date.now()
    agent.hardwareIdHash = hardwareIdHash as Hex
    agent.expiresAt = Number(expiresAt) * 1000

    if (
      !verified &&
      hardwareIdHash ===
        '0x0000000000000000000000000000000000000000000000000000000000000000'
    ) {
      agent.status = 'unknown'
    } else if (!verified) {
      const record = await safeReadContract<
        [boolean, number, bigint, bigint, bigint, boolean, Hex]
      >(this.publicClient, {
        address: this.config.validatorAddress,
        abi: POC_VALIDATOR_ABI,
        functionName: 'getHardwareRecord',
        args: [hardwareIdHash as `0x${string}`],
      })
      agent.status = record[5] ? 'revoked' : 'expired'
    } else {
      agent.status = 'verified'
      const timeUntilExpiry = agent.expiresAt - Date.now()
      if (timeUntilExpiry < this.config.reverificationThreshold) {
        this.emitEvent({
          type: 'result',
          timestamp: Date.now(),
          agentId: agent.agentId,
          requestHash: null,
          status: 'verified',
          level: level as 1 | 2 | 3,
          error: null,
          metadata: {
            warning: 'approaching_expiry',
            expiresIn: timeUntilExpiry,
          },
        })
      }
    }

    this.emitEvent({
      type: 'result',
      timestamp: Date.now(),
      agentId: agent.agentId,
      requestHash: null,
      status:
        agent.status === 'verified'
          ? 'verified'
          : agent.status === 'revoked'
            ? 'revoked'
            : agent.status === 'expired'
              ? 'rejected'
              : 'unknown',
      level: verified ? (level as 1 | 2 | 3) : null,
      error: null,
      metadata: { hardwareIdHash: agent.hardwareIdHash },
    })
  }

  private handleRevocation(revocation: PoCRevocation): void {
    console.log(
      `[PoCMonitor] Revocation received: ${revocation.hardwareIdHash}`,
    )

    for (const agent of this.monitoredAgents.values()) {
      if (agent.hardwareIdHash === revocation.hardwareIdHash) {
        this.revocationAlerts.push({
          hardwareIdHash: revocation.hardwareIdHash,
          agentId: agent.agentId,
          reason: revocation.reason,
          timestamp: revocation.timestamp,
          handled: false,
        })

        agent.status = 'revoked'

        this.emitEvent({
          type: 'revocation',
          timestamp: Date.now(),
          agentId: agent.agentId,
          requestHash: null,
          status: 'revoked',
          level: null,
          error: null,
          metadata: {
            reason: revocation.reason,
            evidenceHash: revocation.evidenceHash,
          },
        })
      }
    }
  }

  private async processRevocationAlerts(): Promise<void> {
    for (const alert of this.revocationAlerts.filter((a) => !a.handled)) {
      if (this.verifier) {
        await this.verifier.revokeHardware(alert.hardwareIdHash, alert.reason)
      }
      alert.handled = true
    }

    // Clean old alerts
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (let i = this.revocationAlerts.length - 1; i >= 0; i--) {
      if (
        this.revocationAlerts[i].handled &&
        this.revocationAlerts[i].timestamp < cutoff
      ) {
        this.revocationAlerts.splice(i, 1)
      }
    }
  }

  getRevocationAlerts(): RevocationAlert[] {
    return [...this.revocationAlerts]
  }

  async triggerReverification(agentId: bigint, quote: Hex): Promise<void> {
    if (!this.verifier) throw new Error('Verifier not configured')

    console.log(`[PoCMonitor] Triggering re-verification for agent ${agentId}`)
    await this.verifier.verifyAttestation(agentId, quote)

    const agent = this.monitoredAgents.get(agentId.toString())
    if (agent) await this.checkAgent(agent)
  }

  getAgentsDueForReverification(): bigint[] {
    const threshold = Date.now() + this.config.reverificationThreshold
    return this.getAllMonitoredAgents()
      .filter(
        (a) =>
          a.status === 'verified' && a.expiresAt > 0 && a.expiresAt < threshold,
      )
      .map((a) => a.agentId)
  }

  addEventListener(listener: PoCEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  private emitEvent(event: PoCVerificationEvent): void {
    for (const listener of this.eventListeners) listener(event)
  }

  getStats(): {
    totalMonitored: number
    verified: number
    expired: number
    revoked: number
    unknown: number
    pendingAlerts: number
  } {
    const agents = this.getAllMonitoredAgents()
    return {
      totalMonitored: agents.length,
      verified: agents.filter((a) => a.status === 'verified').length,
      expired: agents.filter((a) => a.status === 'expired').length,
      revoked: agents.filter((a) => a.status === 'revoked').length,
      unknown: agents.filter((a) => a.status === 'unknown').length,
      pendingAlerts: this.revocationAlerts.filter((a) => !a.handled).length,
    }
  }

  /**
   * Create monitor from config
   *
   * Config values from packages/config:
   * - validatorAddress: contracts.json -> external.baseSepolia.poc.validator
   * - identityRegistryAddress: contracts.json -> external.baseSepolia.poc.identityRegistry
   * - rpcUrl: contracts.json -> external.baseSepolia.rpcUrl
   */
  static fromEnv(verifier?: PoCVerifier): PoCMonitor {
    const network = getCurrentNetwork()
    const chain = network === 'mainnet' ? base : baseSepolia
    const pocConfig = getPoCConfig()

    if (!pocConfig.validatorAddress)
      throw new Error('PoC validator not configured')
    if (!pocConfig.identityRegistryAddress)
      throw new Error('PoC identity registry not configured')

    return new PoCMonitor(
      {
        chain,
        rpcUrl: pocConfig.rpcUrl,
        validatorAddress: pocConfig.validatorAddress as Address,
        identityRegistryAddress: pocConfig.identityRegistryAddress as Address,
        checkInterval: Number(process.env.POC_CHECK_INTERVAL) || 60 * 60 * 1000,
        reverificationThreshold:
          Number(process.env.POC_REVERIFY_THRESHOLD) || 24 * 60 * 60 * 1000,
        enableRevocationWatch: process.env.POC_REVOCATION_WATCH !== 'false',
        batchSize: Number(process.env.POC_BATCH_SIZE) || 10,
      },
      verifier,
    )
  }
}
