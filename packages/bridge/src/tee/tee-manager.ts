/**
 * TEE Manager - Unified TEE provider management with auto-detection
 * Priority: AWS Nitro > GCP Confidential > Phala > Mock
 */

import {
  getAwsEnclaveId,
  getPhalaEndpoint,
  isTestMode,
} from '@jejunetwork/config'

// Dynamic import for Node.js-only fs (TEE detection only runs in Node.js)
async function existsSyncSafe(path: string): Promise<boolean> {
  try {
    const fs = await import('node:fs')
    return fs.existsSync(path)
  } catch {
    return false
  }
}

import type { Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import type {
  CrossChainTransfer,
  Hash32,
  TEEAttestation,
} from '../types/index.js'
import { toHash32 } from '../types/index.js'
import { computeMerkleRoot, createLogger } from '../utils/index.js'
import { createAWSNitroProvider } from './aws-nitro-provider.js'
import { createGCPConfidentialProvider } from './gcp-confidential-provider.js'
import { createMockProvider } from './mock-provider.js'
import { createPhalaClient, type PhalaClient } from './phala-client.js'
import type {
  AttestationRequest,
  AttestationResponse,
  AttestationVerification,
  ITEEProvider,
  TEECapability,
  TEEEnvironment,
  TEEProvider,
  TEEProviderConfig,
} from './types.js'

const log = createLogger('tee-manager')

export class TEEManager {
  private config: TEEProviderConfig
  private provider: ITEEProvider | null = null
  private initialized = false
  private environment: TEEEnvironment | null = null

  constructor(config?: Partial<TEEProviderConfig>) {
    this.config = { provider: 'auto', timeoutMs: 30000, ...config }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    this.environment = await this.detectEnvironment()
    log.info('Detected environment', { provider: this.environment.provider })

    this.provider = await this.selectProvider()
    await this.provider.initialize()
    this.initialized = true
  }

  getProvider(): ITEEProvider {
    if (!this.provider) throw new Error('TEE Manager not initialized')
    return this.provider
  }

  getEnvironment(): TEEEnvironment | null {
    return this.environment
  }

  async requestAttestation(
    request: AttestationRequest,
  ): Promise<AttestationResponse> {
    if (!this.initialized) await this.initialize()
    if (!this.provider) throw new Error('TEE provider not initialized')
    return this.provider.requestAttestation(request)
  }

  async verifyAttestation(
    attestation: AttestationResponse,
  ): Promise<AttestationVerification> {
    if (!this.initialized) await this.initialize()
    if (!this.provider) throw new Error('TEE provider not initialized')
    return this.provider.verifyAttestation(attestation)
  }

  async attestBatch(
    batchId: Hash32,
    transfers: CrossChainTransfer[],
    _operatorAddress?: Hex,
  ): Promise<{
    batchId: Hash32
    transfersRoot: Hash32
    transferCount: number
    attestation: AttestationResponse
  }> {
    if (!this.initialized) await this.initialize()
    if (!this.provider) throw new Error('TEE provider not initialized')

    const transfersRoot = computeMerkleRoot(
      transfers.map((t) => t.transferId),
      (data) => this.keccakHash(data),
    )
    const attestData = keccak256(
      new Uint8Array([
        ...batchId,
        ...transfersRoot,
        ...toBytes(BigInt(transfers.length)),
      ]),
    )

    const attestation = await this.provider.requestAttestation({
      data: attestData,
      nonce: BigInt(Date.now()),
    })

    return {
      batchId,
      transfersRoot,
      transferCount: transfers.length,
      attestation,
    }
  }

  async getStatus(): Promise<{
    initialized: boolean
    provider: TEEProvider
    environment: TEEEnvironment | null
    providerStatus: Awaited<ReturnType<ITEEProvider['getStatus']>> | null
  }> {
    const providerType: TEEProvider = this.provider?.provider ?? 'mock'
    return {
      initialized: this.initialized,
      provider: providerType,
      environment: this.environment,
      providerStatus: this.provider ? await this.provider.getStatus() : null,
    }
  }

  private async detectEnvironment(): Promise<TEEEnvironment> {
    // Fast path for test environment - skip slow network detection
    if (isTestMode()) {
      return {
        provider: 'mock',
        inTEE: false,
        capabilities: ['attestation', 'key_gen'],
        details: { platform: 'local' },
      }
    }

    const awsEnv = await this.detectAWS()
    if (awsEnv.inTEE) return awsEnv

    const gcpEnv = await this.detectGCP()
    if (gcpEnv.inTEE) return gcpEnv

    if (getPhalaEndpoint()) {
      return {
        provider: 'phala',
        inTEE: false,
        capabilities: ['attestation', 'key_gen'],
        details: { platform: 'phala' },
      }
    }

    return {
      provider: 'mock',
      inTEE: false,
      capabilities: ['attestation', 'key_gen'],
      details: { platform: 'local' },
    }
  }

  private async detectAWS(): Promise<TEEEnvironment> {
    const env: TEEEnvironment = {
      provider: 'aws',
      inTEE: false,
      capabilities: [],
      details: {},
    }

    try {
      const response = await fetch(
        'http://169.254.169.254/latest/meta-data/instance-id',
        {
          signal: AbortSignal.timeout(1000),
        },
      )

      if (response.ok) {
        env.details.instanceId = await response.text()
        env.details.platform = 'aws'

        // Check for NSM device
        const enclaveId = getAwsEnclaveId()
        const hasNsm = await existsSyncSafe('/dev/nsm')
        if (hasNsm || enclaveId) {
          env.inTEE = true
          env.capabilities = ['attestation', 'key_gen', 'persistent']
          env.details.enclaveId = enclaveId
        }

        const regionResp = await fetch(
          'http://169.254.169.254/latest/meta-data/placement/region',
          {
            signal: AbortSignal.timeout(1000),
          },
        )
        if (regionResp.ok) env.details.region = await regionResp.text()
      }
    } catch {
      // Not in AWS
    }

    return env
  }

  private async detectGCP(): Promise<TEEEnvironment> {
    const env: TEEEnvironment = {
      provider: 'gcp',
      inTEE: false,
      capabilities: [],
      details: {},
    }

    try {
      const response = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/id',
        {
          headers: { 'Metadata-Flavor': 'Google' },
          signal: AbortSignal.timeout(1000),
        },
      )

      if (response.ok) {
        env.details.instanceId = await response.text()
        env.details.platform = 'gcp'

        const attrsResp = await fetch(
          'http://metadata.google.internal/computeMetadata/v1/instance/attributes/',
          {
            headers: { 'Metadata-Flavor': 'Google' },
            signal: AbortSignal.timeout(1000),
          },
        )

        if (attrsResp.ok) {
          const attrs = await attrsResp.text()
          if (
            attrs.includes('confidential-compute') ||
            attrs.includes('enable-vtpm')
          ) {
            env.inTEE = true
            env.capabilities = ['attestation', 'key_gen']

            const machineResp = await fetch(
              'http://metadata.google.internal/computeMetadata/v1/instance/machine-type',
              {
                headers: { 'Metadata-Flavor': 'Google' },
                signal: AbortSignal.timeout(1000),
              },
            )
            if (machineResp.ok) {
              const machineType = await machineResp.text()
              if (machineType.includes('a3-')) env.capabilities.push('gpu')
            }
          }
        }

        const zoneResp = await fetch(
          'http://metadata.google.internal/computeMetadata/v1/instance/zone',
          {
            headers: { 'Metadata-Flavor': 'Google' },
            signal: AbortSignal.timeout(1000),
          },
        )
        if (zoneResp.ok) {
          const zone = await zoneResp.text()
          env.details.region = zone.split('/').pop()
        }
      }
    } catch {
      // Not in GCP
    }

    return env
  }

  private async selectProvider(): Promise<ITEEProvider> {
    if (this.config.provider !== 'auto') {
      return this.createProvider(this.config.provider)
    }

    if (!this.environment || this.environment.provider === 'mock') {
      if (this.config.requireRealTEE) {
        throw new Error(
          'No real TEE environment detected but requireRealTEE=true. ' +
            'Deploy to AWS Nitro, GCP Confidential VM, or configure Phala endpoint.',
        )
      }
      return createMockProvider()
    }

    return this.createProvider(this.environment.provider)
  }

  private createProvider(provider: TEEProvider): ITEEProvider {
    switch (provider) {
      case 'aws':
        return createAWSNitroProvider({ region: this.config.awsRegion })
      case 'gcp': {
        const gcpProject = this.config.gcpProject
        if (!gcpProject) {
          throw new Error('GCP provider requires gcpProject in config')
        }
        return createGCPConfidentialProvider({
          project: gcpProject,
          zone: this.config.gcpZone,
        })
      }
      case 'phala':
        return new PhalaProviderAdapter(this.config)
      default:
        return createMockProvider()
    }
  }

  private keccakHash(data: Uint8Array): Uint8Array {
    const hash = keccak256(data)
    return Buffer.from(hash.slice(2), 'hex')
  }
}

