/**
 * KMS-Backed EVM Client for Cross-Chain Bridge
 *
 * SECURITY: This client NEVER stores private keys in memory.
 * All signing operations are delegated to the KMS/MPC infrastructure.
 *
 * Side-Channel Resistance:
 * - Private keys exist only as threshold shares in remote enclaves
 * - Signing happens via MPC protocol without key reconstruction
 * - No key material ever enters this process
 *
 * Use this instead of EVMClient for production deployments.
 */

import {
  type Account,
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  serializeTransaction,
  type SignableMessage,
  toBytes,
  type TransactionSerializable,
  type WalletClient,
} from 'viem'
import { z } from 'zod'
import type { ChainId, Hash32 } from '../types/index.js'
import { TransferStatus, toHash32 } from '../types/index.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('kms-evm-client')

// Schema for TransferInitiated event args
const TransferInitiatedArgsSchema = z.object({
  transferId: z.string().transform((s) => s as Hex),
})

const BRIDGE_ABI = parseAbi([
  'function initiateTransfer(address token, bytes32 recipient, uint256 amount, uint256 destChainId, bytes payload) payable returns (bytes32)',
  'function completeTransfer(bytes32 transferId, address token, bytes32 sender, address recipient, uint256 amount, uint64 slot, uint256[8] proof, uint256[] publicInputs)',
  'function getTransferStatus(bytes32 transferId) view returns (uint8)',
  'function getTransferFee(uint256 destChainId, uint256 payloadLength) view returns (uint256)',
  'function isTokenRegistered(address token) view returns (bool)',
  'event TransferInitiated(bytes32 indexed transferId, address indexed token, address indexed sender, bytes32 recipient, uint256 amount, uint256 destChainId)',
  'event TransferCompleted(bytes32 indexed transferId, address indexed token, bytes32 sender, address indexed recipient, uint256 amount)',
])

const LIGHT_CLIENT_ABI = parseAbi([
  'function getLatestSlot() view returns (uint64)',
  'function getBankHash(uint64 slot) view returns (bytes32)',
  'function getCurrentEpoch() view returns (uint64 epoch, bytes32 stakesRoot)',
  'function isSlotVerified(uint64 slot) view returns (bool)',
  'function updateState(uint64 slot, bytes32 bankHash, bytes32 epochStakesRoot, uint256[8] proof, uint256[] publicInputs)',
])

const TOKEN_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
])

/**
 * KMS Signer Interface
 *
 * This interface abstracts the signing backend.
 * Implementations should NEVER expose private keys.
 */
export interface KMSSigner {
  /** Key ID in the KMS */
  keyId: string
  /** Public address derived from the key */
  address: Address

  /**
   * Sign a message hash.
   * The private key NEVER leaves the KMS.
   */
  sign(messageHash: Hex): Promise<{
    signature: Hex
    r: Hex
    s: Hex
    v: number
  }>
}

export interface KMSEVMClientConfig {
  chainId: ChainId
  rpcUrl: string
  bridgeAddress: Address
  lightClientAddress: Address
  /** KMS signer - signing happens remotely */
  kmsSigner: KMSSigner
}

/**
 * Create a viem Account that delegates all signing to KMS.
 *
 * SECURITY: This account implementation NEVER has access to private keys.
 * All signing is delegated to the KMS infrastructure.
 */
function createKMSAccount(kmsSigner: KMSSigner): Account {
  return {
    address: kmsSigner.address,
    type: 'local',
    // publicKey and source are required by viem's Account type
    publicKey: '0x' as Hex, // Not used - all signing goes to KMS
    source: 'custom' as const,

    async signMessage({
      message,
    }: {
      message: SignableMessage
    }): Promise<Hex> {
      let messageBytes: Uint8Array
      if (typeof message === 'string') {
        messageBytes = toBytes(message)
      } else if ('raw' in message) {
        messageBytes =
          typeof message.raw === 'string' ? toBytes(message.raw) : message.raw
      } else {
        messageBytes = toBytes(message)
      }

      // Ethereum signed message prefix
      const prefix = `\x19Ethereum Signed Message:\n${messageBytes.length}`
      const prefixedMessage = new Uint8Array([
        ...toBytes(prefix),
        ...messageBytes,
      ])
      const messageHash = keccak256(prefixedMessage)

      const { signature } = await kmsSigner.sign(messageHash)
      return signature
    },

    async signTransaction(
      transaction: TransactionSerializable,
    ): Promise<Hex> {
      const serialized = serializeTransaction(transaction)
      const txHash = keccak256(serialized)

      const { r, s, v } = await kmsSigner.sign(txHash)

      // Append signature to serialized transaction
      const signedTx = serializeTransaction(transaction, {
        r,
        s,
        v: BigInt(v),
      })

      return signedTx
    },

    async signTypedData(): Promise<Hex> {
      // For typed data, caller should pre-compute the hash and use sign()
      throw new Error(
        'signTypedData: Pre-compute EIP-712 hash and use sign() directly',
      )
    },
  }
}

