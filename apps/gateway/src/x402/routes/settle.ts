import { Elysia } from 'elysia'
import type { Hex, PublicClient, WalletClient } from 'viem'
import { config } from '../config'
import {
  buildSettleErrorResponse,
  buildSettleSuccessResponse,
} from '../lib/response-builders'
import { handleSettleRequest } from '../lib/route-helpers'
import type {
  AuthParams,
  DecodedPayment,
  PaymentRequirements,
  SettlementResult,
} from '../lib/schemas'
import {
  createClients,
  formatAmount,
  getFacilitatorStats,
  settleGaslessPayment,
  settlePayment,
} from '../services/settler'
import { verifyPayment } from '../services/verifier'

type SettleBody = {
  paymentHeader: string
  paymentRequirements: PaymentRequirements
}
type StandardSettleFn = (
  payment: DecodedPayment,
  network: string,
  publicClient: PublicClient,
  walletClient: WalletClient,
) => Promise<SettlementResult>
type GaslessSettleFn = (
  payment: DecodedPayment,
  network: string,
  publicClient: PublicClient,
  walletClient: WalletClient,
  authParams: AuthParams,
) => Promise<SettlementResult>

type ProcessSettlementResult = {
  status: number
  response: Record<string, unknown>
}

async function processSettlement(
  body: SettleBody,
  network: string,
  settlementFn: StandardSettleFn,
): Promise<ProcessSettlementResult>
async function processSettlement(
  body: SettleBody,
  network: string,
  settlementFn: GaslessSettleFn,
  authParams: AuthParams,
): Promise<ProcessSettlementResult>
async function processSettlement(
  body: SettleBody,
  network: string,
  settlementFn: StandardSettleFn | GaslessSettleFn,
  authParams?: AuthParams,
): Promise<ProcessSettlementResult> {
  const requirements: PaymentRequirements = {
    ...body.paymentRequirements,
    network,
  }

  const { publicClient, walletClient } = await createClients(network)
  const verifyResult = await verifyPayment(
    body.paymentHeader,
    requirements,
    publicClient,
  )

  if (!verifyResult.valid) {
    return {
      status: 200,
      response: buildSettleErrorResponse(
        network,
        verifyResult.error ?? 'Payment verification failed',
      ),
    }
  }

  if (!verifyResult.decodedPayment) {
    return {
      status: 500,
      response: buildSettleErrorResponse(
        network,
        'Verification succeeded but payment data missing',
      ),
    }
  }

  const payment = verifyResult.decodedPayment
  const amountInfo = formatAmount(payment.amount, network, payment.token)

  if (!walletClient) {
    return {
      status: 503,
      response: buildSettleErrorResponse(
        network,
        'Settlement wallet not configured',
        payment.payer,
        payment.recipient,
        amountInfo,
      ),
    }
  }

  const stats = await getFacilitatorStats(publicClient)
  const feeBps = Number(stats.protocolFeeBps)
  const settlementResult = authParams
    ? await (settlementFn as GaslessSettleFn)(
        payment,
        network,
        publicClient,
        walletClient,
        authParams,
      )
    : await (settlementFn as StandardSettleFn)(
        payment,
        network,
        publicClient,
        walletClient,
      )

  if (!settlementResult.success) {
    return {
      status: 200,
      response: buildSettleErrorResponse(
        network,
        settlementResult.error ?? 'Settlement failed',
        payment.payer,
        payment.recipient,
        amountInfo,
        settlementResult.txHash ?? null,
      ),
    }
  }

  return {
    status: 200,
    response: buildSettleSuccessResponse(
      network,
      payment,
      settlementResult,
      feeBps,
    ),
  }
}

const settleRoutes = new Elysia()
  .post('/settle', async ({ body, set }) => {
    const cfg = config()
    const requestBody = body as Record<string, unknown> | null

    if (!requestBody) {
      set.status = 400
      return buildSettleErrorResponse(cfg.network, 'Invalid JSON request body')
    }

    const handleResult = handleSettleRequest(requestBody, cfg.network)
    if (handleResult.valid === false) {
      set.status = handleResult.status as 200 | 400
      return handleResult.response
    }

    const bodyWithNetwork: {
      paymentHeader: string
      paymentRequirements: PaymentRequirements
    } = {
      paymentHeader: handleResult.body.paymentHeader,
      paymentRequirements: {
        ...handleResult.body.paymentRequirements,
        network: handleResult.network,
      } as PaymentRequirements,
    }

    const result = await processSettlement(
      bodyWithNetwork,
      handleResult.network,
      settlePayment,
    )
    set.status = result.status as 200 | 500 | 503
    return result.response
  })
  .post('/settle/gasless', async ({ body, set }) => {
    const cfg = config()
    const requestBody = body as Record<string, unknown> | null

    if (!requestBody) {
      set.status = 400
      return buildSettleErrorResponse(cfg.network, 'Invalid JSON request body')
    }

    const handleResult = handleSettleRequest(requestBody, cfg.network, true)
    if (handleResult.valid === false) {
      set.status = handleResult.status as 200 | 400
      return handleResult.response
    }

    const authParams = handleResult.body.authParams
    if (!authParams || typeof authParams !== 'object') {
      set.status = 400
      return buildSettleErrorResponse(
        cfg.network,
        'Missing authParams for EIP-3009',
      )
    }

    const auth: {
      validAfter: number
      validBefore: number
      authNonce: Hex
      authSignature: Hex
    } = {
      validAfter: authParams.validAfter as number,
      validBefore: authParams.validBefore as number,
      authNonce: authParams.authNonce as Hex,
      authSignature: authParams.authSignature as Hex,
    }

    const bodyWithNetwork: {
      paymentHeader: string
      paymentRequirements: PaymentRequirements
    } = {
      paymentHeader: handleResult.body.paymentHeader,
      paymentRequirements: {
        ...handleResult.body.paymentRequirements,
        network: handleResult.network,
      } as PaymentRequirements,
    }

    const result = await processSettlement(
      bodyWithNetwork,
      handleResult.network,
      settleGaslessPayment,
      auth,
    )
    set.status = result.status as 200 | 500 | 503
    return result.response
  })

export default settleRoutes
