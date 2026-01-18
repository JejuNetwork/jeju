/**
 * Safe API Routes
 *
 * Provides REST endpoints for Gnosis Safe operations including:
 * - Safe info and status
 * - Transaction proposals, confirmations, execution
 * - Treasury operations (withdrawals, transfers)
 * - Batch transaction support
 */

import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import {
  type GovernanceProposal,
  SafeOperation,
  type SafeTransactionProposal,
  type TreasuryWithdrawRequest,
} from '../../lib/safe-types'
import { getSafeService } from '../safe-service'
import { auditLog } from '../security'

// ============================================================================
// Types for Request/Response
// ============================================================================

const AddressSchema = t.String({ pattern: '^0x[a-fA-F0-9]{40}$' })
const HexSchema = t.String({ pattern: '^0x[a-fA-F0-9]*$' })

// ============================================================================
// Routes
// ============================================================================

export const safeRoutes = new Elysia({ prefix: '/api/v1/safe' })
  // Root endpoint
  .get(
    '/',
    () => ({
      service: 'safe',
      status: 'available',
      description: 'Safe multisig wallet integration service',
      endpoints: {
        info: 'GET /api/v1/safe/info/:address',
        isSafe: 'GET /api/v1/safe/is-safe/:address',
        owners: 'GET /api/v1/safe/owners/:address',
        transactions: 'GET /api/v1/safe/transactions/:address',
        propose: 'POST /api/v1/safe/transactions/propose',
        submit: 'POST /api/v1/safe/transactions/submit',
      },
    }),
    {
      detail: { tags: ['safe'], summary: 'Get Safe service info' },
    },
  )
  // ==========================================================================
  // Safe Info
  // ==========================================================================

  .get(
    '/info/:address',
    async ({ params }) => {
      const service = getSafeService()
      const info = await service.getSafeInfo(params.address as Address)
      return {
        success: true,
        data: {
          ...info,
          // Convert bigints for JSON serialization
          owners: info.owners,
          threshold: info.threshold,
          nonce: info.nonce,
        },
      }
    },
    {
      params: t.Object({ address: AddressSchema }),
      detail: {
        tags: ['safe'],
        summary: 'Get Safe wallet info',
        description:
          'Returns owners, threshold, nonce, modules, and guard for a Safe',
      },
    },
  )

  .get(
    '/is-safe/:address',
    async ({ params }) => {
      const service = getSafeService()
      const isSafe = await service.isSafe(params.address as Address)
      return { success: true, data: { isSafe } }
    },
    {
      params: t.Object({ address: AddressSchema }),
      detail: {
        tags: ['safe'],
        summary: 'Check if address is a Safe',
      },
    },
  )

  .get(
    '/is-owner/:safeAddress/:ownerAddress',
    async ({ params }) => {
      const service = getSafeService()
      const isOwner = await service.isOwner(
        params.safeAddress as Address,
        params.ownerAddress as Address,
      )
      return { success: true, data: { isOwner } }
    },
    {
      params: t.Object({
        safeAddress: AddressSchema,
        ownerAddress: AddressSchema,
      }),
      detail: {
        tags: ['safe'],
        summary: 'Check if address is a Safe owner',
      },
    },
  )

  // ==========================================================================
  // Transactions
  // ==========================================================================

  .get(
    '/transactions/pending/:address',
    async ({ params }) => {
      const service = getSafeService()
      const transactions = await service.getPendingTransactions(
        params.address as Address,
      )
      return {
        success: true,
        data: {
          count: transactions.length,
          transactions: transactions.map(serializeTransaction),
        },
      }
    },
    {
      params: t.Object({ address: AddressSchema }),
      detail: {
        tags: ['safe'],
        summary: 'Get pending Safe transactions',
      },
    },
  )

  .get(
    '/transactions/history/:address',
    async ({ params, query }) => {
      const service = getSafeService()
      const limit = query.limit ? Number.parseInt(query.limit, 10) : 20
      const transactions = await service.getTransactionHistory(
        params.address as Address,
        limit,
      )
      return {
        success: true,
        data: {
          count: transactions.length,
          transactions: transactions.map(serializeTransaction),
        },
      }
    },
    {
      params: t.Object({ address: AddressSchema }),
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: {
        tags: ['safe'],
        summary: 'Get Safe transaction history',
      },
    },
  )

  .get(
    '/transactions/:safeTxHash',
    async ({ params }) => {
      const service = getSafeService()
      const transaction = await service.getTransaction(params.safeTxHash as Hex)
      if (!transaction) {
        return { success: false, error: 'Transaction not found' }
      }
      return {
        success: true,
        data: serializeTransaction(transaction),
      }
    },
    {
      params: t.Object({ safeTxHash: HexSchema }),
      detail: {
        tags: ['safe'],
        summary: 'Get Safe transaction by hash',
      },
    },
  )

  .get(
    '/transactions/:safeTxHash/status',
    async ({ params }) => {
      const service = getSafeService()
      const status = await service.getTransactionStatus(
        params.safeTxHash as Hex,
      )
      return { success: true, data: status }
    },
    {
      params: t.Object({ safeTxHash: HexSchema }),
      detail: {
        tags: ['safe'],
        summary: 'Get Safe transaction status',
      },
    },
  )

  // ==========================================================================
  // Propose Transaction
  // ==========================================================================

  .post(
    '/transactions/propose',
    async ({ body, request }) => {
      auditLog('safe_transaction_propose', body.proposer, request, true, {
        safeAddress: body.safeAddress,
        to: body.to,
        value: body.value,
        title: body.title?.slice(0, 50) ?? '',
      })

      const service = getSafeService()
      const proposal: SafeTransactionProposal = {
        safeAddress: body.safeAddress as Address,
        to: body.to as Address,
        value: BigInt(body.value),
        data: body.data as Hex,
        operation: body.operation ?? SafeOperation.CALL,
        title: body.title,
        description: body.description,
        category: (body.category ??
          'other') as SafeTransactionProposal['category'],
        proposer: body.proposer as Address,
        daoId: body.daoId,
        linkedProposalId: body.linkedProposalId,
      }

      // Get Safe info to compute safeTxHash for client to sign
      const safeInfo = await service.getSafeInfo(proposal.safeAddress)
      const safeTxHash = await service.computeSafeTxHash(
        proposal.safeAddress,
        proposal.to,
        proposal.value,
        proposal.data,
        proposal.operation ?? SafeOperation.CALL,
        safeInfo.nonce,
      )

      return {
        success: true,
        data: {
          proposal: {
            ...proposal,
            value: proposal.value.toString(),
          },
          safeTxHash,
          nonce: safeInfo.nonce,
          message:
            'Sign the safeTxHash with your wallet, then call /transactions/submit',
        },
      }
    },
    {
      body: t.Object({
        safeAddress: AddressSchema,
        to: AddressSchema,
        value: t.String(),
        data: HexSchema,
        operation: t.Optional(t.Union([t.Literal(0), t.Literal(1)])),
        title: t.String(),
        description: t.String(),
        category: t.Optional(t.String()),
        proposer: AddressSchema,
        daoId: t.Optional(t.String()),
        linkedProposalId: t.Optional(t.String()),
      }),
      detail: {
        tags: ['safe'],
        summary: 'Propose a Safe transaction',
        description:
          'Creates a transaction proposal. Client must sign the safeTxHash.',
      },
    },
  )

  // ==========================================================================
  // Submit Signed Transaction
  // ==========================================================================

  .post(
    '/transactions/submit',
    async ({ body, request }) => {
      auditLog('safe_transaction_submit', body.sender, request, true, {
        safeAddress: body.safeAddress,
        safeTxHash: body.safeTxHash,
        to: body.to,
        value: body.value,
      })

      const service = getSafeService()

      // Verify the signature is valid and submit to Safe TX Service
      await service.submitSignedProposal(
        body.safeAddress as Address,
        body.to as Address,
        BigInt(body.value),
        body.data as Hex,
        body.operation ?? SafeOperation.CALL,
        body.nonce,
        body.safeTxHash as Hex,
        body.sender as Address,
        body.signature as Hex,
        body.title,
      )

      return {
        success: true,
        data: {
          safeTxHash: body.safeTxHash,
          nonce: body.nonce,
        },
        message: 'Transaction submitted to Safe Transaction Service',
      }
    },
    {
      body: t.Object({
        safeAddress: AddressSchema,
        to: AddressSchema,
        value: t.String(),
        data: HexSchema,
        operation: t.Optional(t.Union([t.Literal(0), t.Literal(1)])),
        nonce: t.Number(),
        safeTxHash: HexSchema,
        sender: AddressSchema,
        signature: HexSchema,
        title: t.Optional(t.String()),
      }),
      detail: {
        tags: ['safe'],
        summary: 'Submit a signed Safe transaction',
        description:
          'Submits a signed transaction proposal to the Safe Transaction Service',
      },
    },
  )

  // ==========================================================================
  // Confirm Transaction (with signature)
  // ==========================================================================

  .post(
    '/transactions/:safeTxHash/confirm',
    async ({ params, body, request }) => {
      auditLog('safe_transaction_confirm', body.signer, request, true, {
        safeTxHash: params.safeTxHash,
      })

      const service = getSafeService()

      // Signer adapter that uses the pre-signed signature from the client
      // The client signs the safeTxHash with their wallet and sends the signature here
      const signer = {
        signMessage: async (_message: Hex): Promise<Hex> =>
          body.signature as Hex,
        address: body.signer as Address,
      }

      await service.confirmTransaction(params.safeTxHash as Hex, signer)

      return { success: true, message: 'Transaction confirmed' }
    },
    {
      params: t.Object({ safeTxHash: HexSchema }),
      body: t.Object({
        signer: AddressSchema,
        signature: HexSchema,
      }),
      detail: {
        tags: ['safe'],
        summary: 'Confirm a pending Safe transaction',
        description: 'Add a confirmation/signature to a pending transaction',
      },
    },
  )

  // ==========================================================================
  // Build Execute Transaction
  // ==========================================================================

  .get(
    '/transactions/:safeTxHash/execute',
    async ({ params }) => {
      const service = getSafeService()
      const txData = await service.buildExecuteTransaction(
        params.safeTxHash as Hex,
      )
      return {
        success: true,
        data: {
          to: txData.to,
          data: txData.data,
          value: txData.value.toString(),
        },
      }
    },
    {
      params: t.Object({ safeTxHash: HexSchema }),
      detail: {
        tags: ['safe'],
        summary: 'Build execute transaction data',
        description:
          'Returns the calldata needed to execute a fully-signed transaction',
      },
    },
  )

  // ==========================================================================
  // Treasury Operations
  // ==========================================================================

  .post(
    '/treasury/propose-withdraw',
    async ({ body, request }) => {
      auditLog('treasury_withdraw_propose', body.proposer, request, true, {
        daoId: body.daoId,
        token: body.token,
        amount: body.amount,
        recipient: body.recipient,
      })

      const withdrawRequest: TreasuryWithdrawRequest = {
        daoId: body.daoId,
        token: body.token as Address,
        amount: BigInt(body.amount),
        recipient: body.recipient as Address,
        reason: body.reason,
        proposer: body.proposer as Address,
        linkedProposalId: body.linkedProposalId,
      }

      // Build the withdrawal calldata
      const isEth =
        withdrawRequest.token === '0x0000000000000000000000000000000000000000'

      return {
        success: true,
        data: {
          request: {
            ...withdrawRequest,
            amount: withdrawRequest.amount.toString(),
          },
          calldata: {
            functionName: isEth ? 'withdrawETH' : 'withdrawToken',
            args: isEth
              ? [withdrawRequest.amount.toString(), withdrawRequest.recipient]
              : [
                  withdrawRequest.token,
                  withdrawRequest.amount.toString(),
                  withdrawRequest.recipient,
                ],
          },
          message: 'Use this data to propose a Safe transaction',
        },
      }
    },
    {
      body: t.Object({
        daoId: t.String(),
        token: AddressSchema,
        amount: t.String(),
        recipient: AddressSchema,
        reason: t.String(),
        proposer: AddressSchema,
        linkedProposalId: t.Optional(t.String()),
      }),
      detail: {
        tags: ['safe', 'treasury'],
        summary: 'Propose treasury withdrawal',
        description: 'Builds a treasury withdrawal proposal for Safe execution',
      },
    },
  )

  .post(
    '/treasury/propose-transfer',
    async ({ body, request }) => {
      auditLog('treasury_transfer_propose', 'client', request, true, {
        safeAddress: body.safeAddress,
        token: body.token,
        to: body.to,
        amount: body.amount,
      })

      const isEth = body.token === '0x0000000000000000000000000000000000000000'

      return {
        success: true,
        data: {
          transfer: {
            token: body.token,
            to: body.to,
            amount: body.amount,
            reason: body.reason,
          },
          calldata: isEth
            ? {
                to: body.to,
                value: body.amount,
                data: '0x',
              }
            : {
                to: body.token,
                value: '0',
                data: `0xa9059cbb${body.to.slice(2).padStart(64, '0')}${BigInt(body.amount).toString(16).padStart(64, '0')}`,
              },
          message: 'Use this data to propose a Safe transaction',
        },
      }
    },
    {
      body: t.Object({
        safeAddress: AddressSchema,
        token: AddressSchema,
        to: AddressSchema,
        amount: t.String(),
        reason: t.String(),
      }),
      detail: {
        tags: ['safe', 'treasury'],
        summary: 'Propose token transfer',
        description: 'Builds a token transfer proposal for Safe execution',
      },
    },
  )

  // ==========================================================================
  // Governance Operations
  // ==========================================================================

  .post(
    '/governance/propose',
    async ({ body, request }) => {
      auditLog('governance_propose', body.proposer, request, true, {
        daoId: body.daoId,
        target: body.target,
        description: body.description?.slice(0, 50) ?? '',
      })

      const proposal: GovernanceProposal = {
        daoId: body.daoId,
        target: body.target as Address,
        calldata: body.calldata as Hex,
        value: BigInt(body.value ?? '0'),
        description: body.description,
        timelockDelay: body.timelockDelay,
        proposer: body.proposer as Address,
      }

      return {
        success: true,
        data: {
          proposal: {
            ...proposal,
            value: proposal.value.toString(),
          },
          message: 'Use this data to propose a Safe transaction',
        },
      }
    },
    {
      body: t.Object({
        daoId: t.String(),
        target: AddressSchema,
        calldata: HexSchema,
        value: t.Optional(t.String()),
        description: t.String(),
        timelockDelay: t.Optional(t.Number()),
        proposer: AddressSchema,
      }),
      detail: {
        tags: ['safe', 'governance'],
        summary: 'Propose governance action',
        description: 'Builds a governance action proposal for Safe execution',
      },
    },
  )

  // ==========================================================================
  // Batch Operations
  // ==========================================================================

  .post(
    '/batch/encode',
    async ({ body }) => {
      const transactions = body.transactions.map((tx) => ({
        to: tx.to as Address,
        value: BigInt(tx.value),
        data: tx.data as Hex,
        operation: tx.operation ?? SafeOperation.CALL,
      }))

      // Build MultiSend encoding
      let encoded = '0x'
      for (const tx of transactions) {
        const operation = tx.operation.toString(16).padStart(2, '0')
        const to = tx.to.slice(2).toLowerCase()
        const value = tx.value.toString(16).padStart(64, '0')
        const data = tx.data.slice(2)
        const dataLength = (data.length / 2).toString(16).padStart(64, '0')
        encoded += operation + to + value + dataLength + data
      }

      return {
        success: true,
        data: {
          multiSendData: encoded as Hex,
          transactionCount: transactions.length,
          message: 'Use DELEGATE_CALL to MultiSend contract with this data',
        },
      }
    },
    {
      body: t.Object({
        transactions: t.Array(
          t.Object({
            to: AddressSchema,
            value: t.String(),
            data: HexSchema,
            operation: t.Optional(t.Union([t.Literal(0), t.Literal(1)])),
          }),
        ),
      }),
      detail: {
        tags: ['safe', 'batch'],
        summary: 'Encode batch transactions',
        description: 'Encodes multiple transactions for MultiSend execution',
      },
    },
  )

  // ==========================================================================
  // DAO Integration
  // ==========================================================================

  .get(
    '/dao/:daoId/safe-info',
    async ({ params, query }) => {
      const service = getSafeService()
      const safeAddress = query.safeAddress as Address

      if (!safeAddress) {
        return { success: false, error: 'safeAddress query param required' }
      }

      const info = await service.getDAOSafeInfo(params.daoId, safeAddress)
      return { success: true, data: info }
    },
    {
      params: t.Object({ daoId: t.String() }),
      query: t.Object({ safeAddress: AddressSchema }),
      detail: {
        tags: ['safe', 'dao'],
        summary: 'Get DAO Safe info',
        description: 'Returns Safe info with DAO-specific signer details',
      },
    },
  )

