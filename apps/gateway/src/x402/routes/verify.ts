import { Elysia } from 'elysia'
import type { PublicClient } from 'viem'
import { config } from '../config'
import {
  buildVerifyErrorResponse,
  buildVerifySuccessResponse,
} from '../lib/response-builders'
import { handleVerifyRequest, parseJsonBody } from '../lib/route-helpers'
import type { PaymentRequirements } from '../lib/types'
import { createClients } from '../services/settler'
import {
  decodePaymentHeader,
  verifyPayment,
  verifySignatureOnly,
} from '../services/verifier'

const verifyRoutes = new Elysia({ prefix: '/verify' })
  .post('/', async ({ request, set }) => {
    const cfg = config()
    const parseResult = await parseJsonBody(request)
    if (parseResult.error) {
      set.status = 400
      return buildVerifyErrorResponse('Invalid JSON request body')
    }

    const handleResult = handleVerifyRequest(parseResult.body, cfg.network)
    if (!handleResult.valid) {
      set.status = handleResult.status
      return handleResult.response
    }

    let publicClient: PublicClient
    try {
      const clients = await createClients(handleResult.network)
      publicClient = clients.publicClient
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return buildVerifyErrorResponse(`Network error: ${message}`)
    }

    const requirements = {
      ...handleResult.body.paymentRequirements,
      network: handleResult.network,
    } as PaymentRequirements
    const result = await verifyPayment(
      handleResult.body.paymentHeader,
      requirements,
      publicClient,
    )

    if (!result.valid) {
      return buildVerifyErrorResponse(result.error ?? 'Verification failed')
    }

    if (!result.signer || !result.decodedPayment) {
      set.status = 500
      return buildVerifyErrorResponse(
        'Verification succeeded but missing signer or payment data',
      )
    }

    return buildVerifySuccessResponse(
      result.signer,
      result.decodedPayment.amount.toString(),
    )
  })
  .post('/signature', async ({ request, set }) => {
    const parseResult = await parseJsonBody<{
      paymentHeader: string
      network?: string
    }>(request)
    if (parseResult.error) {
      set.status = 400
      return { valid: false, error: 'Invalid JSON request body' }
    }

    if (!parseResult.body.paymentHeader) {
      set.status = 400
      return { valid: false, error: 'Missing paymentHeader' }
    }

    const cfg = config()
    function getNetworkFromRequest(
      requirementsNetwork: string | undefined,
      defaultNetwork: string,
    ): string {
      return requirementsNetwork ?? defaultNetwork
    }
    const network = getNetworkFromRequest(parseResult.body.network, cfg.network)
    const payload = decodePaymentHeader(parseResult.body.paymentHeader)

    if (!payload) {
      set.status = 400
      return { valid: false, error: 'Invalid payment header encoding' }
    }

    const result = await verifySignatureOnly(
      parseResult.body.paymentHeader,
      network,
    )

    if (!result.valid) {
      return {
        valid: false,
        error: result.error ?? 'Signature verification failed',
      }
    }

    if (!result.signer) {
      set.status = 500
      return {
        valid: false,
        error: 'Signature verification succeeded but signer not found',
      }
    }

    return {
      valid: true,
      signer: result.signer,
      payment: {
        amount: payload.amount,
        recipient: payload.payTo,
        token: payload.asset,
        resource: payload.resource,
        network: payload.network,
      },
    }
  })

export default verifyRoutes
