/**
 * Open Intents Framework Integration for Cross-Chain Identity
 *
 * Enables OAuth3 identities to operate across multiple EVM chains
 * using the Open Intents Framework (OIF) for intent-based execution.
 */

import { getExternalRpc, getRpcUrl } from '@jejunetwork/config'
import {
  type Address,
  encodeAbiParameters,
  type Hex,
  keccak256,
  parseAbiParameters,
  toBytes,
  toHex,
} from 'viem'
import { ChainId, type IntentSolution, type OAuth3Session } from '../types.js'

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

/** Get supported chains configuration - uses config package for RPC URLs */
function getSupportedChains(): SupportedChain[] {
  return [
    {
      chainId: ChainId.JEJU_LOCALNET,
      name: 'Jeju Network',
      rpcUrl: getRpcUrl(),
      identityRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      accountFactoryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      intentRouterAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      entryPointAddress:
        '0x0000000000000000000000000000000000005FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address,
    },
    {
      chainId: ChainId.BASE,
      name: 'Base',
      rpcUrl: getExternalRpc('base'),
      identityRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      accountFactoryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      intentRouterAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      entryPointAddress:
        '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address,
    },
    {
      chainId: ChainId.ETHEREUM,
      name: 'Ethereum',
      rpcUrl: getExternalRpc('ethereum'),
      identityRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      accountFactoryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      intentRouterAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      entryPointAddress:
        '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address,
    },
    {
      chainId: ChainId.ARBITRUM,
      name: 'Arbitrum One',
      rpcUrl: getExternalRpc('arbitrum'),
      identityRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      accountFactoryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      intentRouterAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      entryPointAddress:
        '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address,
    },
    {
      chainId: ChainId.OPTIMISM,
      name: 'Optimism',
      rpcUrl: getExternalRpc('optimism'),
      identityRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      accountFactoryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      intentRouterAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      entryPointAddress:
        '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address,
    },
    {
      chainId: ChainId.POLYGON,
      name: 'Polygon',
      rpcUrl: getExternalRpc('polygon'),
      identityRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      accountFactoryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      intentRouterAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      entryPointAddress:
        '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address,
    },
  ]
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
    const intentString = JSON.stringify(intent, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    const intentId = keccak256(toBytes(intentString))

    return {
      intentId,
      status: 'pending',
    }
  }

  async getIntentStatus(_intentId: Hex): Promise<{
    status: 'pending' | 'solving' | 'executed' | 'failed'
    solution?: IntentSolution
    executionTx?: Hex
  }> {
    return {
      status: 'pending',
    }
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
