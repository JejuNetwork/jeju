import type { VerifyRequest, SettleRequest } from './types';

export interface ValidationResult<T> {
  valid: boolean;
  body?: T;
  error?: string;
}

export function validateVerifyRequest(body: unknown): ValidationResult<VerifyRequest> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Invalid JSON request body' };
  }

  const req = body as Record<string, unknown>;

  if (typeof req.paymentHeader !== 'string' || !req.paymentHeader) {
    return { valid: false, error: 'Missing paymentHeader' };
  }

  if (!req.paymentRequirements || typeof req.paymentRequirements !== 'object' || Array.isArray(req.paymentRequirements)) {
    return { valid: false, error: 'Missing paymentRequirements' };
  }

  if (req.x402Version === undefined || req.x402Version === null) {
    return { valid: false, error: 'Missing x402Version' };
  }
  if (typeof req.x402Version !== 'number' || req.x402Version !== 1) {
    return { valid: false, error: `Unsupported x402Version: ${req.x402Version}. Only version 1 is supported.` };
  }

  return {
    valid: true,
    body: {
      x402Version: 1,
      paymentHeader: req.paymentHeader,
      paymentRequirements: req.paymentRequirements as VerifyRequest['paymentRequirements'],
    },
  };
}

export function validateSettleRequest(body: unknown, requireAuthParams = false): ValidationResult<SettleRequest & { authParams?: Record<string, unknown> }> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Invalid JSON request body' };
  }

  const req = body as Record<string, unknown>;

  if (typeof req.paymentHeader !== 'string' || !req.paymentHeader) {
    return { valid: false, error: 'Missing paymentHeader' };
  }

  if (!req.paymentRequirements || typeof req.paymentRequirements !== 'object' || Array.isArray(req.paymentRequirements)) {
    return { valid: false, error: 'Missing paymentRequirements' };
  }

  if (requireAuthParams && (!req.authParams || typeof req.authParams !== 'object' || Array.isArray(req.authParams))) {
    return { valid: false, error: 'Missing authParams for EIP-3009' };
  }

  if (req.x402Version === undefined || req.x402Version === null) {
    return { valid: false, error: 'Missing x402Version' };
  }
  if (typeof req.x402Version !== 'number' || req.x402Version !== 1) {
    return { valid: false, error: `Unsupported x402Version: ${req.x402Version}. Only version 1 is supported.` };
  }

  const result: SettleRequest & { authParams?: Record<string, unknown> } = {
    x402Version: 1,
    paymentHeader: req.paymentHeader,
    paymentRequirements: req.paymentRequirements as SettleRequest['paymentRequirements'],
  };

  if (requireAuthParams && req.authParams) {
    result.authParams = req.authParams as Record<string, unknown>;
  }

  return { valid: true, body: result };
}
