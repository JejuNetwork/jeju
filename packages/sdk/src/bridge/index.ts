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
import {
  type Address,
  encodeFunctionData,
  type Hex,
  keccak256,
  parseAbiItem,
  parseEther,
  toBytes,
} from 'viem'
import { requireContract, safeGetContract } from '../config'
import { parseIdFromLogs } from '../shared/api'
import type { BaseWallet } from '../wallet'

// Event signatures for querying logs
const DEPOSIT_EVENT = parseAbiItem(
  'event TransactionDeposited(address indexed from, address indexed to, uint256 indexed version, bytes opaqueData)',
)
const ERC20_DEPOSIT_EVENT = parseAbiItem(
  'event ERC20DepositInitiated(address indexed l1Token, address indexed l2Token, address indexed from, address to, uint256 amount, bytes extraData)',
)
const MESSAGE_PASSED_EVENT = parseAbiItem(
  'event MessagePassed(uint256 indexed nonce, address indexed sender, address indexed target, uint256 value, uint256 gasLimit, bytes data, bytes32 withdrawalHash)',
)
const NFT_BRIDGE_EVENT = parseAbiItem(
  'event NFTBridgeInitiated(bytes32 indexed transferId, address tokenAddress, uint256 tokenId, address sender, address recipient, uint256 destChainId)',
)

// ═══════════════════════════════════════════════════════════════════════════
//                         TYPE GUARDS & HELPERS
// ═══════════════════════════════════════════════════════════════════════════

type DepositEventArgs = {
  from?: Address
  to?: Address
}

type ERC20DepositEventArgs = {
  from?: Address
  to?: Address
  l1Token?: Address
  amount?: bigint
}

type MessagePassedEventArgs = {
  withdrawalHash?: Hex
  nonce?: bigint
  sender?: Address
  target?: Address
  value?: bigint
  gasLimit?: bigint
  data?: Hex
}

function hasDepositArgs(
  args: DepositEventArgs,
): args is { from: Address; to: Address } {
  return args.from !== undefined && args.to !== undefined
}

function hasERC20DepositArgs(args: ERC20DepositEventArgs): args is {
  from: Address
  to: Address
  l1Token: Address
  amount: bigint
} {
  return (
    args.from !== undefined &&
    args.to !== undefined &&
    args.l1Token !== undefined &&
    args.amount !== undefined
  )
}

function hasMessagePassedArgs(args: MessagePassedEventArgs): args is {
  withdrawalHash: Hex
  nonce: bigint
  sender: Address
  target: Address
  value: bigint
  gasLimit: bigint
  data: Hex
} {
  return (
    args.withdrawalHash !== undefined &&
    args.nonce !== undefined &&
    args.sender !== undefined &&
    args.target !== undefined &&
    args.value !== undefined &&
    args.gasLimit !== undefined &&
    args.data !== undefined
  )
}

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

export interface DepositERC20Params {
  l1Token: Address
  l2Token: Address
  amount: bigint
  recipient: Address
  gasLimit?: number
}

export interface WithdrawParams {
  token: Address
  amount: bigint
  recipient: Address
  gasLimit?: bigint
}

export interface WithdrawalProof {
  l2OutputIndex: bigint
  outputRootProof: {
    version: Hex
    stateRoot: Hex
    messagePasserStorageRoot: Hex
    latestBlockhash: Hex
  }
  withdrawalProof: Hex[]
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

export interface OutputRootProof {
  version: Hex
  stateRoot: Hex
  messagePasserStorageRoot: Hex
  latestBlockhash: Hex
}

export interface WithdrawalProof {
  l2OutputIndex: bigint
  outputRootProof: OutputRootProof
  withdrawalProof: Hex[]
}

export interface BridgeModule {
  // Token Bridging (L1 -> L2)
  depositETH(
    params: Omit<DepositParams, 'token'>,
  ): Promise<{ txHash: Hex; depositId: Hex }>
  depositERC20(
    params: DepositERC20Params,
  ): Promise<{ txHash: Hex; depositId: Hex }>
  getDeposit(depositId: Hex): Promise<BridgeDeposit | null>
  getMyDeposits(): Promise<BridgeDeposit[]>

