/**
 * Autocrat Safe Service
 *
 * Provides Gnosis Safe integration for DAO treasury and governance operations.
 * Uses the Safe Transaction Service API and on-chain Safe contracts.
 *
 * Key features:
 * - Propose, sign, and execute Safe transactions
 * - Batch multiple operations via MultiSend
 * - Treasury-specific operations (withdraw, swap, recurring payments)
 * - Governance operations (parameter changes, upgrades)
 * - Integration with Autocrat proposal system
 */

import type { Address, Hex, PublicClient } from 'viem'
import { createPublicClient, encodeFunctionData, http, pad, toHex } from 'viem'
import { z } from 'zod'
import {
  type BatchTransactionProposal,
  type DAOSafeInfo,
  type GovernanceProposal,
  type MultiSendTransaction,
  type SafeConfirmation,
  SafeError,
  SafeErrorCode,
  type SafeInfo,
  SafeOperation,
  type SafeProposalResult,
  type SafeTransaction,
  type SafeTransactionData,
  type SafeTransactionProposal,
  type SafeTransactionStatus,
  type TreasuryWithdrawRequest,
} from '../lib/safe-types'
import { config } from './config'

// ============================================================================
// Constants
// ============================================================================

const SAFE_API_URLS: Record<number, string> = {
  1: 'https://safe-transaction-mainnet.safe.global',
  10: 'https://safe-transaction-optimism.safe.global',
  8453: 'https://safe-transaction-base.safe.global',
  42161: 'https://safe-transaction-arbitrum.safe.global',
  84532: 'https://safe-transaction-base-sepolia.safe.global',
  11155111: 'https://safe-transaction-sepolia.safe.global',
}

const MULTI_SEND_CALL_ONLY_ADDRESS =
  '0x9641d764fc13c8B624c04430C7356C1C7C8102e2' as const
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

// ============================================================================
// ABIs
// ============================================================================

const SAFE_ABI = [
  {
    name: 'getOwners',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getThreshold',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'nonce',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'VERSION',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'getModulesPaginated',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'address[]' }, { type: 'address' }],
  },
  {
    name: 'getGuard',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'getTransactionHash',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'nonce', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'execTransaction',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'isOwner',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'domainSeparator',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
  },
] as const

const MULTI_SEND_ABI = [
  {
    name: 'multiSend',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'transactions', type: 'bytes' }],
    outputs: [],
  },
] as const

const TREASURY_ABI = [
  {
    name: 'withdrawETH',
    type: 'function',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'withdrawToken',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'directorSendTokens',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'createRecurringPayment',
    type: 'function',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interval', type: 'uint256' },
      { name: 'maxPayments', type: 'uint256' },
      { name: 'description', type: 'string' },
    ],
    outputs: [{ name: 'paymentId', type: 'bytes32' }],
  },
] as const

const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

// ============================================================================
// Validation Schemas
// ============================================================================

const SafeTransactionResponseSchema = z.object({
  safe: z.string(),
  to: z.string(),
  value: z.string(),
  data: z.string().nullable(),
  operation: z.union([z.literal(0), z.literal(1)]),
  safeTxGas: z.string(),
  baseGas: z.string(),
  gasPrice: z.string(),
  gasToken: z.string(),
  refundReceiver: z.string(),
  nonce: z.number(),
  confirmations: z.array(
    z.object({
      owner: z.string(),
      signature: z.string(),
      submissionDate: z.string(),
      signatureType: z.string().optional(),
    }),
  ),
  confirmationsRequired: z.number(),
  isExecuted: z.boolean(),
  safeTxHash: z.string(),
  proposer: z.string().optional(),
  submissionDate: z.string().optional(),
  executionDate: z.string().nullable().optional(),
  executor: z.string().nullable().optional(),
  transactionHash: z.string().nullable().optional(),
})

const SafeTransactionsResponseSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(SafeTransactionResponseSchema),
})

// ============================================================================
// Safe Service Class
// ============================================================================

export class AutocratSafeService {
  private publicClient: PublicClient
  private chainId: number

  constructor(rpcUrl?: string, chainId?: number) {
    this.chainId = chainId ?? 8453 // Default to Base
    this.publicClient = createPublicClient({
      transport: http(rpcUrl ?? config.rpcUrl),
    })
  }

  // ==========================================================================
  // Safe Info
  // ==========================================================================

