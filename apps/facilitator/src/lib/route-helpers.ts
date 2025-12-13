import type { Context } from 'hono';
import { validateVerifyRequest, validateSettleRequest } from './request-validation';
import { buildVerifyErrorResponse, buildSettleErrorResponse, getNetworkFromRequest, formatError } from './response-builders';

export async function parseJsonBody<T>(c: Context): Promise<{ body: T; error?: string }> {
  const body = await c.req.json<T>();
  return { body };
}

export function handleVerifyRequest(c: Context, body: unknown, defaultNetwork: string) {
  const validation = validateVerifyRequest(body);
  if (!validation.valid) {
    const isClientError = validation.error && (
      validation.error.includes('Missing') ||
      validation.error.includes('Invalid JSON') ||
      validation.error.includes('Unsupported x402Version')
    );
    const status = isClientError ? 400 : 200;
    return { valid: false, response: c.json(buildVerifyErrorResponse(validation.error ?? 'Validation failed'), status) };
  }

  const network = getNetworkFromRequest(validation.body!.paymentRequirements.network, defaultNetwork);
  return { valid: true, body: validation.body!, network };
}

export function handleSettleRequest(c: Context, body: unknown, defaultNetwork: string, requireAuthParams = false) {
  const validation = validateSettleRequest(body, requireAuthParams);
  if (!validation.valid) {
    const isClientError = validation.error && (
      validation.error.includes('Missing') ||
      validation.error.includes('Invalid JSON') ||
      validation.error.includes('Unsupported x402Version')
    );
    const status = isClientError ? 400 : 200;
    return {
      valid: false,
      response: c.json(buildSettleErrorResponse(defaultNetwork, validation.error ?? 'Validation failed'), status),
    };
  }

  const network = getNetworkFromRequest(validation.body!.paymentRequirements.network, defaultNetwork);
  return { valid: true, body: validation.body!, network };
}

export function handleRouteError(c: Context, error: unknown, network: string, operation: string) {
  const message = formatError(error);
  return c.json(buildSettleErrorResponse(network, `${operation}: ${message}`), 500);
}