/**
 * KMS-Backed EVM Client
 *
 * SECURITY GUARANTEES:
 * 1. Private keys NEVER enter this process
 * 2. All signing delegated to remote KMS
 * 3. Resistant to TEE side-channel attacks
 * 4. Compatible with MPC/threshold signing
 */
export class KMSEVMClient {
  private config: KMSEVMClientConfig
  private chain: Chain
  private publicClient: PublicClient
  private walletClient: WalletClient
  private account: Account

  constructor(config: KMSEVMClientConfig) {
    this.config = config

    // Create chain definition
    this.chain = {
      id: config.chainId,
      name: `Chain ${config.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    }

    // Create public client
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })

    // Create KMS-backed account
    this.account = createKMSAccount(config.kmsSigner)

    // Create wallet client with KMS account
    this.walletClient = createWalletClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
      account: this.account,
    })

    log.info('KMS EVM client initialized', {
      chainId: config.chainId,
      address: config.kmsSigner.address,
      keyId: config.kmsSigner.keyId,
    })
  }

  /**
   * Initiate a cross-chain transfer to Solana
   */
  async initiateTransfer(params: {
    token: Address
    recipient: Uint8Array
    amount: bigint
    destChainId: ChainId
    payload?: Uint8Array
  }): Promise<{
    transferId: Hash32
    txHash: Hex
    status: (typeof TransferStatus)[keyof typeof TransferStatus]
  }> {
    // Ensure token is approved
    const allowance = await this.publicClient.readContract({
      address: params.token,
      abi: TOKEN_ABI,
      functionName: 'allowance',
      args: [this.account.address, this.config.bridgeAddress],
    })

    if (allowance < params.amount) {
      log.debug('Approving token transfer via KMS')
      const approveTxHash = await this.walletClient.writeContract({
        chain: this.chain,
        account: this.account,
        address: params.token,
        abi: TOKEN_ABI,
        functionName: 'approve',
        args: [this.config.bridgeAddress, params.amount],
      })
      await this.publicClient.waitForTransactionReceipt({
        hash: approveTxHash,
      })
    }

    // Get required fee
    const payloadLength = params.payload?.length ?? 0
    const fee = await this.publicClient.readContract({
      address: this.config.bridgeAddress,
      abi: BRIDGE_ABI,
      functionName: 'getTransferFee',
      args: [BigInt(params.destChainId), BigInt(payloadLength)],
    })

    // Initiate transfer
    const recipientBytes32 =
      `0x${Buffer.from(params.recipient).toString('hex')}` as Hex
    const payloadHex = params.payload
      ? (`0x${Buffer.from(params.payload).toString('hex')}` as Hex)
      : '0x'

    const txHash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.account,
      address: this.config.bridgeAddress,
      abi: BRIDGE_ABI,
      functionName: 'initiateTransfer',
      args: [
        params.token,
        recipientBytes32,
        params.amount,
        BigInt(params.destChainId),
        payloadHex,
      ],
      value: fee,
    })

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    // Extract transfer ID from event
    const transferEvent = receipt.logs.find((eventLog) => {
      try {
        const decoded = decodeEventLog({
          abi: BRIDGE_ABI,
          data: eventLog.data,
          topics: eventLog.topics,
        })
        return decoded.eventName === 'TransferInitiated'
      } catch {
        return false
      }
    })

    if (!transferEvent) {
      throw new Error('TransferInitiated event not found')
    }

    const decoded = decodeEventLog({
      abi: BRIDGE_ABI,
      data: transferEvent.data,
      topics: transferEvent.topics,
    })

    const args = TransferInitiatedArgsSchema.parse(decoded.args)
    const transferIdBytes = Buffer.from(args.transferId.slice(2), 'hex')

    return {
      transferId: toHash32(new Uint8Array(transferIdBytes)),
      txHash,
      status: TransferStatus.PENDING,
    }
  }

  /**
   * Complete a transfer from Solana
   */
  async completeTransfer(params: {
    transferId: Hash32
    token: Address
    sender: Uint8Array
    recipient: Address
    amount: bigint
    slot: bigint
    proof: bigint[]
    publicInputs: bigint[]
  }): Promise<Hex> {
    const transferIdHex =
      `0x${Buffer.from(params.transferId).toString('hex')}` as Hex
    const senderHex = `0x${Buffer.from(params.sender).toString('hex')}` as Hex

    const proofArray = params.proof.slice(0, 8).map((p) => p) as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ]

    const txHash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.account,
      address: this.config.bridgeAddress,
      abi: BRIDGE_ABI,
      functionName: 'completeTransfer',
      args: [
        transferIdHex,
        params.token,
        senderHex,
        params.recipient,
        params.amount,
        params.slot,
        proofArray,
        params.publicInputs,
      ],
    })

    return txHash
  }

  /**
   * Get transfer status
   */
  async getTransferStatus(
    transferId: Hash32,
  ): Promise<(typeof TransferStatus)[keyof typeof TransferStatus]> {
    const transferIdHex = `0x${Buffer.from(transferId).toString('hex')}` as Hex

    const status = await this.publicClient.readContract({
      address: this.config.bridgeAddress,
      abi: BRIDGE_ABI,
      functionName: 'getTransferStatus',
      args: [transferIdHex],
    })

    const statusMap: Record<
      number,
      (typeof TransferStatus)[keyof typeof TransferStatus]
    > = {
      0: TransferStatus.PENDING,
      1: TransferStatus.SOURCE_CONFIRMED,
      2: TransferStatus.PROVING,
      3: TransferStatus.PROOF_GENERATED,
      4: TransferStatus.DEST_SUBMITTED,
      5: TransferStatus.COMPLETED,
      6: TransferStatus.FAILED,
    }

    const mappedStatus = statusMap[Number(status)]
    if (!mappedStatus) {
      throw new Error(`Unknown transfer status: ${status}`)
    }
    return mappedStatus
  }

  /**
   * Get required fee for a transfer
   */
  async getTransferFee(
    destChainId: ChainId,
    payloadLength = 0,
  ): Promise<bigint> {
    return await this.publicClient.readContract({
      address: this.config.bridgeAddress,
      abi: BRIDGE_ABI,
      functionName: 'getTransferFee',
      args: [BigInt(destChainId), BigInt(payloadLength)],
    })
  }

  /**
   * Check if token is registered
   */
  async isTokenRegistered(token: Address): Promise<boolean> {
    return await this.publicClient.readContract({
      address: this.config.bridgeAddress,
      abi: BRIDGE_ABI,
      functionName: 'isTokenRegistered',
      args: [token],
    })
  }

  /**
   * Get token balance
   */
  async getTokenBalance(token: Address, account?: Address): Promise<bigint> {
    const address = account ?? this.account.address

    return await this.publicClient.readContract({
      address: token,
      abi: TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address],
    })
  }

  /**
   * Get latest verified Solana slot
   */
  async getLatestVerifiedSlot(): Promise<bigint> {
    return await this.publicClient.readContract({
      address: this.config.lightClientAddress,
      abi: LIGHT_CLIENT_ABI,
      functionName: 'getLatestSlot',
    })
  }

  /**
   * Get bank hash for a slot
   */
  async getBankHash(slot: bigint): Promise<Hex> {
    return await this.publicClient.readContract({
      address: this.config.lightClientAddress,
      abi: LIGHT_CLIENT_ABI,
      functionName: 'getBankHash',
      args: [slot],
    })
  }

  /**
   * Check if a slot is verified
   */
  async isSlotVerified(slot: bigint): Promise<boolean> {
    return await this.publicClient.readContract({
      address: this.config.lightClientAddress,
      abi: LIGHT_CLIENT_ABI,
      functionName: 'isSlotVerified',
      args: [slot],
    })
  }

  /**
   * Update light client state
   */
  async updateLightClient(params: {
    slot: bigint
    bankHash: Hex
    epochStakesRoot: Hex
    proof: bigint[]
    publicInputs: bigint[]
  }): Promise<Hex> {
    const proofArray = params.proof.slice(0, 8).map((p) => p) as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ]

    const txHash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.account,
      address: this.config.lightClientAddress,
      abi: LIGHT_CLIENT_ABI,
      functionName: 'updateState',
      args: [
        params.slot,
        params.bankHash,
        params.epochStakesRoot,
        proofArray,
        params.publicInputs,
      ],
    })

    return txHash
  }

  /**
   * Get the configured account address
   */
  getAddress(): Address {
    return this.account.address
  }

  /**
   * Get the chain ID
   */
  getChainId(): ChainId {
    return this.config.chainId
  }

  /**
   * Get the KMS key ID
   */
  getKeyId(): string {
    return this.config.kmsSigner.keyId
  }
}

export function createKMSEVMClient(config: KMSEVMClientConfig): KMSEVMClient {
  return new KMSEVMClient(config)
}

