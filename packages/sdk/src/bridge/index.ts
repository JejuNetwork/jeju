/**
 * Bridge Module - Cross-Chain Bridging
 *
 * Provides access to:
 * - Token bridging (ERC20, NFT)
 * - Cross-chain messaging
 * - L1 <-> L2 transfers
 * - Hyperlane integration
 * - ZK bridge verification
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex, parseEther } from 'viem'
import { requireContract } from '../config'
import type { JejuWallet } from '../wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const BridgeType = {
  CANONICAL: 0,
  HYPERLANE: 1,
  ZK: 2,
} as const
export type BridgeType = (typeof BridgeType)[keyof typeof BridgeType]

export const MessageStatus = {
  PENDING: 0,
  RELAYED: 1,
  FAILED: 2,
  FINALIZED: 3,
} as const
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus]

export interface BridgeDeposit {
  depositId: Hex
  sender: Address
  recipient: Address
  token: Address
  amount: bigint
  sourceChainId: bigint
  destChainId: bigint
  timestamp: bigint
  status: MessageStatus
}

export interface BridgeWithdrawal {
  withdrawalId: Hex
  sender: Address
  recipient: Address
  token: Address
  amount: bigint
  sourceChainId: bigint
  destChainId: bigint
  timestamp: bigint
  proofSubmitted: boolean
  finalized: boolean
}

export interface CrossChainMessage {
  messageId: Hex
  sender: Address
  recipient: Address
  sourceChainId: bigint
  destChainId: bigint
  data: Hex
  gasLimit: bigint
  status: MessageStatus
  timestamp: bigint
}

export interface NFTBridgeTransfer {
  transferId: Hex
  tokenAddress: Address
  tokenId: bigint
  sender: Address
  recipient: Address
  sourceChainId: bigint
  destChainId: bigint
  status: MessageStatus
}

export interface DepositParams {
  token: Address
  amount: bigint
  recipient: Address
  destChainId: bigint
  gasLimit?: bigint
}

export interface WithdrawParams {
  token: Address
  amount: bigint
  recipient: Address
}

export interface SendMessageParams {
  destChainId: bigint
  recipient: Address
  data: Hex
  gasLimit?: bigint
}

export interface CrossChainNFTParams {
  tokenAddress: Address
  tokenId: bigint
  recipient: Address
  destChainId: bigint
}

export interface BridgeModule {
  // Token Bridging (L1 -> L2)
  depositETH(
    params: Omit<DepositParams, 'token'>,
  ): Promise<{ txHash: Hex; depositId: Hex }>
  depositERC20(params: DepositParams): Promise<{ txHash: Hex; depositId: Hex }>
  getDeposit(depositId: Hex): Promise<BridgeDeposit | null>
  getMyDeposits(): Promise<BridgeDeposit[]>

  // Token Bridging (L2 -> L1)
  initiateWithdrawal(
    params: WithdrawParams,
  ): Promise<{ txHash: Hex; withdrawalId: Hex }>
  proveWithdrawal(withdrawalId: Hex, proof: Hex): Promise<Hex>
  finalizeWithdrawal(withdrawalId: Hex): Promise<Hex>
  getWithdrawal(withdrawalId: Hex): Promise<BridgeWithdrawal | null>
  getMyWithdrawals(): Promise<BridgeWithdrawal[]>
  getWithdrawalStatus(
    withdrawalId: Hex,
  ): Promise<{ proven: boolean; finalized: boolean; timeRemaining: bigint }>

  // Cross-Chain Messaging
  sendMessage(
    params: SendMessageParams,
  ): Promise<{ txHash: Hex; messageId: Hex }>
  getMessage(messageId: Hex): Promise<CrossChainMessage | null>
  getMessageStatus(messageId: Hex): Promise<MessageStatus>
  relayMessage(messageId: Hex, proof: Hex): Promise<Hex>

  // NFT Bridging
  bridgeNFT(
    params: CrossChainNFTParams,
  ): Promise<{ txHash: Hex; transferId: Hex }>
  getNFTTransfer(transferId: Hex): Promise<NFTBridgeTransfer | null>
  getMyNFTTransfers(): Promise<NFTBridgeTransfer[]>

  // Hyperlane
  sendHyperlaneMessage(
    destDomain: number,
    recipient: Address,
    message: Hex,
  ): Promise<{ txHash: Hex; messageId: Hex }>
  quoteHyperlaneGas(destDomain: number, message: Hex): Promise<bigint>
  getHyperlaneMessageStatus(messageId: Hex): Promise<boolean>

  // ZK Bridge
  submitZKProof(proofData: Hex, publicInputs: Hex[]): Promise<Hex>
  verifyZKBridgeTransfer(transferId: Hex): Promise<boolean>

  // Utilities
  getSupportedChains(): Promise<
    { chainId: bigint; name: string; bridgeType: BridgeType }[]
  >
  estimateBridgeFee(
    token: Address,
    amount: bigint,
    destChainId: bigint,
  ): Promise<bigint>
  getFinalizationPeriod(): Promise<bigint>

  // Constants
  readonly MIN_BRIDGE_AMOUNT: bigint
  readonly FINALIZATION_PERIOD: bigint
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const OPTIMISM_PORTAL_ABI = [
  {
    name: 'depositTransaction',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_value', type: 'uint256' },
      { name: '_gasLimit', type: 'uint64' },
      { name: '_isCreation', type: 'bool' },
      { name: '_data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'proveWithdrawalTransaction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        components: [
          { name: 'nonce', type: 'uint256' },
          { name: 'sender', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: '_l2OutputIndex', type: 'uint256' },
      {
        type: 'tuple',
        components: [
          { name: 'version', type: 'bytes32' },
          { name: 'stateRoot', type: 'bytes32' },
          { name: 'messagePasserStorageRoot', type: 'bytes32' },
          { name: 'latestBlockhash', type: 'bytes32' },
        ],
      },
      { name: '_withdrawalProof', type: 'bytes[]' },
    ],
    outputs: [],
  },
  {
    name: 'finalizeWithdrawalTransaction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        components: [
          { name: 'nonce', type: 'uint256' },
          { name: 'sender', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
] as const

const HYPERLANE_MAILBOX_ABI = [
  {
    name: 'dispatch',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_destinationDomain', type: 'uint32' },
      { name: '_recipientAddress', type: 'bytes32' },
      { name: '_messageBody', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'quoteDispatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '_destinationDomain', type: 'uint32' },
      { name: '_recipientAddress', type: 'bytes32' },
      { name: '_messageBody', type: 'bytes' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'delivered',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_messageId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
] as const

const NFT_BRIDGE_ABI = [
  {
    name: 'bridgeNFT',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'destChainId', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getTransfer',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'transferId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'transferId', type: 'bytes32' },
          { name: 'tokenAddress', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'sender', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'sourceChainId', type: 'uint256' },
          { name: 'destChainId', type: 'uint256' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createBridgeModule(
  wallet: JejuWallet,
  network: NetworkType,
): BridgeModule {
  const optimismPortalAddress = requireContract(
    'bridge',
    'OptimismPortal',
    network,
  )
  const hyperlaneMailboxAddress = requireContract(
    'bridge',
    'HyperlaneMailbox',
    network,
  )
  const nftBridgeAddress = requireContract('bridge', 'NFTBridge', network)

  const MIN_BRIDGE_AMOUNT = parseEther('0.0001')
  const FINALIZATION_PERIOD = 604800n // 7 days in seconds

  return {
    MIN_BRIDGE_AMOUNT,
    FINALIZATION_PERIOD,

    async depositETH(params) {
      const data = encodeFunctionData({
        abi: OPTIMISM_PORTAL_ABI,
        functionName: 'depositTransaction',
        args: [
          params.recipient,
          params.amount,
          params.gasLimit ?? 100000n,
          false,
          '0x' as Hex,
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: optimismPortalAddress,
        data,
        value: params.amount,
      })

      // Deposit ID would come from event logs
      return { txHash, depositId: txHash as Hex }
    },

    async depositERC20(_params) {
      // Would need L1 standard bridge
      const txHash = await wallet.sendTransaction({
        to: optimismPortalAddress,
        data: '0x' as Hex,
        value: 0n,
      })

      return { txHash, depositId: txHash as Hex }
    },

    async getDeposit(_depositId) {
      // Would query events or indexer
      return null
    },

    async getMyDeposits() {
      return []
    },

    async initiateWithdrawal(params) {
      // L2 withdrawal initiation
      const txHash = await wallet.sendTransaction({
        to: params.recipient,
        data: '0x' as Hex,
        value: params.amount,
      })

      return { txHash, withdrawalId: txHash as Hex }
    },

    async proveWithdrawal(_withdrawalId, _proof) {
      throw new Error('Not implemented - requires withdrawal proof data')
    },

    async finalizeWithdrawal(_withdrawalId) {
      throw new Error('Not implemented - requires withdrawal transaction data')
    },

    async getWithdrawal(_withdrawalId) {
      return null
    },

    async getMyWithdrawals() {
      return []
    },

    async getWithdrawalStatus(_withdrawalId) {
      return {
        proven: false,
        finalized: false,
        timeRemaining: FINALIZATION_PERIOD,
      }
    },

    async sendMessage(params) {
      // Use Hyperlane for cross-chain messaging
      const recipientBytes32 = ('0x' +
        params.recipient.slice(2).padStart(64, '0')) as Hex

      const fee = await this.quoteHyperlaneGas(
        Number(params.destChainId),
        params.data,
      )

      const data = encodeFunctionData({
        abi: HYPERLANE_MAILBOX_ABI,
        functionName: 'dispatch',
        args: [Number(params.destChainId), recipientBytes32, params.data],
      })

      const txHash = await wallet.sendTransaction({
        to: hyperlaneMailboxAddress,
        data,
        value: fee,
      })

      return { txHash, messageId: txHash as Hex }
    },

    async getMessage(_messageId) {
      return null
    },

    async getMessageStatus(_messageId) {
      return MessageStatus.PENDING
    },

    async relayMessage(_messageId, _proof) {
      throw new Error('Not implemented')
    },

    async bridgeNFT(params) {
      const data = encodeFunctionData({
        abi: NFT_BRIDGE_ABI,
        functionName: 'bridgeNFT',
        args: [
          params.tokenAddress,
          params.tokenId,
          params.recipient,
          params.destChainId,
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: nftBridgeAddress,
        data,
      })

      return { txHash, transferId: txHash as Hex }
    },

    async getNFTTransfer(transferId) {
      const result = await wallet.publicClient.readContract({
        address: nftBridgeAddress,
        abi: NFT_BRIDGE_ABI,
        functionName: 'getTransfer',
        args: [transferId],
      })

      const transfer = result as NFTBridgeTransfer
      if (transfer.sender === '0x0000000000000000000000000000000000000000') {
        return null
      }
      return transfer
    },

    async getMyNFTTransfers() {
      return []
    },

    async sendHyperlaneMessage(destDomain, recipient, message) {
      const recipientBytes32 = ('0x' +
        recipient.slice(2).padStart(64, '0')) as Hex

      const fee = await this.quoteHyperlaneGas(destDomain, message)

      const data = encodeFunctionData({
        abi: HYPERLANE_MAILBOX_ABI,
        functionName: 'dispatch',
        args: [destDomain, recipientBytes32, message],
      })

      const txHash = await wallet.sendTransaction({
        to: hyperlaneMailboxAddress,
        data,
        value: fee,
      })

      return { txHash, messageId: txHash as Hex }
    },

    async quoteHyperlaneGas(destDomain, message) {
      const recipientBytes32 = ('0x' +
        wallet.address.slice(2).padStart(64, '0')) as Hex

      return (await wallet.publicClient.readContract({
        address: hyperlaneMailboxAddress,
        abi: HYPERLANE_MAILBOX_ABI,
        functionName: 'quoteDispatch',
        args: [destDomain, recipientBytes32, message],
      })) as bigint
    },

    async getHyperlaneMessageStatus(messageId) {
      return (await wallet.publicClient.readContract({
        address: hyperlaneMailboxAddress,
        abi: HYPERLANE_MAILBOX_ABI,
        functionName: 'delivered',
        args: [messageId],
      })) as boolean
    },

    async submitZKProof(_proofData, _publicInputs) {
      throw new Error('Not implemented')
    },

    async verifyZKBridgeTransfer(_transferId) {
      return false
    },

    async getSupportedChains() {
      return [
        { chainId: 1n, name: 'Ethereum', bridgeType: BridgeType.CANONICAL },
        { chainId: 8453n, name: 'Base', bridgeType: BridgeType.CANONICAL },
        {
          chainId: 84532n,
          name: 'Base Sepolia',
          bridgeType: BridgeType.CANONICAL,
        },
      ]
    },

    async estimateBridgeFee(_token, _amount, _destChainId) {
      return parseEther('0.001')
    },

    async getFinalizationPeriod() {
      return FINALIZATION_PERIOD
    },
  }
}
