/**
 * EVM Client for Cross-Chain Bridge
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  type Hex,
  http,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import type { ChainId, Hash32 } from '../types/index.js'
import { TransferStatus, toHash32 } from '../types/index.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('evm-client')

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

export interface EVMClientConfig {
  chainId: ChainId
  rpcUrl: string
  privateKey?: Hex
  bridgeAddress: Address
  lightClientAddress: Address
}

export class EVMClient {
  private config: EVMClientConfig
  private chain: Chain
  private publicClient: PublicClient
  private walletClient: WalletClient | null = null
  private account: PrivateKeyAccount | null = null

  private requireAccount(): PrivateKeyAccount {
    if (!this.account) {
      throw new Error('No account configured - provide privateKey in config')
    }
    return this.account
  }

  constructor(config: EVMClientConfig) {
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

    // Create wallet client if private key provided
    if (config.privateKey) {
      this.account = privateKeyToAccount(config.privateKey)
      this.walletClient = createWalletClient({
        chain: this.chain,
        transport: http(config.rpcUrl),
        account: this.account,
      })
    }
  }

  // =============================================================================
  // TRANSFER OPERATIONS
  // =============================================================================

  /**
   * Initiate a cross-chain transfer to Solana
   */
  async initiateTransfer(params: {
    token: Address
    recipient: Uint8Array // 32-byte Solana pubkey
    amount: bigint
    destChainId: ChainId
    payload?: Uint8Array
  }): Promise<{
    transferId: Hash32
    txHash: Hex
    status: (typeof TransferStatus)[keyof typeof TransferStatus]
  }> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet not configured')
    }

    // Ensure token is approved
    const allowance = await this.publicClient.readContract({
      address: params.token,
      abi: TOKEN_ABI,
      functionName: 'allowance',
      args: [this.account.address, this.config.bridgeAddress],
    })

    if (allowance < params.amount) {
      log.debug('Approving token transfer')
      const approveTxHash = await this.walletClient.writeContract({
        chain: this.chain,
        account: this.requireAccount(),
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
    const payloadLength = params.payload?.length ?? 0 // Payload is optional, default to 0 length
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
      account: this.requireAccount(),
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

    // Wait for receipt
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    // Extract transfer ID from event
    const transferEvent = receipt.logs.find((log) => {
      try {
        const decoded = decodeEventLog({
          abi: BRIDGE_ABI,
          data: log.data,
          topics: log.topics,
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

    const transferId = (decoded.args as { transferId: Hex }).transferId
    const transferIdBytes = Buffer.from(transferId.slice(2), 'hex')

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
    if (!this.walletClient) {
      throw new Error('Wallet not configured')
    }

    const transferIdHex =
      `0x${Buffer.from(params.transferId).toString('hex')}` as Hex
    const senderHex = `0x${Buffer.from(params.sender).toString('hex')}` as Hex

    // Pack proof into uint256[8]
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
      account: this.requireAccount(),
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

  // =============================================================================
  // QUERY OPERATIONS
  // =============================================================================

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
    // Use provided account or fall back to configured account
    const address = account ?? this.account?.address
    if (!address) {
      throw new Error(
        'No account specified - provide account parameter or configure privateKey',
      )
    }

    return await this.publicClient.readContract({
      address: token,
      abi: TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address],
    })
  }

  // =============================================================================
  // LIGHT CLIENT OPERATIONS
  // =============================================================================

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
   * Update light client state (admin)
   */
  async updateLightClient(params: {
    slot: bigint
    bankHash: Hex
    epochStakesRoot: Hex
    proof: bigint[]
    publicInputs: bigint[]
  }): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('Wallet not configured')
    }

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
      account: this.requireAccount(),
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

  // =============================================================================
  // UTILITIES
  // =============================================================================

  /**
   * Get the configured account address
   * Returns null if no privateKey was provided during construction
   */
  getAddress(): Address | null {
    return this.account?.address ?? null // Legitimately optional - returns null if no wallet configured
  }

  /**
   * Get the chain ID
   */
  getChainId(): ChainId {
    return this.config.chainId
  }
}

export function createEVMClient(config: EVMClientConfig): EVMClient {
  return new EVMClient(config)
}
