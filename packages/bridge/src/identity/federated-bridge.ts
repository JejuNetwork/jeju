/**
 * Federated Identity Bridge
 * Links ERC-8004 identities between EVM chains and Solana 8004-solana
 *
 * Architecture:
 * - EVM: IdentityRegistry + FederatedIdentity contracts
 * - Solana: agent-registry-8004 program
 * - Bridge: This service + relayer for attestations
 */

import { Connection, PublicKey } from '@solana/web3.js'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodePacked,
  type Hex,
  http,
  keccak256,
  parseAbi,
  toBytes,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { mainnet, sepolia } from 'viem/chains'

const FEDERATED_IDENTITY_ABI = parseAbi([
  'function federateLocalAgent(uint256 localAgentId, bytes calldata ownershipProof) external',
  'function registerRemoteAgent(uint256 originChainId, uint256 originAgentId, address originOwner, bytes32 originRegistryHash, bytes calldata oracleAttestation) external',
  'function attestCrossNetwork(bytes32 federatedId, uint256 targetChainId, bytes calldata proof) external',
  'function computeFederatedId(uint256 chainId, uint256 agentId) external pure returns (bytes32)',
  'function getFederatedAgent(bytes32 federatedId) external view returns (uint256, uint256, address, bytes32, uint256, bool, uint256)',
  'function verifyIdentity(uint256 originChainId, uint256 originAgentId) external view returns (bool, bytes32, uint256)',
  'event AgentFederated(bytes32 indexed federatedId, uint256 indexed originChainId, uint256 originAgentId, address indexed originOwner)',
  'event CrossNetworkAttested(bytes32 indexed federatedId, uint256 indexed targetChainId, address attester)',
])

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function getAgentId(address agentAddress) external view returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function getAgent(uint256 agentId) external view returns (uint256, address, uint8, address, uint256, uint256, uint256, bool, bool)',
])

const SOLANA_CHAIN_ID = 101n // Mainnet
const SOLANA_DEVNET_CHAIN_ID = 102n
const AGENT_REGISTRY_PROGRAM_ID = new PublicKey(
  'HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp',
)

export interface FederatedIdentityConfig {
  evmRpcUrl: string
  evmChainId: number
  federatedIdentityAddress: Address
  identityRegistryAddress: Address
  solanaRpcUrl: string
  privateKey?: Hex
  solanaKeypair?: Uint8Array
}

export interface SolanaAgent {
  agentId: bigint
  owner: string
  asset: string
  agentUri: string
  createdAt: number
}

export interface FederatedAgent {
  originChainId: bigint
  originAgentId: bigint
  originOwner: string
  originRegistryHash: Hex
  federatedAt: bigint
  isActive: boolean
  reputationScore: bigint
}

export interface CrossChainIdentityLink {
  federatedId: Hex
  evmAgentId: bigint | null
  evmChainId: number | null
  evmOwner: Address | null
  solanaAgentId: bigint | null
  solanaOwner: string | null
  reputation: number
  attestedChains: number[]
}

export class FederatedIdentityBridge {
  private config: FederatedIdentityConfig
  private evmPublicClient: ReturnType<typeof createPublicClient>
  private evmWalletClient: ReturnType<typeof createWalletClient> | null = null
  private evmAccount: PrivateKeyAccount | null = null
  private solanaConnection: Connection

  constructor(config: FederatedIdentityConfig) {
    this.config = config

    const chain = config.evmChainId === 1 ? mainnet : sepolia
    this.evmPublicClient = createPublicClient({
      chain,
      transport: http(config.evmRpcUrl),
    })

    if (config.privateKey) {
      this.evmAccount = privateKeyToAccount(config.privateKey)
      this.evmWalletClient = createWalletClient({
        account: this.evmAccount,
        chain,
        transport: http(config.evmRpcUrl),
      })
    }

    this.solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed')
  }

  /**
   * Get EVM agent by address
   */
  async getEvmAgent(
    agentAddress: Address,
  ): Promise<{ agentId: bigint; owner: Address } | null> {
    const agentId = await this.evmPublicClient.readContract({
      address: this.config.identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentId',
      args: [agentAddress],
    })

    if (!agentId || agentId === 0n) return null

    const owner = await this.evmPublicClient.readContract({
      address: this.config.identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'ownerOf',
      args: [agentId],
    })

    return { agentId: agentId as bigint, owner: owner as Address }
  }