  // Token Bridging (L2 -> L1)
  initiateWithdrawal(
    params: WithdrawParams,
  ): Promise<{ txHash: Hex; withdrawalId: Hex }>
  proveWithdrawal(withdrawalId: Hex, proof: WithdrawalProof): Promise<Hex>
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
  submitZKProof(
    proofData: Hex,
    publicInputs: Hex[],
  ): Promise<{ txHash: Hex; proofId: Hex }>
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
        name: '_tx',
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
        name: '_outputRootProof',
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
        name: '_tx',
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
  {
    name: 'provenWithdrawals',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_withdrawalHash', type: 'bytes32' }],
    outputs: [
      { name: 'outputRoot', type: 'bytes32' },
      { name: 'timestamp', type: 'uint128' },
      { name: 'l2OutputIndex', type: 'uint128' },
    ],
  },
  {
    name: 'finalizedWithdrawals',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_withdrawalHash', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'TransactionDeposited',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'version', type: 'uint256', indexed: true },
      { name: 'opaqueData', type: 'bytes', indexed: false },
    ],
    anonymous: false,
  },
] as const

const L1_STANDARD_BRIDGE_ABI = [
  {
    name: 'depositERC20',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_l1Token', type: 'address' },
      { name: '_l2Token', type: 'address' },
      { name: '_amount', type: 'uint256' },
      { name: '_minGasLimit', type: 'uint32' },
      { name: '_extraData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'depositERC20To',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_l1Token', type: 'address' },
      { name: '_l2Token', type: 'address' },
      { name: '_to', type: 'address' },
      { name: '_amount', type: 'uint256' },
      { name: '_minGasLimit', type: 'uint32' },
      { name: '_extraData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'ERC20DepositInitiated',
    inputs: [
      { name: 'l1Token', type: 'address', indexed: true },
      { name: 'l2Token', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'extraData', type: 'bytes', indexed: false },
    ],
    anonymous: false,
  },
] as const

const L2_TO_L1_MESSAGE_PASSER_ABI = [
  {
    name: 'initiateWithdrawal',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_target', type: 'address' },
      { name: '_gasLimit', type: 'uint256' },
      { name: '_data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'MessagePassed',
    inputs: [
      { name: 'nonce', type: 'uint256', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'target', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
      { name: 'gasLimit', type: 'uint256', indexed: false },
      { name: 'data', type: 'bytes', indexed: false },
      { name: 'withdrawalHash', type: 'bytes32', indexed: false },
    ],
    anonymous: false,
  },
] as const

const ZK_BRIDGE_VERIFIER_ABI = [
  {
    name: 'submitProof',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_proofData', type: 'bytes' },
      { name: '_publicInputs', type: 'bytes32[]' },
    ],
    outputs: [{ type: 'bytes32', name: 'proofId' }],
  },
  {
    name: 'verifyTransfer',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_transferId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'ProofSubmitted',
    inputs: [
      { name: 'proofId', type: 'bytes32', indexed: true },
      { name: 'submitter', type: 'address', indexed: true },
      { name: 'publicInputsHash', type: 'bytes32', indexed: false },
    ],
    anonymous: false,
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
  wallet: BaseWallet,
  network: NetworkType,
): BridgeModule {
  const optimismPortalAddress = requireContract(
    'bridge',
    'OptimismPortal',
    network,
  )
  const l1StandardBridgeAddress = requireContract(
    'bridge',
    'L1StandardBridge',
    network,
  )
  const l2ToL1MessagePasserAddress = safeGetContract(
    'bridge',
    'L2ToL1MessagePasser',
    network,
  )
  const hyperlaneMailboxAddress = requireContract(
    'bridge',
    'HyperlaneMailbox',
    network,
  )
  const nftBridgeAddress = requireContract('bridge', 'NFTBridge', network)
  const zkBridgeVerifierAddress = safeGetContract(
    'bridge',
    'ZKBridgeVerifier',
    network,
  )

  const MIN_BRIDGE_AMOUNT = parseEther('0.0001')
  const FINALIZATION_PERIOD = 604800n // 7 days in seconds

  // Storage for withdrawal transaction data (would use indexer in production)
  const withdrawalDataCache = new Map<
    Hex,
    {
      nonce: bigint
      sender: Address
      target: Address
      value: bigint
      gasLimit: bigint
      data: Hex
    }
  >()

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

      // Parse depositId from TransactionDeposited event
      const depositId = await parseIdFromLogs(
        wallet.publicClient,
        txHash,
        'TransactionDeposited(address,address,uint256,bytes)',
        'depositId',
      )

      return { txHash, depositId }
    },

    async depositERC20(params) {
      const data = encodeFunctionData({
        abi: L1_STANDARD_BRIDGE_ABI,
        functionName: 'depositERC20To',
        args: [
          params.l1Token,
          params.l2Token,
          params.recipient,
          params.amount,
          Number(params.gasLimit ?? 200000n),
          '0x' as Hex,
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: l1StandardBridgeAddress,
        data,
      })

      // Parse from ERC20DepositInitiated event - use txHash as ID since event doesn't have explicit ID
      return { txHash, depositId: txHash as Hex }
    },

    async getDeposit(depositId) {
      // Query TransactionDeposited events for ETH deposits
      const depositLogs = await wallet.publicClient.getLogs({
        address: optimismPortalAddress,
        event: DEPOSIT_EVENT,
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      // Find matching deposit by transaction hash (depositId is the txHash for ETH deposits)
      for (const log of depositLogs) {
        if (log.transactionHash !== depositId) continue
        if (!hasDepositArgs(log.args)) continue

        const block = await wallet.publicClient.getBlock({
          blockHash: log.blockHash,
        })

        const result: BridgeDeposit = {
          depositId,
          sender: log.args.from,
          recipient: log.args.to,
          token: '0x0000000000000000000000000000000000000000' as Address, // ETH
          amount: 0n, // Would need to decode opaqueData
          sourceChainId: BigInt(await wallet.publicClient.getChainId()),
          destChainId: 0n, // L2 chain ID
          timestamp: block.timestamp,
          status: MessageStatus.FINALIZED, // ETH deposits are instant on L2
        }
        return result
      }

      // Also check ERC20 deposits on L1StandardBridge
      const erc20Logs = await wallet.publicClient.getLogs({
        address: l1StandardBridgeAddress,
        event: ERC20_DEPOSIT_EVENT,
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      for (const log of erc20Logs) {
        if (log.transactionHash !== depositId) continue
        if (!hasERC20DepositArgs(log.args)) continue

        const block = await wallet.publicClient.getBlock({
          blockHash: log.blockHash,
        })

        const result: BridgeDeposit = {
          depositId,
          sender: log.args.from,
          recipient: log.args.to,
          token: log.args.l1Token,
          amount: log.args.amount,
          sourceChainId: BigInt(await wallet.publicClient.getChainId()),
          destChainId: 0n, // L2 chain ID
          timestamp: block.timestamp,
          status: MessageStatus.FINALIZED,
        }
        return result
      }

      return null
    },

    async getMyDeposits() {
      const deposits: BridgeDeposit[] = []
      const chainId = BigInt(await wallet.publicClient.getChainId())

      // Query ETH deposits
      const ethLogs = await wallet.publicClient.getLogs({
        address: optimismPortalAddress,
        event: DEPOSIT_EVENT,
        args: { from: wallet.address },
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      for (const log of ethLogs) {
        if (!hasDepositArgs(log.args)) continue

        const block = await wallet.publicClient.getBlock({
          blockHash: log.blockHash,
        })

        deposits.push({
          depositId: log.transactionHash as Hex,
          sender: log.args.from,
          recipient: log.args.to,
          token: '0x0000000000000000000000000000000000000000' as Address,
          amount: 0n, // Would decode from opaqueData
          sourceChainId: chainId,
          destChainId: 0n,
          timestamp: block.timestamp,
          status: MessageStatus.FINALIZED,
        })
      }

      // Query ERC20 deposits
      const erc20Logs = await wallet.publicClient.getLogs({
        address: l1StandardBridgeAddress,
        event: ERC20_DEPOSIT_EVENT,
        args: { from: wallet.address },
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      for (const log of erc20Logs) {
        if (!hasERC20DepositArgs(log.args)) continue

        const block = await wallet.publicClient.getBlock({
          blockHash: log.blockHash,
        })

        deposits.push({
          depositId: log.transactionHash as Hex,
          sender: log.args.from,
          recipient: log.args.to,
          token: log.args.l1Token,
          amount: log.args.amount,
          sourceChainId: chainId,
          destChainId: 0n,
          timestamp: block.timestamp,
          status: MessageStatus.FINALIZED,
        })
      }

      // Sort by timestamp descending
      return deposits.sort((a, b) => Number(b.timestamp - a.timestamp))
    },

    async initiateWithdrawal(params) {
      if (!l2ToL1MessagePasserAddress) {
        throw new Error('L2ToL1MessagePasser not deployed on this network')
      }

      const data = encodeFunctionData({
        abi: L2_TO_L1_MESSAGE_PASSER_ABI,
        functionName: 'initiateWithdrawal',
        args: [params.recipient, 100000n, '0x' as Hex],
      })

      const txHash = await wallet.sendTransaction({
        to: l2ToL1MessagePasserAddress,
        data,
        value: params.amount,
      })

      // Parse withdrawalHash from MessagePassed event
      const withdrawalId = await parseIdFromLogs(
        wallet.publicClient,
        txHash,
        'MessagePassed(uint256,address,address,uint256,uint256,bytes,bytes32)',
        'withdrawalHash',
      )

      return { txHash, withdrawalId }
    },

    async proveWithdrawal(withdrawalId, proof) {
      const withdrawalData = withdrawalDataCache.get(withdrawalId)
      if (!withdrawalData) {
        throw new Error(
          `Withdrawal data not found for ${withdrawalId}. Use getWithdrawal first.`,
        )
      }

      const data = encodeFunctionData({
        abi: OPTIMISM_PORTAL_ABI,
        functionName: 'proveWithdrawalTransaction',
        args: [
          {
            nonce: withdrawalData.nonce,
            sender: withdrawalData.sender,
            target: withdrawalData.target,
            value: withdrawalData.value,
            gasLimit: withdrawalData.gasLimit,
            data: withdrawalData.data,
          },
          proof.l2OutputIndex,
          {
            version: proof.outputRootProof.version,
            stateRoot: proof.outputRootProof.stateRoot,
            messagePasserStorageRoot:
              proof.outputRootProof.messagePasserStorageRoot,
            latestBlockhash: proof.outputRootProof.latestBlockhash,
          },
          proof.withdrawalProof,
        ],
      })

      return wallet.sendTransaction({
        to: optimismPortalAddress,
        data,
      })
    },

    async finalizeWithdrawal(withdrawalId) {
      const withdrawalData = withdrawalDataCache.get(withdrawalId)
      if (!withdrawalData) {
        throw new Error(
          `Withdrawal data not found for ${withdrawalId}. Use getWithdrawal first.`,
        )
      }

      const data = encodeFunctionData({
        abi: OPTIMISM_PORTAL_ABI,
        functionName: 'finalizeWithdrawalTransaction',
        args: [
          {
            nonce: withdrawalData.nonce,
            sender: withdrawalData.sender,
            target: withdrawalData.target,
            value: withdrawalData.value,
            gasLimit: withdrawalData.gasLimit,
            data: withdrawalData.data,
          },
        ],
      })

      return wallet.sendTransaction({
        to: optimismPortalAddress,
        data,
      })
    },

    async getWithdrawal(withdrawalId) {
      if (!l2ToL1MessagePasserAddress) {
        return null
      }

      // Query MessagePassed events
      const logs = await wallet.publicClient.getLogs({
        address: l2ToL1MessagePasserAddress,
        event: MESSAGE_PASSED_EVENT,
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      for (const log of logs) {
        if (!hasMessagePassedArgs(log.args)) continue
        if (log.args.withdrawalHash !== withdrawalId) continue

        const block = await wallet.publicClient.getBlock({
          blockHash: log.blockHash,
        })

        // Cache the withdrawal data for prove/finalize operations
        withdrawalDataCache.set(withdrawalId, {
          nonce: log.args.nonce,
          sender: log.args.sender,
          target: log.args.target,
          value: log.args.value,
          gasLimit: log.args.gasLimit,
          data: log.args.data,
        })

        // Get withdrawal status
        const status = await this.getWithdrawalStatus(withdrawalId)

        return {
          withdrawalId,
          sender: log.args.sender,
          recipient: log.args.target,
          token: '0x0000000000000000000000000000000000000000' as Address,
          amount: log.args.value,
          sourceChainId: BigInt(await wallet.publicClient.getChainId()),
          destChainId: 1n, // L1
          timestamp: block.timestamp,
          proofSubmitted: status.proven,
          finalized: status.finalized,
        }
      }

      return null
    },

    async getMyWithdrawals() {
      if (!l2ToL1MessagePasserAddress) {
        return []
      }

      const withdrawals: BridgeWithdrawal[] = []
      const chainId = BigInt(await wallet.publicClient.getChainId())

      // Query MessagePassed events for this user
      const logs = await wallet.publicClient.getLogs({
        address: l2ToL1MessagePasserAddress,
        event: MESSAGE_PASSED_EVENT,
        args: { sender: wallet.address },
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      for (const log of logs) {
        if (!hasMessagePassedArgs(log.args)) continue

        const block = await wallet.publicClient.getBlock({
          blockHash: log.blockHash,
        })

        // Cache the withdrawal data
        withdrawalDataCache.set(log.args.withdrawalHash, {
          nonce: log.args.nonce,
          sender: log.args.sender,
          target: log.args.target,
          value: log.args.value,
          gasLimit: log.args.gasLimit,
          data: log.args.data,
        })

        // Get withdrawal status
        const status = await this.getWithdrawalStatus(log.args.withdrawalHash)

        withdrawals.push({
          withdrawalId: log.args.withdrawalHash,
          sender: log.args.sender,
          recipient: log.args.target,
          token: '0x0000000000000000000000000000000000000000' as Address,
          amount: log.args.value,
          sourceChainId: chainId,
          destChainId: 1n,
          timestamp: block.timestamp,
          proofSubmitted: status.proven,
          finalized: status.finalized,
        })
      }

      // Sort by timestamp descending
      return withdrawals.sort((a, b) => Number(b.timestamp - a.timestamp))
    },

    async getWithdrawalStatus(withdrawalId) {
      // Check if proven
      const provenData = await wallet.publicClient.readContract({
        address: optimismPortalAddress,
        abi: OPTIMISM_PORTAL_ABI,
        functionName: 'provenWithdrawals',
        args: [withdrawalId],
      })

      const proven = provenData[0] !== `0x${'0'.repeat(64)}`

      // Check if finalized
      const finalized = await wallet.publicClient.readContract({
        address: optimismPortalAddress,
        abi: OPTIMISM_PORTAL_ABI,
        functionName: 'finalizedWithdrawals',
        args: [withdrawalId],
      })

      // Calculate time remaining if proven but not finalized
      let timeRemaining = 0n
      if (proven && !finalized) {
        const timestamp = provenData[1]
        const currentTime = BigInt(Math.floor(Date.now() / 1000))
        const endTime = timestamp + FINALIZATION_PERIOD
        if (endTime > currentTime) {
          timeRemaining = endTime - currentTime
        }
      }

      return { proven, finalized, timeRemaining }
    },

    async sendMessage(params) {
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

      // Parse messageId from Dispatch event
      const messageId = await parseIdFromLogs(
        wallet.publicClient,
        txHash,
        'Dispatch(address,uint32,bytes32,bytes)',
        'messageId',
      )

      return { txHash, messageId }
    },

    async getMessage(messageId) {
      // Query Dispatch events from Hyperlane mailbox
      const dispatchEvent = parseAbiItem(
        'event Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message)',
      )

      const logs = await wallet.publicClient.getLogs({
        address: hyperlaneMailboxAddress,
        event: dispatchEvent,
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      // Find the message with matching ID (messageId is typically the log topic)
      for (const log of logs) {
        // Compute message ID from event data
        const computedId = keccak256(
          toBytes(
            `${log.args.sender}${log.args.destination}${log.args.recipient}${log.args.message}`,
          ),
        )

        if (
          computedId === messageId ||
          log.transactionHash === (messageId as Hex)
        ) {
          const sender = log.args.sender
          const recipient = log.args.recipient
          const destination = log.args.destination
          const message = log.args.message
          if (!sender || !recipient || destination === undefined || !message)
            continue

          const block = await wallet.publicClient.getBlock({
            blockHash: log.blockHash,
          })

          // Check if delivered
          const delivered = await wallet.publicClient.readContract({
            address: hyperlaneMailboxAddress,
            abi: HYPERLANE_MAILBOX_ABI,
            functionName: 'delivered',
            args: [messageId],
          })

          // Convert bytes32 recipient back to address
          const recipientAddress = `0x${recipient.slice(26)}` as Address

          return {
            messageId,
            sender,
            recipient: recipientAddress,
            sourceChainId: BigInt(await wallet.publicClient.getChainId()),
            destChainId: BigInt(destination),
            data: message as Hex,
            gasLimit: 0n, // Hyperlane handles gas
            status: delivered ? MessageStatus.FINALIZED : MessageStatus.PENDING,
            timestamp: block.timestamp,
          }
        }
      }

      return null
    },

    async getMessageStatus(messageId) {
      const delivered = await wallet.publicClient.readContract({
        address: hyperlaneMailboxAddress,
        abi: HYPERLANE_MAILBOX_ABI,
        functionName: 'delivered',
        args: [messageId],
      })

      if (delivered) {
        return MessageStatus.FINALIZED
      }
      return MessageStatus.PENDING
    },

    async relayMessage(_messageId, _proof) {
      // Relay is typically handled by Hyperlane relayers automatically
      throw new Error(
        'Manual relay not supported - Hyperlane relayers handle message delivery',
      )
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

      // Parse transferId from NFTBridgeInitiated event
      const transferId = await parseIdFromLogs(
        wallet.publicClient,
        txHash,
        'NFTBridgeInitiated(bytes32,address,uint256,address,address,uint256)',
        'transferId',
      )

      return { txHash, transferId }
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
      const transfers: NFTBridgeTransfer[] = []

      // Query NFTBridgeInitiated events for this user
      const logs = await wallet.publicClient.getLogs({
        address: nftBridgeAddress,
        event: NFT_BRIDGE_EVENT,
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      for (const log of logs) {
        const sender = log.args.sender
        const transferId = log.args.transferId
        if (!sender || !transferId) continue

        // Filter for transfers where user is sender
        if (sender.toLowerCase() !== wallet.address.toLowerCase()) {
          continue
        }

        // Get the full transfer data from contract
        const result = await wallet.publicClient.readContract({
          address: nftBridgeAddress,
          abi: NFT_BRIDGE_ABI,
          functionName: 'getTransfer',
          args: [transferId],
        })

        const transfer = result as {
          transferId: Hex
          tokenAddress: Address
          tokenId: bigint
          sender: Address
          recipient: Address
          sourceChainId: bigint
          destChainId: bigint
          status: number
        }

        if (transfer.sender !== '0x0000000000000000000000000000000000000000') {
          transfers.push({
            transferId: transfer.transferId,
            tokenAddress: transfer.tokenAddress,
            tokenId: transfer.tokenId,
            sender: transfer.sender,
            recipient: transfer.recipient,
            sourceChainId: transfer.sourceChainId,
            destChainId: transfer.destChainId,
            status: transfer.status as MessageStatus,
          })
        }
      }

      return transfers
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

      // Parse messageId from Dispatch event
      const messageId = await parseIdFromLogs(
        wallet.publicClient,
        txHash,
        'Dispatch(address,uint32,bytes32,bytes)',
        'messageId',
      )

      return { txHash, messageId }
    },

    async quoteHyperlaneGas(destDomain, message) {
      const recipientBytes32 = ('0x' +
        wallet.address.slice(2).padStart(64, '0')) as Hex

      return wallet.publicClient.readContract({
        address: hyperlaneMailboxAddress,
        abi: HYPERLANE_MAILBOX_ABI,
        functionName: 'quoteDispatch',
        args: [destDomain, recipientBytes32, message],
      })
    },

    async getHyperlaneMessageStatus(messageId) {
      return wallet.publicClient.readContract({
        address: hyperlaneMailboxAddress,
        abi: HYPERLANE_MAILBOX_ABI,
        functionName: 'delivered',
        args: [messageId],
      })
    },

    async submitZKProof(proofData, publicInputs) {
      if (!zkBridgeVerifierAddress) {
        throw new Error('ZKBridgeVerifier not deployed on this network')
      }

      const data = encodeFunctionData({
        abi: ZK_BRIDGE_VERIFIER_ABI,
        functionName: 'submitProof',
        args: [proofData, publicInputs],
      })

      const txHash = await wallet.sendTransaction({
        to: zkBridgeVerifierAddress,
        data,
      })

      // Parse proofId from ProofSubmitted event
      const proofId = await parseIdFromLogs(
        wallet.publicClient,
        txHash,
        'ProofSubmitted(bytes32,address,bytes32)',
        'proofId',
      )

      return { txHash, proofId }
    },

    async verifyZKBridgeTransfer(transferId) {
      if (!zkBridgeVerifierAddress) {
        throw new Error('ZKBridgeVerifier not deployed on this network')
      }

      return wallet.publicClient.readContract({
        address: zkBridgeVerifierAddress,
        abi: ZK_BRIDGE_VERIFIER_ABI,
        functionName: 'verifyTransfer',
        args: [transferId],
      })
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