// ============================================================================
// Helpers
// ============================================================================

function serializeTransaction(tx: {
  safe: Address
  to: Address
  value: bigint
  data: Hex
  operation: number
  safeTxGas: bigint
  baseGas: bigint
  gasPrice: bigint
  gasToken: Address
  refundReceiver: Address
  nonce: number
  confirmations: Array<{
    owner: Address
    signature: Hex
    submissionDate: string
  }>
  confirmationsRequired: number
  isExecuted: boolean
  safeTxHash: Hex
  proposer: Address
  submissionDate: string
  executionDate?: string
  executor?: Address
  transactionHash?: Hex
}) {
  return {
    safe: tx.safe,
    to: tx.to,
    value: tx.value.toString(),
    data: tx.data,
    operation: tx.operation,
    safeTxGas: tx.safeTxGas.toString(),
    baseGas: tx.baseGas.toString(),
    gasPrice: tx.gasPrice.toString(),
    gasToken: tx.gasToken,
    refundReceiver: tx.refundReceiver,
    nonce: tx.nonce,
    confirmations: tx.confirmations,
    confirmationsRequired: tx.confirmationsRequired,
    isExecuted: tx.isExecuted,
    safeTxHash: tx.safeTxHash,
    proposer: tx.proposer,
    submissionDate: tx.submissionDate,
    executionDate: tx.executionDate,
    executor: tx.executor,
    transactionHash: tx.transactionHash,
  }
}
