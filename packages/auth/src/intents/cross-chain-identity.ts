/**
 * Open Intents Framework Integration for Cross-Chain Identity
 *
 * Enables OAuth3 identities to operate across multiple EVM chains
 * using the Open Intents Framework (OIF) for intent-based execution.
 */

import { getExternalRpc, getRpcUrl } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  type Hex,
  http,
  keccak256,
  parseAbiParameters,
  toBytes,
  toHex,
} from 'viem'
import { ChainId, type IntentSolution, type OAuth3Session } from '../types.js'

/**
 * Get address from environment, validating format
 */
function getEnvAddress(key: string): Address {
  const value = process.env[key]
  if (!value || value === '') return ZERO_ADDRESS
  // Validate address format
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return ZERO_ADDRESS
  return value as Address
}

// Environment-based contract addresses (deployed per chain)
const getChainContracts = (
  chainId: ChainId,
): {
  identityRegistry: Address
  accountFactory: Address
  intentRouter: Address
} => {
  const prefix = `CHAIN_${chainId}_`
  return {
    identityRegistry: getEnvAddress(`${prefix}IDENTITY_REGISTRY`),
    accountFactory: getEnvAddress(`${prefix}ACCOUNT_FACTORY`),
    intentRouter: getEnvAddress(`${prefix}INTENT_ROUTER`),
  }
}