  async getSafeInfo(safeAddress: Address): Promise<SafeInfo> {
    const [owners, threshold, nonce, version, modulesResult, guardAddress] =
      await Promise.all([
        this.publicClient.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'getOwners',
        }),
        this.publicClient.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'getThreshold',
        }),
        this.publicClient.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'nonce',
        }),
        this.publicClient.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'VERSION',
        }),
        this.publicClient.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'getModulesPaginated',
          args: ['0x0000000000000000000000000000000000000001' as Address, 10n],
        }),
        this.publicClient
          .readContract({
            address: safeAddress,
            abi: SAFE_ABI,
            functionName: 'getGuard',
          })
          .catch(() => ZERO_ADDRESS),
      ])

    return {
      address: safeAddress,
      chainId: this.chainId,
      owners: [...(owners as readonly Address[])],
      threshold: Number(threshold),
      nonce: Number(nonce),
      version: version as string,
      modules: [
        ...(modulesResult as readonly [readonly Address[], Address])[0],
      ],
      guard:
        guardAddress === ZERO_ADDRESS ? undefined : (guardAddress as Address),
    }
  }

  async isSafe(address: Address): Promise<boolean> {
    try {
      await this.getSafeInfo(address)
      return true
    } catch (error) {
      // Only return false for expected "not a safe" errors
      // Log unexpected errors for debugging
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      if (
        errorMessage.includes('execution reverted') ||
        errorMessage.includes('contract does not exist') ||
        errorMessage.includes('could not coalesce')
      ) {
        // Expected error when address is not a Safe
        return false
      }
      // Unexpected error - log and return false
      console.warn(
        `[SafeService] Unexpected error checking if ${address} is Safe:`,
        errorMessage,
      )
      return false
    }
  }

  async isOwner(safeAddress: Address, owner: Address): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: safeAddress,
      abi: SAFE_ABI,
      functionName: 'isOwner',
      args: [owner],
    })
    return result as boolean
  }

  /**
   * Compute the Safe transaction hash for a given transaction
   * This is what signers need to sign
   */
  async computeSafeTxHash(
    safeAddress: Address,
    to: Address,
    value: bigint,
    data: Hex,
    operation: number,
    nonce: number,
  ): Promise<Hex> {
    const safeTxHash = await this.publicClient.readContract({
      address: safeAddress,
      abi: SAFE_ABI,
      functionName: 'getTransactionHash',
      args: [
        to,
        value,
        data,
        operation,
        0n, // safeTxGas
        0n, // baseGas
        0n, // gasPrice
        ZERO_ADDRESS, // gasToken
        ZERO_ADDRESS, // refundReceiver
        BigInt(nonce),
      ],
    })
    return safeTxHash as Hex
  }

  /**
   * Submit a signed transaction proposal to the Safe Transaction Service
   */
  async submitSignedProposal(
    safeAddress: Address,
    to: Address,
    value: bigint,
    data: Hex,
    operation: number,
    nonce: number,
    safeTxHash: Hex,
    sender: Address,
    signature: Hex,
    origin?: string,
  ): Promise<void> {
    const tx: SafeTransaction = {
      to,
      value,
      data,
      operation: operation as 0 | 1,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: ZERO_ADDRESS,
      refundReceiver: ZERO_ADDRESS,
      nonce,
    }

    await this.submitToService(
      safeAddress,
      tx,
      safeTxHash,
      sender,
      signature,
      origin,
    )
  }

  // ==========================================================================
  // Transaction Fetching
  // ==========================================================================

  async getPendingTransactions(
    safeAddress: Address,
  ): Promise<SafeTransactionData[]> {
    const apiUrl = this.getApiUrl()
    const response = await fetch(
      `${apiUrl}/api/v1/safes/${safeAddress}/multisig-transactions/?executed=false&ordering=-nonce`,
    )

    if (!response.ok) {
      throw new SafeError(
        'Failed to fetch pending transactions',
        SafeErrorCode.SERVICE_UNAVAILABLE,
      )
    }

    const data = SafeTransactionsResponseSchema.parse(await response.json())
    return this.mapTransactionResults(data.results)
  }

  async getTransactionHistory(
    safeAddress: Address,
    limit = 20,
  ): Promise<SafeTransactionData[]> {
    const apiUrl = this.getApiUrl()
    const response = await fetch(
      `${apiUrl}/api/v1/safes/${safeAddress}/multisig-transactions/?executed=true&ordering=-executionDate&limit=${limit}`,
    )

    if (!response.ok) {
      throw new SafeError(
        'Failed to fetch transaction history',
        SafeErrorCode.SERVICE_UNAVAILABLE,
      )
    }

    const data = SafeTransactionsResponseSchema.parse(await response.json())
    return this.mapTransactionResults(data.results)
  }

  async getTransaction(safeTxHash: Hex): Promise<SafeTransactionData | null> {
    const apiUrl = this.getApiUrl()
    const response = await fetch(
      `${apiUrl}/api/v1/multisig-transactions/${safeTxHash}/`,
    )

    if (!response.ok) {
      if (response.status === 404) return null
      throw new SafeError(
        'Failed to fetch transaction',
        SafeErrorCode.SERVICE_UNAVAILABLE,
      )
    }

    const data = SafeTransactionResponseSchema.parse(await response.json())
    return this.mapTransactionResult(data)
  }

  async getTransactionStatus(safeTxHash: Hex): Promise<SafeTransactionStatus> {
    const tx = await this.getTransaction(safeTxHash)
    if (!tx) {
      throw new SafeError('Transaction not found', SafeErrorCode.TX_NOT_FOUND)
    }

    const canExecute =
      tx.confirmations.length >= tx.confirmationsRequired && !tx.isExecuted

    let status: SafeTransactionStatus['status']
    if (tx.isExecuted) {
      status = 'executed'
    } else if (canExecute) {
      status = 'ready_to_execute'
    } else if (tx.confirmations.length > 0) {
      status = 'awaiting_confirmations'
    } else {
      status = 'pending'
    }

    return {
      safeTxHash,
      status,
      confirmations: tx.confirmations.length,
      required: tx.confirmationsRequired,
      canExecute,
      executionDate: tx.executionDate
        ? new Date(tx.executionDate).getTime()
        : undefined,
      transactionHash: tx.transactionHash,
    }
  }

  // ==========================================================================
  // Transaction Proposals
  // ==========================================================================

  async proposeTransaction(
    proposal: SafeTransactionProposal,
    signer: { signMessage: (message: Hex) => Promise<Hex>; address: Address },
  ): Promise<SafeProposalResult> {
    const safeInfo = await this.getSafeInfo(proposal.safeAddress)

    // Verify signer is an owner
    if (!safeInfo.owners.includes(signer.address)) {
      throw new SafeError(
        'Signer is not a Safe owner',
        SafeErrorCode.NOT_AN_OWNER,
      )
    }

    // Build transaction
    const safeTx: Omit<SafeTransaction, 'nonce'> = {
      to: proposal.to,
      value: proposal.value,
      data: proposal.data,
      operation: proposal.operation ?? SafeOperation.CALL,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: ZERO_ADDRESS,
      refundReceiver: ZERO_ADDRESS,
    }

    // Get transaction hash
    const safeTxHash = (await this.publicClient.readContract({
      address: proposal.safeAddress,
      abi: SAFE_ABI,
      functionName: 'getTransactionHash',
      args: [
        safeTx.to,
        safeTx.value,
        safeTx.data,
        safeTx.operation,
        safeTx.safeTxGas,
        safeTx.baseGas,
        safeTx.gasPrice,
        safeTx.gasToken,
        safeTx.refundReceiver,
        BigInt(safeInfo.nonce),
      ],
    })) as Hex

    // Sign the hash
    const signature = await signer.signMessage(safeTxHash)

    // Submit to Safe Transaction Service
    await this.submitToService(
      proposal.safeAddress,
      { ...safeTx, nonce: safeInfo.nonce },
      safeTxHash,
      signer.address,
      signature,
      proposal.title,
    )

    return {
      safeTxHash,
      nonce: safeInfo.nonce,
      proposedAt: Date.now(),
    }
  }

  async confirmTransaction(
    safeTxHash: Hex,
    signer: { signMessage: (message: Hex) => Promise<Hex>; address: Address },
  ): Promise<void> {
    const tx = await this.getTransaction(safeTxHash)
    if (!tx) {
      throw new SafeError('Transaction not found', SafeErrorCode.TX_NOT_FOUND)
    }

    // Check if already signed
    const alreadySigned = tx.confirmations.some(
      (c) => c.owner.toLowerCase() === signer.address.toLowerCase(),
    )
    if (alreadySigned) {
      throw new SafeError(
        'Already signed this transaction',
        SafeErrorCode.ALREADY_SIGNED,
      )
    }

    // Verify signer is an owner
    const isOwner = await this.isOwner(tx.safe, signer.address)
    if (!isOwner) {
      throw new SafeError(
        'Signer is not a Safe owner',
        SafeErrorCode.NOT_AN_OWNER,
      )
    }

    // Sign and submit
    const signature = await signer.signMessage(safeTxHash)
    const apiUrl = this.getApiUrl()

    const response = await fetch(
      `${apiUrl}/api/v1/multisig-transactions/${safeTxHash}/confirmations/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature }),
      },
    )

    if (!response.ok) {
      throw new SafeError(
        'Failed to confirm transaction',
        SafeErrorCode.SERVICE_UNAVAILABLE,
      )
    }
  }

  // ==========================================================================
  // Transaction Execution
  // ==========================================================================

  async buildExecuteTransaction(
    safeTxHash: Hex,
  ): Promise<{ to: Address; data: Hex; value: bigint }> {
    const tx = await this.getTransaction(safeTxHash)
    if (!tx) {
      throw new SafeError('Transaction not found', SafeErrorCode.TX_NOT_FOUND)
    }

    if (tx.confirmations.length < tx.confirmationsRequired) {
      throw new SafeError(
        `Need ${tx.confirmationsRequired - tx.confirmations.length} more signatures`,
        SafeErrorCode.THRESHOLD_NOT_MET,
      )
    }

    const signatures = this.buildSignatures(tx.confirmations)

    const data = encodeFunctionData({
      abi: SAFE_ABI,
      functionName: 'execTransaction',
      args: [
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatures,
      ],
    })

    return {
      to: tx.safe,
      data,
      value: 0n,
    }
  }

  // ==========================================================================
  // Batch Transactions (MultiSend)
  // ==========================================================================

  async proposeBatchTransaction(
    batch: BatchTransactionProposal,
    signer: { signMessage: (message: Hex) => Promise<Hex>; address: Address },
  ): Promise<SafeProposalResult> {
    if (batch.transactions.length === 0) {
      throw new Error('Batch must contain at least one transaction')
    }

    // Encode MultiSend data
    const multiSendData = this.encodeMultiSend(batch.transactions)

    // Create proposal
    return this.proposeTransaction(
      {
        safeAddress: batch.safeAddress,
        to: MULTI_SEND_CALL_ONLY_ADDRESS,
        value: 0n,
        data: multiSendData,
        operation: SafeOperation.DELEGATE_CALL,
        title: batch.title,
        description: batch.description,
        category: 'batch_operation',
        proposer: batch.proposer,
        daoId: batch.daoId,
      },
      signer,
    )
  }

  private encodeMultiSend(transactions: MultiSendTransaction[]): Hex {
    // Each transaction is encoded as:
    // operation (1 byte) + to (20 bytes) + value (32 bytes) + dataLength (32 bytes) + data
    let encoded = '0x'

    for (const tx of transactions) {
      const operation = pad(toHex(tx.operation), { size: 1 }).slice(2)
      const to = tx.to.slice(2).toLowerCase()
      const value = pad(toHex(tx.value), { size: 32 }).slice(2)
      const data = tx.data.slice(2)
      const dataLength = pad(toHex(data.length / 2), { size: 32 }).slice(2)

      encoded += operation + to + value + dataLength + data
    }

    return encodeFunctionData({
      abi: MULTI_SEND_ABI,
      functionName: 'multiSend',
      args: [encoded as Hex],
    })
  }

  // ==========================================================================
  // Treasury Operations
  // ==========================================================================

  async proposeTreasuryWithdraw(
    request: TreasuryWithdrawRequest,
    treasury: Address,
    signer: { signMessage: (message: Hex) => Promise<Hex>; address: Address },
  ): Promise<SafeProposalResult> {
    const isEth = request.token === ZERO_ADDRESS

    const data = encodeFunctionData({
      abi: TREASURY_ABI,
      functionName: isEth ? 'withdrawETH' : 'withdrawToken',
      args: isEth
        ? [request.amount, request.recipient]
        : [request.token, request.amount, request.recipient],
    })

    // Get Safe address (treasury itself if it's a Safe, or the treasury's admin Safe)
    const safeAddress = await this.getTreasurySafe(treasury)

    return this.proposeTransaction(
      {
        safeAddress,
        to: treasury,
        value: 0n,
        data,
        title: `Treasury Withdrawal: ${request.reason}`,
        description: `Withdraw ${isEth ? 'ETH' : 'tokens'} to ${request.recipient}. Reason: ${request.reason}`,
        category: 'treasury_withdrawal',
        proposer: request.proposer,
        daoId: request.daoId,
        linkedProposalId: request.linkedProposalId,
      },
      signer,
    )
  }

  async proposeTokenTransfer(
    safeAddress: Address,
    token: Address,
    to: Address,
    amount: bigint,
    reason: string,
    signer: { signMessage: (message: Hex) => Promise<Hex>; address: Address },
  ): Promise<SafeProposalResult> {
    const isEth = token === ZERO_ADDRESS

    let data: Hex
    let value: bigint

    if (isEth) {
      data = '0x'
      value = amount
    } else {
      data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [to, amount],
      })
      value = 0n
    }

    return this.proposeTransaction(
      {
        safeAddress,
        to: isEth ? to : token,
        value,
        data,
        title: `Token Transfer: ${reason}`,
        description: `Transfer ${isEth ? 'ETH' : 'tokens'} to ${to}. Reason: ${reason}`,
        category: 'token_transfer',
        proposer: signer.address,
      },
      signer,
    )
  }

  // ==========================================================================
  // Governance Operations
  // ==========================================================================

  async proposeGovernanceAction(
    proposal: GovernanceProposal,
    safeAddress: Address,
    signer: { signMessage: (message: Hex) => Promise<Hex>; address: Address },
  ): Promise<SafeProposalResult> {
    return this.proposeTransaction(
      {
        safeAddress,
        to: proposal.target,
        value: proposal.value,
        data: proposal.calldata,
        title: `Governance: ${proposal.description.slice(0, 50)}`,
        description: proposal.description,
        category: 'governance_action',
        proposer: proposal.proposer,
        daoId: proposal.daoId,
      },
      signer,
    )
  }

  // ==========================================================================
  // DAO Integration
  // ==========================================================================

  async getDAOSafeInfo(
    daoId: string,
    safeAddress: Address,
    signerMetadata?: Map<
      Address,
      { name: string; isHuman: boolean; agentId?: bigint; role?: string }
    >,
  ): Promise<DAOSafeInfo> {
    const safeInfo = await this.getSafeInfo(safeAddress)
    const pending = await this.getPendingTransactions(safeAddress)

    // Map owners to signers, using provided metadata if available
    const signers = safeInfo.owners.map((owner) => {
      const metadata = signerMetadata?.get(owner.toLowerCase() as Address)
      return {
        address: owner,
        name:
          metadata?.name ?? `Owner ${owner.slice(0, 6)}...${owner.slice(-4)}`,
        isHuman: metadata?.isHuman ?? true, // Default to human if unknown
        agentId: metadata?.agentId,
        role: metadata?.role,
      }
    })

    // Determine role based on Safe's relationship to DAO
    // This would ideally be passed in or looked up from DAO registry
    const role: DAOSafeInfo['role'] = 'treasury' // Default, could be governance/security_board/operator

    return {
      daoId,
      safeAddress,
      chainId: safeInfo.chainId,
      role,
      signers,
      threshold: safeInfo.threshold,
      pendingTransactions: pending.length,
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private getApiUrl(): string {
    const url = SAFE_API_URLS[this.chainId]
    if (!url) {
      throw new SafeError(
        `Safe Transaction Service not available for chain ${this.chainId}`,
        SafeErrorCode.SERVICE_UNAVAILABLE,
      )
    }
    return url
  }

  private async getTreasurySafe(treasury: Address): Promise<Address> {
    // Check if treasury itself is a Safe
    if (await this.isSafe(treasury)) {
      return treasury
    }

    // Try to lookup the owner/admin from the Treasury contract
    // Treasury contracts typically have an owner() or admin() function
    const ownerAbi = [
      {
        name: 'owner',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'address' }],
      },
    ] as const

    try {
      const owner = await this.publicClient.readContract({
        address: treasury,
        abi: ownerAbi,
        functionName: 'owner',
      })

      const ownerAddress = owner as Address
      if (ownerAddress !== ZERO_ADDRESS && (await this.isSafe(ownerAddress))) {
        return ownerAddress
      }
    } catch {
      // owner() doesn't exist, try getRoleAdmin for AccessControl
    }

    // Try AccessControl DEFAULT_ADMIN_ROLE
    const accessControlAbi = [
      {
        name: 'getRoleMember',
        type: 'function',
        stateMutability: 'view',
        inputs: [
          { name: 'role', type: 'bytes32' },
          { name: 'index', type: 'uint256' },
        ],
        outputs: [{ type: 'address' }],
      },
    ] as const

    const DEFAULT_ADMIN_ROLE =
      '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

    try {
      const admin = await this.publicClient.readContract({
        address: treasury,
        abi: accessControlAbi,
        functionName: 'getRoleMember',
        args: [DEFAULT_ADMIN_ROLE, 0n],
      })

      const adminAddress = admin as Address
      if (adminAddress !== ZERO_ADDRESS && (await this.isSafe(adminAddress))) {
        return adminAddress
      }
    } catch {
      // AccessControl not available
    }

    throw new SafeError(
      'Could not find Safe admin for treasury. Treasury must be a Safe or owned by a Safe.',
      SafeErrorCode.NOT_A_SAFE,
    )
  }

  private async submitToService(
    safeAddress: Address,
    tx: SafeTransaction,
    safeTxHash: Hex,
    sender: Address,
    signature: Hex,
    origin?: string,
  ): Promise<void> {
    const apiUrl = this.getApiUrl()

    const response = await fetch(
      `${apiUrl}/api/v1/safes/${safeAddress}/multisig-transactions/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: tx.to,
          value: tx.value.toString(),
          data: tx.data === '0x' ? null : tx.data,
          operation: tx.operation,
          safeTxGas: tx.safeTxGas.toString(),
          baseGas: tx.baseGas.toString(),
          gasPrice: tx.gasPrice.toString(),
          gasToken: tx.gasToken,
          refundReceiver: tx.refundReceiver,
          nonce: tx.nonce,
          contractTransactionHash: safeTxHash,
          sender,
          signature,
          origin,
        }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new SafeError(
        `Failed to submit transaction: ${error}`,
        SafeErrorCode.SERVICE_UNAVAILABLE,
      )
    }
  }

  private buildSignatures(confirmations: SafeConfirmation[]): Hex {
    // Sort by owner address (required by Safe)
    const sorted = [...confirmations].sort((a, b) =>
      a.owner.toLowerCase().localeCompare(b.owner.toLowerCase()),
    )

    let packed = '0x'
    for (const conf of sorted) {
      packed += conf.signature.slice(2)
    }

    return packed as Hex
  }

  private mapTransactionResults(
    results: z.infer<typeof SafeTransactionsResponseSchema>['results'],
  ): SafeTransactionData[] {
    return results.map((tx) => this.mapTransactionResult(tx))
  }

  private mapTransactionResult(
    tx: z.infer<typeof SafeTransactionResponseSchema>,
  ): SafeTransactionData {
    return {
      safe: tx.safe as Address,
      to: tx.to as Address,
      value: BigInt(tx.value),
      data: (tx.data ?? '0x') as Hex,
      operation: tx.operation as 0 | 1,
      safeTxGas: BigInt(tx.safeTxGas),
      baseGas: BigInt(tx.baseGas),
      gasPrice: BigInt(tx.gasPrice),
      gasToken: tx.gasToken as Address,
      refundReceiver: tx.refundReceiver as Address,
      nonce: tx.nonce,
      confirmations: tx.confirmations.map((c) => ({
        owner: c.owner as Address,
        signature: c.signature as Hex,
        submissionDate: c.submissionDate,
        signatureType: (c.signatureType ?? 'EOA') as
          | 'EOA'
          | 'ETH_SIGN'
          | 'CONTRACT_SIGNATURE',
      })),
      confirmationsRequired: tx.confirmationsRequired,
      isExecuted: tx.isExecuted,
      safeTxHash: tx.safeTxHash as Hex,
      proposer: (tx.proposer ??
        tx.confirmations[0]?.owner ??
        ZERO_ADDRESS) as Address,
      submissionDate: tx.submissionDate ?? '',
      executionDate: tx.executionDate ?? undefined,
      executor: tx.executor ? (tx.executor as Address) : undefined,
      transactionHash: tx.transactionHash
        ? (tx.transactionHash as Hex)
        : undefined,
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let safeServiceInstance: AutocratSafeService | null = null

export function getSafeService(): AutocratSafeService {
  if (!safeServiceInstance) {
    safeServiceInstance = new AutocratSafeService(config.rpcUrl)
  }
  return safeServiceInstance
}

export function createSafeService(
  rpcUrl: string,
  chainId?: number,
): AutocratSafeService {
  return new AutocratSafeService(rpcUrl, chainId)
}