class PhalaProviderAdapter implements ITEEProvider {
  readonly provider: TEEProvider = 'phala'
  readonly capabilities: TEECapability[] = ['attestation', 'key_gen']
  private client: PhalaClient
  private config: TEEProviderConfig

  constructor(config: TEEProviderConfig) {
    this.config = config
    this.client = createPhalaClient({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
    })
  }

  async initialize(): Promise<void> {
    await this.client.initialize()
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.config.endpoint ?? getPhalaEndpoint())
  }

  async requestAttestation(
    request: AttestationRequest,
  ): Promise<AttestationResponse> {
    const operatorAddress = this.config.operatorAddress
    if (!operatorAddress)
      throw new Error('Phala TEE requires operatorAddress in config')

    const response = await this.client.requestAttestation({
      data: request.data,
      operatorAddress,
      nonce: request.nonce,
    })

    return {
      quote: response.quote,
      measurement: response.mrEnclave,
      reportData: response.reportData,
      signature: response.signature,
      timestamp: response.timestamp,
      enclaveId: response.enclaveId,
      provider: 'phala',
    }
  }

  async verifyAttestation(
    attestation: AttestationResponse,
  ): Promise<AttestationVerification> {
    const result = await this.client.verifyAttestation({
      quote: attestation.quote,
      mrEnclave: attestation.measurement,
      reportData: attestation.reportData,
      signature: attestation.signature,
      timestamp: attestation.timestamp,
      enclaveId: attestation.enclaveId,
    })

    return {
      valid: result.valid,
      provider: 'phala',
      measurement: attestation.measurement,
      timestamp: attestation.timestamp,
      errors: result.errors,
    }
  }

  toTEEAttestation(attestation: AttestationResponse): TEEAttestation {
    if (!attestation.publicKey) {
      throw new Error('Attestation missing public key')
    }
    return {
      measurement: toHash32(
        Buffer.from(attestation.measurement.slice(2), 'hex'),
      ),
      quote: attestation.quote,
      publicKey: attestation.publicKey,
      timestamp: BigInt(attestation.timestamp),
    }
  }

  async getStatus(): Promise<{
    available: boolean
    enclaveId?: string
    capabilities: TEECapability[]
    lastAttestationTime?: number
  }> {
    return {
      available: await this.isAvailable(),
      capabilities: this.capabilities,
    }
  }
}

let globalManager: TEEManager | null = null

export function getTEEManager(config?: Partial<TEEProviderConfig>): TEEManager {
  if (!globalManager) globalManager = new TEEManager(config)
  return globalManager
}

export function createTEEManager(
  config?: Partial<TEEProviderConfig>,
): TEEManager {
  return new TEEManager(config)
}

export function resetTEEManager(): void {
  globalManager = null
}
