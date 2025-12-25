import { Elysia } from 'elysia'
import type { PublicClient } from 'viem'
import { config } from '../config'
import {
  buildVerifyErrorResponse,
  buildVerifySuccessResponse,
} from '../lib/response-builders'
import { handleVerifyRequest } from '../lib/route-helpers'
import type { PaymentRequirements } from '../lib/schemas'
import { createClients } from '../services/settler'
import {
  decodePaymentHeader,
  verifyPayment,
  verifySignatureOnly,
} from '../services/verifier'

const verifyRoutes = new Elysia({ prefix: '/verify' })
  .post('/', async ({ body, set }) => {
    const cfg = config()
    if (!body || typeof body !== 'object') {
      set.status = 400
      return buildVerifyErrorResponse('Invalid JSON request body')
    }

    const handleResult = handleVerifyRequest(body, cfg.network)
    if (handleResult.valid === false) {
      set.status = handleResult.status as 200 | 400
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
  .post('/signature', async ({ body, set }) => {
    if (!body || typeof body !== 'object') {
      set.status = 400
      return { valid: false, error: 'Invalid JSON request body' }
    }

    const paymentHeader =
      'paymentHeader' in body && typeof body.paymentHeader === 'string'
        ? body.paymentHeader
        : null
    if (!paymentHeader) {
      set.status = 400
      return { valid: false, error: 'Missing paymentHeader' }
    }

    const cfg = config()
    const network =
      'network' in body && typeof body.network === 'string'
        ? body.network
        : cfg.network
    const payload = decodePaymentHeader(paymentHeader)

    if (!payload) {
      set.status = 400
      return { valid: false, error: 'Invalid payment header encoding' }
    }

    const result = await verifySignatureOnly(paymentHeader, network)

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