  /**
   * Get Solana agent by ID
   */
  async getSolanaAgent(agentId: bigint): Promise<SolanaAgent | null> {
    const idBuffer = Buffer.alloc(8)
    idBuffer.writeBigUInt64LE(agentId)

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), idBuffer],
      AGENT_REGISTRY_PROGRAM_ID,
    )

    const accountInfo = await this.solanaConnection.getAccountInfo(agentPda)
    if (!accountInfo) return null

    const data = accountInfo.data

    // SECURITY: Validate minimum data length before parsing
    const MIN_ACCOUNT_SIZE = 8 + 8 + 32 + 32 + 4 // discriminator + agentId + owner + asset + uriLen
    if (data.length < MIN_ACCOUNT_SIZE) {
      throw new Error(
        `Invalid agent account data: expected at least ${MIN_ACCOUNT_SIZE} bytes, got ${data.length}`,
      )
    }

    let offset = 8 // Skip discriminator

    const agentIdRead = data.readBigUInt64LE(offset)
    offset += 8

    // SECURITY: Bounds check before reading pubkey
    if (offset + 32 > data.length) {
      throw new Error('Invalid account data: truncated owner field')
    }
    const owner = new PublicKey(data.slice(offset, offset + 32)).toBase58()
    offset += 32

    // SECURITY: Bounds check before reading asset
    if (offset + 32 > data.length) {
      throw new Error('Invalid account data: truncated asset field')
    }
    const asset = new PublicKey(data.slice(offset, offset + 32)).toBase58()
    offset += 32

    // SECURITY: Bounds check before reading URI length
    if (offset + 4 > data.length) {
      throw new Error('Invalid account data: truncated URI length')
    }
    const uriLen = data.readUInt32LE(offset)
    offset += 4

    // SECURITY: Validate URI length is reasonable (max 2KB)
    const MAX_URI_LEN = 2048
    if (uriLen > MAX_URI_LEN || offset + uriLen > data.length) {
      throw new Error(
        `Invalid URI length: ${uriLen} (max ${MAX_URI_LEN}, remaining ${data.length - offset})`,
      )
    }
    const agentUri = data.slice(offset, offset + uriLen).toString('utf8')
    offset += uriLen

    // Skip nft_name with bounds checking
    if (offset + 4 > data.length) {
      throw new Error('Invalid account data: truncated name length')
    }
    const nameLen = data.readUInt32LE(offset)
    offset += 4
    if (nameLen > 256 || offset + nameLen > data.length) {
      throw new Error(`Invalid name length: ${nameLen}`)
    }
    offset += nameLen

    // Skip nft_symbol with bounds checking
    if (offset + 4 > data.length) {
      throw new Error('Invalid account data: truncated symbol length')
    }
    const symbolLen = data.readUInt32LE(offset)
    offset += 4
    if (symbolLen > 32 || offset + symbolLen > data.length) {
      throw new Error(`Invalid symbol length: ${symbolLen}`)
    }
    offset += symbolLen

    // SECURITY: Bounds check before reading createdAt
    if (offset + 8 > data.length) {
      throw new Error('Invalid account data: truncated createdAt')
    }
    const createdAt = Number(data.readBigInt64LE(offset))

    return {
      agentId: agentIdRead,
      owner,
      asset,
      agentUri,
      createdAt,
    }
  }

  /**
   * Get Solana agents by owner
   */
  async getSolanaAgentsByOwner(ownerPubkey: string): Promise<SolanaAgent[]> {
    const owner = new PublicKey(ownerPubkey)

    const accounts = await this.solanaConnection.getProgramAccounts(
      AGENT_REGISTRY_PROGRAM_ID,
      {
        filters: [
          { dataSize: 365 },
          {
            memcmp: {
              offset: 16,
              bytes: owner.toBase58(),
            },
          },
        ],
      },
    )

    const agents: SolanaAgent[] = []
    for (const { account } of accounts) {
      const data = account.data
      let offset = 8

      const agentId = data.readBigUInt64LE(offset)
      offset += 8

      const ownerRead = new PublicKey(
        data.slice(offset, offset + 32),
      ).toBase58()
      offset += 32

      const asset = new PublicKey(data.slice(offset, offset + 32)).toBase58()
      offset += 32

      const uriLen = data.readUInt32LE(offset)
      offset += 4
      const agentUri = data.slice(offset, offset + uriLen).toString('utf8')
      offset += uriLen + 4 // Skip to createdAt

      const nameLen = data.readUInt32LE(offset - 4)
      offset += nameLen
      const symbolLen = data.readUInt32LE(offset)
      offset += 4 + symbolLen

      const createdAt = Number(data.readBigInt64LE(offset))

      agents.push({ agentId, owner: ownerRead, asset, agentUri, createdAt })
    }

    return agents
  }

  /**
   * Compute federated ID for a Solana agent
   */
  computeSolanaFederatedId(agentId: bigint, isDevnet: boolean = false): Hex {
    const chainId = isDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID
    return keccak256(
      encodePacked(
        ['string', 'uint256', 'string', 'uint256'],
        ['jeju:federated:', chainId, ':', agentId],
      ),
    )
  }

  /**
   * Compute federated ID for an EVM agent
   */
  async computeEvmFederatedId(agentId: bigint): Promise<Hex> {
    return (await this.evmPublicClient.readContract({
      address: this.config.federatedIdentityAddress,
      abi: FEDERATED_IDENTITY_ABI,
      functionName: 'computeFederatedId',
      args: [BigInt(this.config.evmChainId), agentId],
    })) as Hex
  }

  /**
   * Get federated agent info from EVM contract
   */
  async getFederatedAgent(federatedId: Hex): Promise<FederatedAgent | null> {
    const result = (await this.evmPublicClient.readContract({
      address: this.config.federatedIdentityAddress,
      abi: FEDERATED_IDENTITY_ABI,
      functionName: 'getFederatedAgent',
      args: [federatedId],
    })) as [bigint, bigint, Address, Hex, bigint, boolean, bigint]

    if (result[4] === 0n) return null

    return {
      originChainId: result[0],
      originAgentId: result[1],
      originOwner: result[2],
      originRegistryHash: result[3],
      federatedAt: result[4],
      isActive: result[5],
      reputationScore: result[6],
    }
  }

  /**
   * Verify an identity across chains
   */
  async verifyIdentity(
    chainId: number,
    agentId: bigint,
  ): Promise<{ isValid: boolean; federatedId: Hex; reputation: bigint }> {
    const result = (await this.evmPublicClient.readContract({
      address: this.config.federatedIdentityAddress,
      abi: FEDERATED_IDENTITY_ABI,
      functionName: 'verifyIdentity',
      args: [BigInt(chainId), agentId],
    })) as [boolean, Hex, bigint]

    return {
      isValid: result[0],
      federatedId: result[1],
      reputation: result[2],
    }
  }

  /**
   * Register a Solana agent in the EVM FederatedIdentity contract
   * Requires oracle role on EVM side
   */
  async registerSolanaAgentOnEvm(
    solanaAgentId: bigint,
    solanaOwner: string,
    isDevnet: boolean = false,
  ): Promise<Hex> {
    if (!this.evmWalletClient || !this.evmAccount) {
      throw new Error('EVM wallet not configured')
    }

    const chainId = isDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID

    // Derive owner address for EVM - use first 20 bytes of pubkey hash
    const ownerPubkey = new PublicKey(solanaOwner)
    const ownerBytes = ownerPubkey.toBytes()
    const ownerHash = keccak256(ownerBytes)
    const evmOwnerAddress = `0x${ownerHash.slice(2, 42)}` as Address

    // Create registry hash from Solana program ID + agent ID
    const registryHash = keccak256(
      encodePacked(
        ['bytes32', 'uint256'],
        [
          `0x${Buffer.from(AGENT_REGISTRY_PROGRAM_ID.toBytes()).toString('hex')}` as Hex,
          solanaAgentId,
        ],
      ),
    )

    // Create attestation signature
    const attestationData = keccak256(
      encodePacked(
        ['uint256', 'uint256', 'address', 'bytes32'],
        [chainId, solanaAgentId, evmOwnerAddress, registryHash],
      ),
    )

    const signature = await this.evmWalletClient.signMessage({
      account: this.evmAccount,
      message: { raw: toBytes(attestationData) },
    })

    const hash = await this.evmWalletClient.writeContract({
      address: this.config.federatedIdentityAddress,
      abi: FEDERATED_IDENTITY_ABI,
      functionName: 'registerRemoteAgent',
      args: [chainId, solanaAgentId, evmOwnerAddress, registryHash, signature],
      account: this.evmAccount,
      chain: null,
    })

    return hash
  }

  /**
   * Create cross-chain attestation for a federated identity
   */
  async attestCrossChain(
    federatedId: Hex,
    targetChainId: number,
  ): Promise<Hex> {
    if (!this.evmWalletClient || !this.evmAccount) {
      throw new Error('EVM wallet not configured')
    }

    const hash = await this.evmWalletClient.writeContract({
      address: this.config.federatedIdentityAddress,
      abi: FEDERATED_IDENTITY_ABI,
      functionName: 'attestCrossNetwork',
      args: [federatedId, BigInt(targetChainId), '0x' as Hex],
      account: this.evmAccount,
      chain: null,
    })

    return hash
  }

  /**
   * Get full cross-chain identity link
   */
  async getIdentityLink(
    evmAddress?: Address,
    solanaPubkey?: string,
  ): Promise<CrossChainIdentityLink | null> {
    let evmAgentId: bigint | null = null
    let evmOwner: Address | null = null
    let solanaAgentId: bigint | null = null
    let solanaOwner: string | null = null
    let federatedId: Hex | null = null
    let reputation = 0
    const attestedChains: number[] = []

    // Try EVM first
    if (evmAddress) {
      const evmAgent = await this.getEvmAgent(evmAddress)
      if (evmAgent) {
        evmAgentId = evmAgent.agentId
        evmOwner = evmAgent.owner
        federatedId = await this.computeEvmFederatedId(evmAgentId)
      }
    }

    // Try Solana
    if (solanaPubkey) {
      const solanaAgents = await getSolanaAgentsByOwner(solanaPubkey)
      if (solanaAgents.length > 0) {
        solanaAgentId = solanaAgents[0].agentId
        solanaOwner = solanaAgents[0].owner

        if (!federatedId) {
          federatedId = this.computeSolanaFederatedId(solanaAgentId)
        }
      }
    }

    if (!federatedId) return null

    // Get federated info if exists
    const federated = await this.getFederatedAgent(federatedId)
    if (federated) {
      reputation = Number(federated.reputationScore)
      attestedChains.push(this.config.evmChainId)
    }

    return {
      federatedId,
      evmAgentId,
      evmChainId: evmAgentId ? this.config.evmChainId : null,
      evmOwner,
      solanaAgentId,
      solanaOwner,
      reputation,
      attestedChains,
    }
  }
}

