import { validateOrThrow } from '../../lib/validation'
import {
  type SettleRequest,
  SettleRequestSchema,
  type SettleRequestWithAuth,
  SettleRequestWithAuthSchema,
  type VerifyRequest,
  VerifyRequestSchema,
} from './schemas'

export interface ValidationResult<T> {
  valid: boolean
  body?: T
  error?: string
}

/**
 * Validates verify request with fail-fast pattern
 */
export function validateVerifyRequest(
  body: unknown,
): ValidationResult<VerifyRequest> {
  try {
    const validated = validateOrThrow(
      VerifyRequestSchema,
      body,
      'VerifyRequest validation',
    )
    return { valid: true, body: validated as VerifyRequest }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validation failed'
    return { valid: false, error: message }
  }
}

/**
 * Validates settle request with fail-fast pattern
 */
export function validateSettleRequest(
  body: unknown,
  requireAuthParams: true,
): ValidationResult<SettleRequestWithAuth>
export function validateSettleRequest(
  body: unknown,
  requireAuthParams?: false,
): ValidationResult<SettleRequest>
export function validateSettleRequest(
  body: unknown,
  requireAuthParams = false,
): ValidationResult<SettleRequest | SettleRequestWithAuth> {
  try {
    if (requireAuthParams) {
      const validated = validateOrThrow(
        SettleRequestWithAuthSchema,
        body,
        'SettleRequestWithAuth validation',
      )
      return { valid: true, body: validated as SettleRequestWithAuth }
    } else {
      const validated = validateOrThrow(
        SettleRequestSchema,
        body,
        'SettleRequest validation',
      )
      return { valid: true, body: validated as SettleRequest }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validation failed'
    return { valid: false, error: message }
  }
}
