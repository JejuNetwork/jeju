/** ERC-8004 Agent Identity & Reputation */

import { isProductionEnv } from '@jejunetwork/config'
import {
  identityRegistryAbi,
  reputationRegistryAbi,
  validationRegistryAbi,
} from '@jejunetwork/contracts'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  type PublicClient,
  stringToHex,
  type Transport,
  type WalletClient,
  zeroAddress,
  zeroHash,
} from 'viem'
import { type LocalAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import { z } from 'zod'
import { toAddress, toHex } from '../lib'
import { createKMSWalletClient } from './kms-signer'

// Schema for tokenURI JSON
const TokenURIDataSchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
})

function inferChainFromRpcUrl(rpcUrl: string) {
  if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
    return baseSepolia
  }
  if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) {
    return base
  }
  return localhost
}

const ZERO = zeroAddress
const ZERO32 = zeroHash

export interface AgentIdentity {
  agentId: bigint
  name: string
  role: string
  tokenURI: string
  a2aEndpoint: string
  mcpEndpoint: string
  owner: string
}
export interface AgentReputation {
  agentId: bigint
  feedbackCount: number
  averageScore: number
  recentFeedback: Array<{ client: string; score: number; tag: string }>
}
export interface ERC8004Config {
  rpcUrl: string
  identityRegistry: string
  reputationRegistry: string
  validationRegistry: string
  operatorKey?: string
}

export class ERC8004Client {
  private readonly client: PublicClient<Transport, Chain>
  private walletClient: WalletClient
  private account: LocalAccount | null
  private readonly chain: ReturnType<typeof inferChainFromRpcUrl>
  private readonly rpcUrl: string
  private readonly identityAddress: Address
  private readonly reputationAddress: Address
  private readonly validationAddress: Address

  readonly identityDeployed: boolean
  readonly reputationDeployed: boolean
  readonly validationDeployed: boolean

  /**
   * Create an ERC8004Client instance.
   *
   * SECURITY: In production (mainnet/testnet), raw private keys are blocked.
   * Use ERC8004Client.create() which initializes KMS automatically.
   */
  constructor(config: ERC8004Config) {
    const chain = inferChainFromRpcUrl(config.rpcUrl)
    this.chain = chain
    this.rpcUrl = config.rpcUrl
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient<Transport, Chain>

    this.identityAddress = toAddress(config.identityRegistry)
    this.reputationAddress = toAddress(config.reputationRegistry)
    this.validationAddress = toAddress(config.validationRegistry)

    this.identityDeployed = config.identityRegistry !== ZERO
    this.reputationDeployed = config.reputationRegistry !== ZERO
    this.validationDeployed = config.validationRegistry !== ZERO

    if (config.operatorKey) {
      const keyHex = toHex(config.operatorKey)

      // SECURITY: Block raw private keys in production
      if (keyHex.length === 66 && isProductionEnv()) {
        throw new Error(
          'SECURITY: Raw private keys are not allowed in production. ' +
            'Use ERC8004Client.create() with KMS or provide an address for KMS lookup.',
        )
      }

      if (keyHex.length === 66) {
        // Development only: Allow local signing with warning
        console.warn(
          '[ERC8004Client] ⚠️  Using local private key. NOT secure for production.',
        )
        this.account = privateKeyToAccount(keyHex)
        this.walletClient = createWalletClient({
          account: this.account,
          chain,
          transport: http(config.rpcUrl),
        }) as WalletClient<Transport, Chain>
      } else {
        // Address only - no local signing, must use KMS
        this.account = null
        this.walletClient = createWalletClient({
          chain,
          transport: http(config.rpcUrl),
        }) as WalletClient<Transport, Chain>
      }
    } else {
      this.account = null
      this.walletClient = createWalletClient({
        chain,
        transport: http(config.rpcUrl),
      }) as WalletClient<Transport, Chain>
    }
  }

  /**
   * Create an ERC8004Client with KMS initialized.
   * This is the recommended way to create an ERC8004Client in production.
   */
  static async create(
    config: ERC8004Config,
    operatorAddress: Address,
  ): Promise<ERC8004Client> {
    const client = new ERC8004Client({
      ...config,
      operatorKey: undefined, // Don't use private key path
    })
    await client.initializeKMS(operatorAddress)
    return client
  }