// Helper function for external use
async function getSolanaAgentsByOwner(
  ownerPubkey: string,
): Promise<SolanaAgent[]> {
  const connection = new Connection(
    'https://api.devnet.solana.com',
    'confirmed',
  )
  const owner = new PublicKey(ownerPubkey)

  const accounts = await connection.getProgramAccounts(
    AGENT_REGISTRY_PROGRAM_ID,
    {
      filters: [
        { dataSize: 365 },
        { memcmp: { offset: 16, bytes: owner.toBase58() } },
      ],
    },
  )

  return accounts.map(({ account }) => {
    const data = account.data
    let offset = 8
    const agentId = data.readBigUInt64LE(offset)
    offset += 8
    const ownerRead = new PublicKey(data.slice(offset, offset + 32)).toBase58()
    offset += 32
    const asset = new PublicKey(data.slice(offset, offset + 32)).toBase58()
    offset += 32
    const uriLen = data.readUInt32LE(offset)
    offset += 4
    const agentUri = data.slice(offset, offset + uriLen).toString('utf8')
    offset += uriLen
    const nameLen = data.readUInt32LE(offset)
    offset += 4 + nameLen
    const symbolLen = data.readUInt32LE(offset)
    offset += 4 + symbolLen
    const createdAt = Number(data.readBigInt64LE(offset))
    return { agentId, owner: ownerRead, asset, agentUri, createdAt }
  })
}

export function createFederatedIdentityBridge(
  config: FederatedIdentityConfig,
): FederatedIdentityBridge {
  return new FederatedIdentityBridge(config)
}
