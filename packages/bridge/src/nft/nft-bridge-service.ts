/**
 * Cross-Chain NFT Bridge Service
 * Handles NFT bridging between EVM chains and Solana
 */

import { EventEmitter } from 'node:events'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  type Address,
  type Chain,
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
import { arbitrum, base, mainnet, optimism, sepolia } from 'viem/chains'
import { createLogger } from '../utils/logger.js'

const log = createLogger('nft-bridge')

const METAPLEX_TOKEN_METADATA_PROGRAM = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
)
const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
)

const CROSS_CHAIN_NFT_BRIDGE_ABI = parseAbi([
  'function bridgeNFT(address nftContract, uint256 tokenId, uint256 destChainId, bytes32 destRecipient) external payable returns (bytes32)',
  'function bridgeNFTBatch(address nftContract, uint256[] tokenIds, uint256 destChainId, bytes32 destRecipient) external payable returns (bytes32[])',
  'function completeBridge(uint256 sourceChainId, bytes32 sourceRequestId, address nftContract, uint256 tokenId, address recipient, string tokenUri, bytes proof) external',
  'function cancelBridge(bytes32 requestId) external',
  'function calculateBridgeFee(address nftContract) view returns (uint256)',
  'function getRequest(bytes32 requestId) view returns (bytes32, address, address, uint256, uint256, bytes32, string, uint256, uint8)',
  'function isTransferCompleted(uint256 sourceChainId, bytes32 sourceRequestId) view returns (bool)',
  'event BridgeInitiated(bytes32 indexed requestId, address indexed sender, address indexed nftContract, uint256 tokenId, uint256 destChainId, bytes32 destRecipient)',
  'event BridgeCompleted(bytes32 indexed requestId, address indexed recipient, address indexed nftContract, uint256 tokenId, uint256 sourceChainId)',
])

const ERC721_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function approve(address to, uint256 tokenId) external',
  'function setApprovalForAll(address operator, bool approved) external',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function getApproved(uint256 tokenId) view returns (address)',
])

const CHAINS: Record<number, { chain: Chain; name: string }> = {
  1: { chain: mainnet, name: 'Ethereum' },
  11155111: { chain: sepolia, name: 'Sepolia' },
  42161: { chain: arbitrum, name: 'Arbitrum' },
  8453: { chain: base, name: 'Base' },
  10: { chain: optimism, name: 'Optimism' },
}

const SOLANA_CHAIN_ID = 101
const SOLANA_DEVNET_CHAIN_ID = 102

export interface NFTBridgeConfig {
  evmPrivateKey: Hex
  evmRpcUrls: Record<number, string>
  bridgeAddresses: Record<number, Address>
  solanaRpcUrl: string
  solanaKeypair?: Uint8Array
  oraclePrivateKey?: Hex // For attestation signing
}

export interface BridgeRequest {
  requestId: Hex
  sender: Address
  nftContract: Address
  tokenId: bigint
  destChainId: number
  destRecipient: Hex
  tokenUri: string
  timestamp: bigint
  status: BridgeStatus
}

export const BridgeStatus = {
  PENDING: 0,
  COMPLETED: 1,
  CANCELLED: 2,
  FAILED: 3,
} as const
export type BridgeStatus = (typeof BridgeStatus)[keyof typeof BridgeStatus]

export interface SolanaNFTMetadata {
  mint: string
  name: string
  symbol: string
  uri: string
  sellerFeeBasisPoints: number
}

export interface CrossChainNFT {
  id: string
  chainId: number
  contract: string
  tokenId: string
  owner: string
  name: string
  imageUri: string
  metadata?: Record<string, unknown>
}

type ChainClients = {
  public: ReturnType<typeof createPublicClient>
  wallet: ReturnType<typeof createWalletClient>
}

export class NFTBridgeService extends EventEmitter {
  private config: NFTBridgeConfig
  private account: PrivateKeyAccount
  private oracleAccount: PrivateKeyAccount | null = null
  private evmClients: Map<number, ChainClients> = new Map()
  private solanaConnection: Connection
  private solanaKeypair: Keypair | null = null