// Intent Router ABI for submitting and checking intents
const INTENT_ROUTER_ABI = [
  {
    type: 'function',
    name: 'submitIntent',
    inputs: [
      { name: 'identityId', type: 'bytes32' },
      { name: 'sourceChain', type: 'uint256' },
      { name: 'targetChain', type: 'uint256' },
      { name: 'targetContract', type: 'address' },
      { name: 'callData', type: 'bytes' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'intentId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getIntentStatus',
    inputs: [{ name: 'intentId', type: 'bytes32' }],
    outputs: [
      { name: 'status', type: 'uint8' },
      { name: 'executionTx', type: 'bytes32' },
      { name: 'solver', type: 'address' },
      { name: 'executedAt', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

const INTENT_STATUS = {
  0: 'pending',
  1: 'solving',
  2: 'executed',
  3: 'failed',
  4: 'expired',
} as const

interface CrossChainIdentityInput {
  identityId?: Hex
  id?: Hex
  owner: Address
  smartAccount: Address
}

export interface SupportedChain {
  chainId: ChainId
  name: string
  rpcUrl: string
  identityRegistryAddress: Address
  accountFactoryAddress: Address
  intentRouterAddress: Address
  entryPointAddress: Address
}

export interface CrossChainIdentityState {
  identityId: Hex
  owner: Address
  chainStates: Map<ChainId, ChainIdentityState>
}

export interface ChainIdentityState {
  chainId: ChainId
  smartAccount: Address
  nonce: bigint
  deployed: boolean
  lastSync: number
}

export interface IdentitySyncIntent {
  sourceChain: ChainId
  targetChain: ChainId
  identityId: Hex
  newState: {
    linkedProviders?: Hex[]
    metadata?: Hex
    credentials?: Hex[]
  }
  proof: Hex
  deadline: number
}

export interface CrossChainAuthIntent {
  identityId: Hex
  sourceChain: ChainId
  targetChain: ChainId
  targetContract: Address
  targetFunction: Hex
  callData: Hex
  value: bigint
  deadline: number
  signature: Hex
}

// ERC-4337 EntryPoint v0.6.0 (deployed on most chains)
const ENTRYPOINT_V6 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address

/** Get supported chains configuration - uses config package for RPC URLs and env for addresses */
function getSupportedChains(): SupportedChain[] {
  const chains: Array<{
    chainId: ChainId
    name: string
    rpcUrl: string
    rpcName?: 'base' | 'ethereum' | 'arbitrum' | 'optimism' | 'polygon'
  }> = [
    {
      chainId: ChainId.JEJU_LOCALNET,
      name: 'Jeju Network',
      rpcUrl: getRpcUrl(),
    },
    { chainId: ChainId.BASE, name: 'Base', rpcUrl: '', rpcName: 'base' },
    {
      chainId: ChainId.ETHEREUM,
      name: 'Ethereum',
      rpcUrl: '',
      rpcName: 'ethereum',
    },
    {
      chainId: ChainId.ARBITRUM,
      name: 'Arbitrum One',
      rpcUrl: '',
      rpcName: 'arbitrum',
    },
    {
      chainId: ChainId.OPTIMISM,
      name: 'Optimism',
      rpcUrl: '',
      rpcName: 'optimism',
    },
    {
      chainId: ChainId.POLYGON,
      name: 'Polygon',
      rpcUrl: '',
      rpcName: 'polygon',
    },
  ]

  return chains.map((chain) => {
    const contracts = getChainContracts(chain.chainId)
    const rpcUrl = chain.rpcName ? getExternalRpc(chain.rpcName) : chain.rpcUrl

    return {
      chainId: chain.chainId,
      name: chain.name,
      rpcUrl,
      identityRegistryAddress: contracts.identityRegistry,
      accountFactoryAddress: contracts.accountFactory,
      intentRouterAddress: contracts.intentRouter,
      entryPointAddress: ENTRYPOINT_V6,
    }
  })
}

/**
 * Check if chain contracts are configured
 */
function isChainConfigured(chain: SupportedChain): boolean {
  return (
    chain.identityRegistryAddress !== ZERO_ADDRESS &&
    chain.accountFactoryAddress !== ZERO_ADDRESS &&
    chain.intentRouterAddress !== ZERO_ADDRESS
  )
}

export class CrossChainIdentityManager {
  private chainConfigs: Map<ChainId, SupportedChain>
  private identityStates: Map<Hex, CrossChainIdentityState>
  private homeChain: ChainId

  constructor(homeChain: ChainId = ChainId.JEJU_LOCALNET) {
    this.homeChain = homeChain
    this.chainConfigs = new Map()
    this.identityStates = new Map()

    for (const chain of getSupportedChains()) {
      this.chainConfigs.set(chain.chainId, chain)
    }
  }

  addChain(chain: SupportedChain): void {
    this.chainConfigs.set(chain.chainId, chain)
  }

  getChain(chainId: ChainId): SupportedChain {
    const chain = this.chainConfigs.get(chainId)
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`)
    }
    return chain
  }

  getSupportedChains(): SupportedChain[] {
    return Array.from(this.chainConfigs.values())
  }

  async createCrossChainIdentity(
    identity: CrossChainIdentityInput,
    targetChains: ChainId[],
  ): Promise<CrossChainIdentityState> {
    const identityId = identity.identityId ?? identity.id
    if (!identityId) {
      throw new Error('Identity must have identityId or id')
    }

    const state: CrossChainIdentityState = {
      identityId,
      owner: identity.owner,
      chainStates: new Map(),
    }

    state.chainStates.set(this.homeChain, {
      chainId: this.homeChain,
      smartAccount: identity.smartAccount,
      nonce: 0n,
      deployed: true,
      lastSync: Date.now(),
    })

    for (const chainId of targetChains) {
      if (chainId === this.homeChain) continue

      const predictedAddress = this.computeSmartAccountAddress(
        identityId,
        identity.owner,
        chainId,
      )

      state.chainStates.set(chainId, {
        chainId,
        smartAccount: predictedAddress,
        nonce: 0n,
        deployed: false,
        lastSync: 0,
      })
    }

    this.identityStates.set(identityId, state)
    return state
  }

  computeSmartAccountAddress(
    identityId: Hex,
    owner: Address,
    chainId: ChainId,
  ): Address {
    const chain = this.getChain(chainId)

    const salt = keccak256(
      encodeAbiParameters(parseAbiParameters('bytes32, address, uint256'), [
        identityId,
        owner,
        BigInt(chainId),
      ]),
    )

    const initCodeHash = keccak256(
      toBytes(`account_bytecode:${identityId}:${owner}:${chainId}`),
    )

    const create2Hash = keccak256(
      encodeAbiParameters(
        parseAbiParameters('bytes1, address, bytes32, bytes32'),
        ['0xff' as Hex, chain.accountFactoryAddress, salt, initCodeHash],
      ),
    )

    return `0x${create2Hash.slice(-40)}` as Address
  }

  async createIdentitySyncIntent(
    identityId: Hex,
    sourceChain: ChainId,
    targetChain: ChainId,
    _session: OAuth3Session,
  ): Promise<IdentitySyncIntent> {
    const state = this.identityStates.get(identityId)
    if (!state) {
      throw new Error('Identity not found')
    }

    const sourceState = state.chainStates.get(sourceChain)
    if (!sourceState) {
      throw new Error('Identity not deployed on source chain')
    }

    const proofData = encodeAbiParameters(
      parseAbiParameters('bytes32, uint256, address, uint256'),
      [identityId, BigInt(sourceChain), state.owner, sourceState.nonce],
    )

    const proof = keccak256(proofData)

    return {
      sourceChain,
      targetChain,
      identityId,
      newState: {
        metadata: toHex(toBytes(`sync:${Date.now()}`)),
      },
      proof,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    }
  }

  async createCrossChainAuthIntent(
    session: OAuth3Session,
    targetChain: ChainId,
    targetContract: Address,
    functionSelector: Hex,
    callData: Hex,
    value: bigint = 0n,
  ): Promise<CrossChainAuthIntent> {
    const deadline = Math.floor(Date.now() / 1000) + 3600

    const signature = '0x' as Hex

    return {
      identityId: session.identityId,
      sourceChain: this.homeChain,
      targetChain,
      targetContract,
      targetFunction: functionSelector,
      callData,
      value,
      deadline,
      signature,
    }
  }

  async submitIntent(
    intent: CrossChainAuthIntent | IdentitySyncIntent,
  ): Promise<{
    intentId: Hex
    status: 'pending' | 'submitted' | 'executed'
  }> {
    // Determine target chain from intent
    const targetChain =
      'targetChain' in intent ? intent.targetChain : this.homeChain
    const chain = this.getChain(targetChain)

    if (!isChainConfigured(chain)) {
      throw new Error(
        `Chain ${targetChain} (${chain.name}) contracts not configured. ` +
          `Set CHAIN_${targetChain}_INTENT_ROUTER environment variable.`,
      )
    }

    // Compute intent hash for tracking
    if ('targetContract' in intent) {
      const intentId = computeIntentHash(intent)

      // If we have a signature, submit on-chain
      if (intent.signature && intent.signature !== '0x') {
        const client = createPublicClient({
          transport: http(chain.rpcUrl),
        })

        // Simulate the intent submission to check validity
        await client.simulateContract({
          address: chain.intentRouterAddress,
          abi: INTENT_ROUTER_ABI,
          functionName: 'submitIntent',
          args: [
            intent.identityId,
            BigInt(intent.sourceChain),
            BigInt(intent.targetChain),
            intent.targetContract,
            intent.callData,
            intent.value,
            BigInt(intent.deadline),
            intent.signature,
          ],
        })

        return { intentId, status: 'submitted' }
      }

      // No signature - return pending for signing
      return { intentId, status: 'pending' }
    }

    // Identity sync intent
    const intentString = JSON.stringify(intent, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    const intentId = keccak256(toBytes(intentString))

    return { intentId, status: 'pending' }
  }

  async getIntentStatus(intentId: Hex): Promise<{
    status: 'pending' | 'solving' | 'executed' | 'failed'
    solution?: IntentSolution
    executionTx?: Hex
  }> {
    // Check status on home chain's intent router
    const chain = this.getChain(this.homeChain)

    if (!isChainConfigured(chain)) {
      return { status: 'pending' }
    }

    const client = createPublicClient({
      transport: http(chain.rpcUrl),
    })

    const [statusCode, executionTx, solver, executedAt] =
      await client.readContract({
        address: chain.intentRouterAddress,
        abi: INTENT_ROUTER_ABI,
        functionName: 'getIntentStatus',
        args: [intentId],
      })

    const status =
      INTENT_STATUS[statusCode as keyof typeof INTENT_STATUS] ?? 'pending'

    if (status === 'executed' && executedAt > 0n) {
      return {
        status: 'executed',
        executionTx: executionTx as Hex,
        solution: {
          solverId: solver as Address,
          intentId,
          executionData: executionTx as Hex,
          gasUsed: 0n,
          timestamp: Number(executedAt),
        },
      }
    }

    // Map the raw status to our expected union type
    const finalStatus = status === 'expired' ? 'failed' : status

    return { status: finalStatus }
  }

  getIdentityState(identityId: Hex): CrossChainIdentityState | undefined {
    return this.identityStates.get(identityId)
  }

  async syncIdentityState(
    identityId: Hex,
    chainId: ChainId,
  ): Promise<ChainIdentityState> {
    const state = this.identityStates.get(identityId)
    if (!state) {
      throw new Error('Identity not found')
    }

    const chainState = state.chainStates.get(chainId)
    if (!chainState) {
      throw new Error('Chain not registered for this identity')
    }

    chainState.lastSync = Date.now()

    return chainState
  }
}

export function encodeTransferIntent(
  from: Address,
  to: Address,
  amount: bigint,
  tokenAddress: Address,
  sourceChain: ChainId,
  targetChain: ChainId,
): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address, address, uint256, address, uint256, uint256'),
    [from, to, amount, tokenAddress, BigInt(sourceChain), BigInt(targetChain)],
  )
}

export function encodeContractCallIntent(
  caller: Address,
  target: Address,
  value: bigint,
  data: Hex,
  targetChain: ChainId,
): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address, address, uint256, bytes, uint256'),
    [caller, target, value, data, BigInt(targetChain)],
  )
}

export function computeIntentHash(intent: CrossChainAuthIntent): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        'bytes32, uint256, uint256, address, bytes4, bytes, uint256, uint256',
      ),
      [
        intent.identityId,
        BigInt(intent.sourceChain),
        BigInt(intent.targetChain),
        intent.targetContract,
        intent.targetFunction,
        intent.callData,
        intent.value,
        BigInt(intent.deadline),
      ],
    ),
  )
}

export const crossChainIdentityManager = new CrossChainIdentityManager()
