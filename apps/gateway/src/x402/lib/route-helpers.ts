import {
  validateSettleRequest,
  validateVerifyRequest,
} from './request-validation'
import {
  buildSettleErrorResponse,
  buildVerifyErrorResponse,
  formatError,
} from './response-builders'
import type {
  SettleRequest,
  SettleRequestWithAuth,
  VerifyRequest,
} from './schemas'

function getNetworkFromRequest(
  requirementsNetwork: string | undefined,
  defaultNetwork: string,
): string {
  if (!requirementsNetwork) {
    return defaultNetwork
  }
  if (
    typeof requirementsNetwork !== 'string' ||
    requirementsNetwork.length === 0
  ) {
    return defaultNetwork
  }
  return requirementsNetwork
}

export async function parseJsonBody<T>(
  request: Request,
): Promise<{ body: T; error?: string }> {
  try {
    const body = (await request.json()) as T
    return { body }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid JSON request body'
    return { body: null as T, error: message }
  }
}

type HandleVerifyResult =
  | {
      valid: false
      status: number
      response: ReturnType<typeof buildVerifyErrorResponse>
    }
  | { valid: true; body: VerifyRequest; network: string }

export function handleVerifyRequest(
  body: unknown,
  defaultNetwork: string,
): HandleVerifyResult {
  const validation = validateVerifyRequest(body)
  if (!validation.valid || !validation.body) {
    const isClientError =
      validation.error &&
      (validation.error.includes('Missing') ||
        validation.error.includes('Invalid JSON') ||
        validation.error.includes('Unsupported x402Version') ||
        validation.error.includes('Required'))
    const status = isClientError ? 400 : 200
    return {
      valid: false,
      status,
      response: buildVerifyErrorResponse(
        validation.error ?? 'Validation failed',
      ),
    }
  }

  const network = getNetworkFromRequest(
    validation.body.paymentRequirements.network,
    defaultNetwork,
  )
  return { valid: true, body: validation.body, network }
}

type HandleSettleResultBase = {
  valid: false
  status: number
  response: ReturnType<typeof buildSettleErrorResponse>
}
type HandleSettleResultWithAuth = {
  valid: true
  body: SettleRequestWithAuth
  network: string
}
type HandleSettleResultNoAuth = {
  valid: true
  body: SettleRequest
  network: string
}

export function handleSettleRequest(
  body: unknown,
  defaultNetwork: string,
  requireAuthParams: true,
): HandleSettleResultBase | HandleSettleResultWithAuth
export function handleSettleRequest(
  body: unknown,
  defaultNetwork: string,
  requireAuthParams?: false,
): HandleSettleResultBase | HandleSettleResultNoAuth
export function handleSettleRequest(
  body: unknown,
  defaultNetwork: string,
  requireAuthParams = false,
):
  | HandleSettleResultBase
  | HandleSettleResultWithAuth
  | HandleSettleResultNoAuth {
  const validation = requireAuthParams
    ? validateSettleRequest(body, true)
    : validateSettleRequest(body, false)
  if (!validation.valid || !validation.body) {
    const isClientError =
      validation.error &&
      (validation.error.includes('Missing') ||
        validation.error.includes('Invalid JSON') ||
        validation.error.includes('Unsupported x402Version') ||
        validation.error.includes('Required'))
    const status = isClientError ? 400 : 200
    return {
      valid: false,
      status,
      response: buildSettleErrorResponse(
        defaultNetwork,
        validation.error ?? 'Validation failed',
      ),
    }
  }

  const network = getNetworkFromRequest(
    validation.body.paymentRequirements.network,
    defaultNetwork,
  )
  return { valid: true, body: validation.body, network }
}

export function handleRouteError(
  error: unknown,
  network: string,
  operation: string,
) {
  const message = formatError(error)
  return {
    status: 500,
    response: buildSettleErrorResponse(network, `${operation}: ${message}`),
  }
}