  /**
   * Initialize KMS for secure threshold signing
   * Call this in production before any write operations
   */
  async initializeKMS(operatorAddress: Address): Promise<void> {
    const result = await createKMSWalletClient(
      { address: operatorAddress },
      this.chain,
      this.rpcUrl,
    )
    this.walletClient = result.client
    console.log(
      `[ERC8004Client] KMS initialized for ${operatorAddress} (${result.account.type})`,
    )
  }

  async registerAgent(
    name: string,
    role: string,
    a2aEndpoint: string,
    mcpEndpoint: string,
  ): Promise<bigint> {
    if (!this.identityDeployed)
      throw new Error('Identity registry not deployed')
    if (!this.account) throw new Error('Wallet required for registration')
    if (!name || name.trim().length === 0)
      throw new Error('Agent name is required')
    if (!role || role.trim().length === 0)
      throw new Error('Agent role is required')
    if (!a2aEndpoint || !a2aEndpoint.trim())
      throw new Error('A2A endpoint is required')
    if (!mcpEndpoint || !mcpEndpoint.trim())
      throw new Error('MCP endpoint is required')

    const tokenURI = `data:application/json,${encodeURIComponent(JSON.stringify({ name, role, description: `${role} agent` }))}`
    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.identityAddress,
      abi: identityRegistryAbi,
      functionName: 'register',
      args: [tokenURI],
      account: this.account,
    })
    const receipt = await this.client.waitForTransactionReceipt({ hash })

    const transferEventSig = keccak256(
      stringToHex('Transfer(address,address,uint256)'),
    )
    const transferEvent = receipt.logs.find(
      (log) => log.topics[0] === transferEventSig,
    )

    if (!transferEvent || !transferEvent.topics[3]) {
      throw new Error(
        `Agent registration failed: Transfer event not found in tx ${hash}`,
      )
    }

    const agentId = BigInt(transferEvent.topics[3])

    if (agentId === 0n) {
      throw new Error(
        `Agent registration failed: Invalid agent ID 0 in tx ${hash}`,
      )
    }

    const [hash1, hash2, hash3, hash4] = await Promise.all([
      this.walletClient.writeContract({
        chain: this.chain,
        address: this.identityAddress,
        abi: identityRegistryAbi,
        functionName: 'setA2AEndpoint',
        args: [agentId, a2aEndpoint],
        account: this.account,
      }) as Promise<`0x${string}`>,
      this.walletClient.writeContract({
        chain: this.chain,
        address: this.identityAddress,
        abi: identityRegistryAbi,
        functionName: 'setMCPEndpoint',
        args: [agentId, mcpEndpoint],
        account: this.account,
      }) as Promise<`0x${string}`>,
      this.walletClient.writeContract({
        chain: this.chain,
        address: this.identityAddress,
        abi: identityRegistryAbi,
        functionName: 'setServiceType',
        args: [agentId, 'agent'],
        account: this.account,
      }) as Promise<`0x${string}`>,
      this.walletClient.writeContract({
        chain: this.chain,
        address: this.identityAddress,
        abi: identityRegistryAbi,
        functionName: 'updateTags',
        args: [agentId, ['council', role.toLowerCase(), 'governance']],
        account: this.account,
      }) as Promise<`0x${string}`>,
    ])

    await Promise.all([
      this.client.waitForTransactionReceipt({ hash: hash1 }),
      this.client.waitForTransactionReceipt({ hash: hash2 }),
      this.client.waitForTransactionReceipt({ hash: hash3 }),
      this.client.waitForTransactionReceipt({ hash: hash4 }),
    ])

    return agentId
  }

  async getAgentIdentity(agentId: bigint): Promise<AgentIdentity | null> {
    if (!this.identityDeployed) return null
    const exists = await this.client.readContract({
      address: this.identityAddress,
      abi: identityRegistryAbi,
      functionName: 'agentExists',
      args: [agentId],
    })
    if (!exists) return null

    const [tokenURI, a2aEndpoint, mcpEndpoint, owner] = await Promise.all([
      this.client.readContract({
        address: this.identityAddress,
        abi: identityRegistryAbi,
        functionName: 'tokenURI',
        args: [agentId],
      }),
      this.client.readContract({
        address: this.identityAddress,
        abi: identityRegistryAbi,
        functionName: 'getA2AEndpoint',
        args: [agentId],
      }),
      this.client.readContract({
        address: this.identityAddress,
        abi: identityRegistryAbi,
        functionName: 'getMCPEndpoint',
        args: [agentId],
      }),
      this.client.readContract({
        address: this.identityAddress,
        abi: identityRegistryAbi,
        functionName: 'ownerOf',
        args: [agentId],
      }),
    ])

    let name = `Agent ${agentId}`,
      role = 'unknown'
    if (tokenURI.startsWith('data:application/json,')) {
      const rawParsed = JSON.parse(decodeURIComponent(tokenURI.slice(22)))
      const j = TokenURIDataSchema.parse(rawParsed)
      name = j.name ?? name
      role = j.role ?? role
    }
    return { agentId, name, role, tokenURI, a2aEndpoint, mcpEndpoint, owner }
  }

  async getAgentReputation(agentId: bigint): Promise<AgentReputation> {
    if (!this.reputationDeployed)
      return { agentId, feedbackCount: 0, averageScore: 0, recentFeedback: [] }

    const summary = await this.client.readContract({
      address: this.reputationAddress,
      abi: reputationRegistryAbi,
      functionName: 'getSummary',
      args: [agentId, [], ZERO32, ZERO32],
    })
    const count = summary[0]
    const averageScore = summary[1]
    const recentFeedback: AgentReputation['recentFeedback'] = []

    if (count > 0n) {
      const result = await this.client.readContract({
        address: this.reputationAddress,
        abi: reputationRegistryAbi,
        functionName: 'readAllFeedback',
        args: [agentId, [], ZERO32, ZERO32, false],
      })
      const [clients, scores, tag1s] = [result[0], result[1], result[2]]
      for (let i = 0; i < Math.min(clients.length, 10); i++) {
        recentFeedback.push({
          client: clients[i],
          score: scores[i],
          tag: tag1s[i],
        })
      }
    }
    return {
      agentId,
      feedbackCount: Number(count),
      averageScore,
      recentFeedback,
    }
  }

  async submitFeedback(
    agentId: bigint,
    score: number,
    tag: string,
    details?: string,
  ): Promise<`0x${string}`> {
    if (!this.reputationDeployed)
      throw new Error('Reputation registry not deployed')
    if (!this.account) throw new Error('Wallet required for feedback')
    if (agentId === 0n) throw new Error('Invalid agent ID')
    if (score < 0 || score > 100)
      throw new Error('Score must be between 0 and 100')
    if (!tag || tag.trim().length === 0) throw new Error('Tag is required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.reputationAddress,
      abi: reputationRegistryAbi,
      functionName: 'giveFeedback',
      args: [
        agentId,
        score,
        keccak256(stringToHex(tag)),
        ZERO32,
        details ?? '',
        details ? keccak256(stringToHex(details)) : ZERO32,
        ZERO_ADDRESS,
      ],
      account: this.account,
    })
    await this.client.waitForTransactionReceipt({ hash })
    return hash
  }

  async requestValidation(
    agentId: bigint,
    validator: Address,
    requestUri: string,
  ): Promise<`0x${string}`> {
    if (!this.validationDeployed)
      throw new Error('Validation registry not deployed')
    if (!this.account) throw new Error('Wallet required')
    if (agentId === 0n) throw new Error('Invalid agent ID')
    if (validator === zeroAddress) throw new Error('Invalid validator address')
    if (!requestUri || requestUri.trim().length === 0)
      throw new Error('Request URI is required')

    const requestHash = keccak256(
      stringToHex(`${agentId}-${validator}-${requestUri}-${Date.now()}`),
    )
    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.validationAddress,
      abi: validationRegistryAbi,
      functionName: 'validationRequest',
      args: [validator, agentId, requestUri, requestHash],
      account: this.account,
    })
    await this.client.waitForTransactionReceipt({ hash })
    return requestHash
  }

  async getValidationSummary(
    agentId: bigint,
  ): Promise<{ count: number; avgScore: number }> {
    if (!this.validationDeployed) return { count: 0, avgScore: 0 }
    const validationSummary = await this.client.readContract({
      address: this.validationAddress,
      abi: validationRegistryAbi,
      functionName: 'getSummary',
      args: [agentId, [], ZERO32],
    })
    return {
      count: Number(validationSummary[0]),
      avgScore: validationSummary[1],
    }
  }

  async getTotalAgents(): Promise<number> {
    if (!this.identityDeployed) return 0
    const total = await this.client.readContract({
      address: this.identityAddress,
      abi: identityRegistryAbi,
      functionName: 'totalAgents',
    })
    return Number(total)
  }
}

// Factory function for easier instantiation
export function getERC8004Client(config: ERC8004Config): ERC8004Client {
  return new ERC8004Client(config)
}