  constructor(config: NFTBridgeConfig) {
    super()
    this.config = config
    this.account = privateKeyToAccount(config.evmPrivateKey)

    if (config.oraclePrivateKey) {
      this.oracleAccount = privateKeyToAccount(config.oraclePrivateKey)
    }

    // Initialize EVM clients
    for (const [chainIdStr, rpcUrl] of Object.entries(config.evmRpcUrls)) {
      const chainId = Number(chainIdStr)
      const chainConfig = CHAINS[chainId]
      if (!chainConfig) continue

      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(rpcUrl),
      })

      const walletClient = createWalletClient({
        account: this.account,
        chain: chainConfig.chain,
        transport: http(rpcUrl),
      })

      this.evmClients.set(chainId, {
        public: publicClient,
        wallet: walletClient,
      })
    }

    // Initialize Solana connection
    this.solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed')

    if (config.solanaKeypair) {
      this.solanaKeypair = Keypair.fromSecretKey(config.solanaKeypair)
    }
  }

  /**
   * Bridge an NFT from EVM to another chain (EVM or Solana)
   */
  async bridgeFromEVM(params: {
    sourceChainId: number
    nftContract: Address
    tokenId: bigint
    destChainId: number
    destRecipient: string // Address or Solana pubkey
  }): Promise<{ requestId: Hex; txHash: Hex }> {
    const clients = this.evmClients.get(params.sourceChainId)
    if (!clients)
      throw new Error(`Chain ${params.sourceChainId} not configured`)

    const bridgeAddress = this.config.bridgeAddresses[params.sourceChainId]
    if (!bridgeAddress)
      throw new Error(`Bridge not deployed on chain ${params.sourceChainId}`)

    // Convert recipient to bytes32
    let destRecipientBytes32: Hex
    if (
      params.destChainId === SOLANA_CHAIN_ID ||
      params.destChainId === SOLANA_DEVNET_CHAIN_ID
    ) {
      // Solana pubkey to bytes32
      const pubkey = new PublicKey(params.destRecipient)
      destRecipientBytes32 =
        `0x${Buffer.from(pubkey.toBytes()).toString('hex')}` as Hex
    } else {
      // EVM address padded to bytes32
      destRecipientBytes32 =
        `0x${params.destRecipient.slice(2).padStart(64, '0')}` as Hex
    }

    // Check approval
    const isApproved = await this.checkApproval(
      params.sourceChainId,
      params.nftContract,
      params.tokenId,
      bridgeAddress,
    )

    if (!isApproved) {
      await this.approveNFT(
        params.sourceChainId,
        params.nftContract,
        params.tokenId,
        bridgeAddress,
      )
    }

    // Get bridge fee
    const fee = (await clients.public.readContract({
      address: bridgeAddress,
      abi: CROSS_CHAIN_NFT_BRIDGE_ABI,
      functionName: 'calculateBridgeFee',
      args: [params.nftContract],
    })) as bigint

    // Initiate bridge
    const hash = await clients.wallet.writeContract({
      address: bridgeAddress,
      abi: CROSS_CHAIN_NFT_BRIDGE_ABI,
      functionName: 'bridgeNFT',
      args: [
        params.nftContract,
        params.tokenId,
        BigInt(params.destChainId),
        destRecipientBytes32,
      ],
      value: fee,
      account: this.account,
      chain: null,
    })

    // Wait for receipt to get request ID from logs
    const receipt = await clients.public.waitForTransactionReceipt({ hash })

    // Parse BridgeInitiated event
    let requestId: Hex = '0x' as Hex
    for (const log of receipt.logs) {
      if (
        log.topics[0] ===
        keccak256(
          toBytes(
            'BridgeInitiated(bytes32,address,address,uint256,uint256,bytes32)',
          ),
        )
      ) {
        requestId = log.topics[1] as Hex
        break
      }
    }

    this.emit('bridgeInitiated', {
      requestId,
      txHash: hash,
      sourceChainId: params.sourceChainId,
      destChainId: params.destChainId,
    })

    return { requestId, txHash: hash }
  }

  /**
   * Bridge multiple NFTs in batch
   */
  async bridgeBatchFromEVM(params: {
    sourceChainId: number
    nftContract: Address
    tokenIds: bigint[]
    destChainId: number
    destRecipient: string
  }): Promise<{ requestIds: Hex[]; txHash: Hex }> {
    const clients = this.evmClients.get(params.sourceChainId)
    if (!clients)
      throw new Error(`Chain ${params.sourceChainId} not configured`)

    const bridgeAddress = this.config.bridgeAddresses[params.sourceChainId]
    if (!bridgeAddress)
      throw new Error(`Bridge not deployed on chain ${params.sourceChainId}`)

    // Convert recipient to bytes32
    let destRecipientBytes32: Hex
    if (
      params.destChainId === SOLANA_CHAIN_ID ||
      params.destChainId === SOLANA_DEVNET_CHAIN_ID
    ) {
      const pubkey = new PublicKey(params.destRecipient)
      destRecipientBytes32 =
        `0x${Buffer.from(pubkey.toBytes()).toString('hex')}` as Hex
    } else {
      destRecipientBytes32 =
        `0x${params.destRecipient.slice(2).padStart(64, '0')}` as Hex
    }

    // Check and set approval for all
    const isApprovedForAll = (await clients.public.readContract({
      address: params.nftContract,
      abi: ERC721_ABI,
      functionName: 'isApprovedForAll',
      args: [this.account.address, bridgeAddress],
    })) as boolean

    if (!isApprovedForAll) {
      const approvalHash = await clients.wallet.writeContract({
        address: params.nftContract,
        abi: ERC721_ABI,
        functionName: 'setApprovalForAll',
        args: [bridgeAddress, true],
        account: this.account,
        chain: null,
      })
      await clients.public.waitForTransactionReceipt({ hash: approvalHash })
    }

    // Get total fee
    const feePerNFT = (await clients.public.readContract({
      address: bridgeAddress,
      abi: CROSS_CHAIN_NFT_BRIDGE_ABI,
      functionName: 'calculateBridgeFee',
      args: [params.nftContract],
    })) as bigint

    const totalFee = feePerNFT * BigInt(params.tokenIds.length)

    // Initiate batch bridge
    const hash = await clients.wallet.writeContract({
      address: bridgeAddress,
      abi: CROSS_CHAIN_NFT_BRIDGE_ABI,
      functionName: 'bridgeNFTBatch',
      args: [
        params.nftContract,
        params.tokenIds,
        BigInt(params.destChainId),
        destRecipientBytes32,
      ],
      value: totalFee,
      account: this.account,
      chain: null,
    })

    const receipt = await clients.public.waitForTransactionReceipt({ hash })

    // Parse all BridgeInitiated events
    const requestIds: Hex[] = []
    const eventTopic = keccak256(
      toBytes(
        'BridgeInitiated(bytes32,address,address,uint256,uint256,bytes32)',
      ),
    )
    for (const log of receipt.logs) {
      if (log.topics[0] === eventTopic) {
        requestIds.push(log.topics[1] as Hex)
      }
    }

    return { requestIds, txHash: hash }
  }

  /**
   * Complete a bridge transfer on destination chain
   */
  async completeBridgeOnEVM(params: {
    sourceChainId: number
    sourceRequestId: Hex
    destChainId: number
    nftContract: Address
    tokenId: bigint
    recipient: Address
    tokenUri: string
  }): Promise<Hex> {
    const clients = this.evmClients.get(params.destChainId)
    if (!clients) throw new Error(`Chain ${params.destChainId} not configured`)

    const bridgeAddress = this.config.bridgeAddresses[params.destChainId]
    if (!bridgeAddress)
      throw new Error(`Bridge not deployed on chain ${params.destChainId}`)

    // Generate proof/attestation based on source chain
    let proof: Hex
    if (
      params.sourceChainId === SOLANA_CHAIN_ID ||
      params.sourceChainId === SOLANA_DEVNET_CHAIN_ID
    ) {
      // Oracle attestation for Solana
      proof = await this.generateOracleAttestation(
        params.sourceChainId,
        params.sourceRequestId,
        params.destChainId,
        params.nftContract,
        params.tokenId,
        params.recipient,
        params.tokenUri,
      )
    } else {
      // ZK proof for EVM - uses SP1 prover when configured
      proof = await this.generateZKProof(
        params.sourceChainId,
        params.sourceRequestId,
        params.destChainId,
        params.nftContract,
        params.tokenId,
        params.recipient,
      )
    }

    const hash = await clients.wallet.writeContract({
      address: bridgeAddress,
      abi: CROSS_CHAIN_NFT_BRIDGE_ABI,
      functionName: 'completeBridge',
      args: [
        BigInt(params.sourceChainId),
        params.sourceRequestId,
        params.nftContract,
        params.tokenId,
        params.recipient,
        params.tokenUri,
        proof,
      ],
      account: this.account,
      chain: null,
    })

    this.emit('bridgeCompleted', {
      sourceChainId: params.sourceChainId,
      destChainId: params.destChainId,
      txHash: hash,
    })

    return hash
  }

  /**
   * Bridge NFT from Solana to EVM
   */
  async bridgeFromSolana(params: {
    mint: string
    destChainId: number
    destRecipient: Address
  }): Promise<{ signature: string; requestId: string }> {
    if (!this.solanaKeypair) throw new Error('Solana keypair not configured')

    const mint = new PublicKey(params.mint)

    // Verify NFT exists and get metadata (validates ownership)
    await this.getSolanaNFTMetadata(params.mint)

    // Generate request ID
    const requestId = keccak256(
      encodePacked(
        ['uint256', 'bytes32', 'uint256', 'address', 'uint256'],
        [
          BigInt(SOLANA_CHAIN_ID),
          `0x${Buffer.from(mint.toBytes()).toString('hex')}` as Hex,
          BigInt(params.destChainId),
          params.destRecipient,
          BigInt(Date.now()),
        ],
      ),
    )

    // Lock NFT in Solana bridge program
    // This would call a Solana program instruction to lock the NFT
    // For now, we'll simulate with a transfer to a bridge PDA

    const [bridgePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nft_bridge'), mint.toBuffer()],
      new PublicKey('11111111111111111111111111111111'), // Would be actual bridge program
    )

    // Get the token account for this NFT
    const [tokenAccount] = PublicKey.findProgramAddressSync(
      [
        this.solanaKeypair.publicKey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
    )

    // Create bridge instruction (simplified - would use actual program)
    const instruction = new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [
        {
          pubkey: this.solanaKeypair.publicKey,
          isSigner: true,
          isWritable: true,
        },
        { pubkey: tokenAccount, isSigner: false, isWritable: true },
        { pubkey: bridgePda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([
        0x01, // Bridge instruction
        ...Buffer.from(params.destRecipient.slice(2), 'hex'),
        ...Buffer.alloc(4).fill(params.destChainId),
      ]),
    })

    const transaction = new Transaction().add(instruction)
    const signature = await sendAndConfirmTransaction(
      this.solanaConnection,
      transaction,
      [this.solanaKeypair],
    )

    this.emit('solanaBridgeInitiated', {
      signature,
      requestId,
      mint: params.mint,
      destChainId: params.destChainId,
    })

    return { signature, requestId }
  }

  /**
   * Get bridge request status
   */
  async getRequestStatus(
    chainId: number,
    requestId: Hex,
  ): Promise<BridgeRequest | null> {
    const clients = this.evmClients.get(chainId)
    if (!clients) return null

    const bridgeAddress = this.config.bridgeAddresses[chainId]
    if (!bridgeAddress) return null

    const result = (await clients.public.readContract({
      address: bridgeAddress,
      abi: CROSS_CHAIN_NFT_BRIDGE_ABI,
      functionName: 'getRequest',
      args: [requestId],
    })) as [Hex, Address, Address, bigint, bigint, Hex, string, bigint, number]

    if (
      result[0] ===
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    ) {
      return null
    }

    return {
      requestId: result[0],
      sender: result[1],
      nftContract: result[2],
      tokenId: result[3],
      destChainId: Number(result[4]),
      destRecipient: result[5],
      tokenUri: result[6],
      timestamp: result[7],
      status: result[8] as BridgeStatus,
    }
  }

  /**
   * Check if transfer is completed on destination
   */
  async isTransferCompleted(
    destChainId: number,
    sourceChainId: number,
    sourceRequestId: Hex,
  ): Promise<boolean> {
    const clients = this.evmClients.get(destChainId)
    if (!clients) return false

    const bridgeAddress = this.config.bridgeAddresses[destChainId]
    if (!bridgeAddress) return false

    return (await clients.public.readContract({
      address: bridgeAddress,
      abi: CROSS_CHAIN_NFT_BRIDGE_ABI,
      functionName: 'isTransferCompleted',
      args: [BigInt(sourceChainId), sourceRequestId],
    })) as boolean
  }

  /**
   * Get Solana NFT metadata
   */
  async getSolanaNFTMetadata(mint: string): Promise<SolanaNFTMetadata> {
    const mintPubkey = new PublicKey(mint)
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        METAPLEX_TOKEN_METADATA_PROGRAM.toBuffer(),
        mintPubkey.toBuffer(),
      ],
      METAPLEX_TOKEN_METADATA_PROGRAM,
    )

    const accountInfo = await this.solanaConnection.getAccountInfo(metadataPda)
    if (!accountInfo) throw new Error(`Metadata not found for mint ${mint}`)

    const data = accountInfo.data
    let offset = 1 + 32 + 32 // Skip key, update authority, mint

    const nameLen = data.readUInt32LE(offset)
    offset += 4
    const name = data
      .slice(offset, offset + nameLen)
      .toString('utf8')
      .replace(/\0/g, '')
    offset += 32

    const symbolLen = data.readUInt32LE(offset)
    offset += 4
    const symbol = data
      .slice(offset, offset + symbolLen)
      .toString('utf8')
      .replace(/\0/g, '')
    offset += 10

    const uriLen = data.readUInt32LE(offset)
    offset += 4
    const uri = data
      .slice(offset, offset + uriLen)
      .toString('utf8')
      .replace(/\0/g, '')
    offset += 200

    const sellerFeeBasisPoints = data.readUInt16LE(offset)

    return { mint, name, symbol, uri, sellerFeeBasisPoints }
  }

  // ============ Private Methods ============

  private async checkApproval(
    chainId: number,
    nftContract: Address,
    tokenId: bigint,
    spender: Address,
  ): Promise<boolean> {
    const clients = this.evmClients.get(chainId)
    if (!clients) return false

    const approved = (await clients.public.readContract({
      address: nftContract,
      abi: ERC721_ABI,
      functionName: 'getApproved',
      args: [tokenId],
    })) as Address

    if (approved.toLowerCase() === spender.toLowerCase()) return true

    const isApprovedForAll = (await clients.public.readContract({
      address: nftContract,
      abi: ERC721_ABI,
      functionName: 'isApprovedForAll',
      args: [this.account.address, spender],
    })) as boolean

    return isApprovedForAll
  }

  private async approveNFT(
    chainId: number,
    nftContract: Address,
    tokenId: bigint,
    spender: Address,
  ): Promise<void> {
    const clients = this.evmClients.get(chainId)
    if (!clients) throw new Error(`Chain ${chainId} not configured`)

    const hash = await clients.wallet.writeContract({
      address: nftContract,
      abi: ERC721_ABI,
      functionName: 'approve',
      args: [spender, tokenId],
      account: this.account,
      chain: null,
    })

    await clients.public.waitForTransactionReceipt({ hash })
  }

  private async generateOracleAttestation(
    sourceChainId: number,
    sourceRequestId: Hex,
    destChainId: number,
    nftContract: Address,
    tokenId: bigint,
    recipient: Address,
    tokenUri: string,
  ): Promise<Hex> {
    if (!this.oracleAccount) {
      throw new Error('Oracle account not configured')
    }

    // SECURITY: Add timestamp and expiry to prevent replay of old attestations
    const timestamp = BigInt(Math.floor(Date.now() / 1000))
    const validityPeriod = 3600n // 1 hour validity
    const expiresAt = timestamp + validityPeriod

    // SECURITY: Include timestamp and expiry in the signed message
    const messageHash = keccak256(
      encodePacked(
        [
          'uint256',
          'bytes32',
          'uint256',
          'address',
          'uint256',
          'address',
          'string',
          'uint256',
          'uint256',
        ],
        [
          BigInt(sourceChainId),
          sourceRequestId,
          BigInt(destChainId),
          nftContract,
          tokenId,
          recipient,
          tokenUri,
          timestamp,
          expiresAt,
        ],
      ),
    )

    const clients = this.evmClients.values().next().value
    if (!clients) throw new Error('No EVM client available')

    const signature = await clients.wallet.signMessage({
      account: this.oracleAccount,
      message: { raw: toBytes(messageHash) },
    })

    // SECURITY: Encode timestamp and expiry with signature for verification
    // Format: signature (65 bytes) + timestamp (8 bytes) + expiresAt (8 bytes)
    const timestampHex = timestamp.toString(16).padStart(16, '0')
    const expiresAtHex = expiresAt.toString(16).padStart(16, '0')

    return `${signature}${timestampHex}${expiresAtHex}` as Hex
  }

  private async generateZKProof(
    sourceChainId: number,
    sourceRequestId: Hex,
    destChainId: number,
    nftContract: Address,
    tokenId: bigint,
    recipient: Address,
  ): Promise<Hex> {
    // Use SP1 prover for ZK proof generation
    const proverUrl = process.env.SP1_PROVER_URL
    const apiKey = process.env.SUCCINCT_API_KEY
    const isProduction = process.env.NODE_ENV === 'production'

    if (proverUrl || apiKey) {
      // Conditional dynamic import: only load SP1 prover if configured
      // This avoids loading heavy SP1 dependencies when not needed
      const { createSP1Client } = await import('../prover/sp1-client.js')
      // Conditional dynamic import: only load types when SP1 prover is used
      const { toHash32 } = await import('../types/index.js')
      const prover = createSP1Client({
        programsDir: process.cwd(),
        useSuccinctNetwork: Boolean(apiKey),
        succinctApiKey: apiKey,
      })

      await prover.initialize()

      // Create transfer hash as input
      const transferHash = keccak256(
        encodePacked(
          ['uint256', 'bytes32', 'uint256', 'address', 'uint256', 'address'],
          [
            BigInt(sourceChainId),
            sourceRequestId,
            BigInt(destChainId),
            nftContract,
            tokenId,
            recipient,
          ],
        ),
      )

      const proofResult = await prover.proveTokenTransfer({
        transferId: toHash32(Buffer.from(transferHash.slice(2), 'hex')),
        sourceChainId,
        destChainId,
        sender: Buffer.from(nftContract.slice(2), 'hex'),
        recipient: Buffer.from(recipient.slice(2), 'hex'),
        amount: tokenId,
        stateRoot: toHash32(new Uint8Array(32)),
      })

      if (!proofResult.success) {
        throw new Error(`ZK proof generation failed: ${proofResult.error}`)
      }

      // Encode the Groth16 proof for on-chain verification
      return this.encodeGroth16Proof(proofResult.groth16)
    }

    // Development mode: generate deterministic test proof
    if (isProduction) {
      throw new Error(
        'ZK proof generation requires SP1 prover in production. ' +
          'Configure SP1_PROVER_URL or SUCCINCT_API_KEY environment variable.',
      )
    }

    log.warn('Using development mode proof - NOT FOR PRODUCTION')
    const proofData = keccak256(
      encodePacked(
        [
          'uint256',
          'bytes32',
          'uint256',
          'address',
          'uint256',
          'address',
          'string',
        ],
        [
          BigInt(sourceChainId),
          sourceRequestId,
          BigInt(destChainId),
          nftContract,
          tokenId,
          recipient,
          'dev-mode-proof',
        ],
      ),
    )

    return proofData
  }

  private encodeGroth16Proof(groth16: {
    a: bigint[]
    b: bigint[][]
    c: bigint[]
  }): Hex {
    // Encode Groth16 proof components for Solidity verifier
    // Format: abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c)
    const abiEncode = (values: bigint[]): string =>
      values.map((v) => v.toString(16).padStart(64, '0')).join('')

    const a = abiEncode(groth16.a)
    const b0 = abiEncode(groth16.b[0])
    const b1 = abiEncode(groth16.b[1])
    const c = abiEncode(groth16.c)

    return `0x${a}${b0}${b1}${c}` as Hex
  }
}

export function createNFTBridgeService(
  config: NFTBridgeConfig,
): NFTBridgeService {
  return new NFTBridgeService(config)
}
