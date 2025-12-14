import type { Context } from 'hono';
import { validateVerifyRequest, validateSettleRequest } from './request-validation';
import { buildVerifyErrorResponse, buildSettleErrorResponse, formatError } from './response-builders';

function getNetworkFromRequest(requirementsNetwork: string | undefined, defaultNetwork: string): string {
  return requirementsNetwork ?? defaultNetwork;
}

export async function parseJsonBody<T>(c: Context): Promise<{ body: T; error?: string }> {
  try {
    const body = await c.req.json<T>();
    return { body };
  } catch {
    return { body: null as T, error: 'Invalid JSON request body' };
  }
}

export function handleVerifyRequest(c: Context, body: unknown, defaultNetwork: string): { valid: false; response: Response } | { valid: true; body: { x402Version: number; paymentHeader: string; paymentRequirements: { network?: string; scheme: 'exact' | 'upto'; maxAmountRequired: string; payTo: string; asset: string; resource: string } }; network: string } {
  const validation = validateVerifyRequest(body);
  if (!validation.valid || !validation.body) {
    const isClientError = validation.error && (
      validation.error.includes('Missing') ||
      validation.error.includes('Invalid JSON') ||
      validation.error.includes('Unsupported x402Version')
    );
    const status = isClientError ? 400 : 200;
    return { valid: false, response: c.json(buildVerifyErrorResponse(validation.error ?? 'Validation failed'), status) };
  }

  const network = getNetworkFromRequest(validation.body.paymentRequirements.network, defaultNetwork);
  return { valid: true, body: validation.body as { x402Version: number; paymentHeader: string; paymentRequirements: { network?: string; scheme: 'exact' | 'upto'; maxAmountRequired: string; payTo: string; asset: string; resource: string } }, network };
}

export function handleSettleRequest(c: Context, body: unknown, defaultNetwork: string, requireAuthParams = false): { valid: false; response: Response } | { valid: true; body: { x402Version: number; paymentHeader: string; paymentRequirements: { network?: string; scheme: 'exact' | 'upto'; maxAmountRequired: string; payTo: string; asset: string; resource: string }; authParams?: Record<string, unknown> }; network: string } {
  const validation = validateSettleRequest(body, requireAuthParams);
  if (!validation.valid || !validation.body) {
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

  const network = getNetworkFromRequest(validation.body.paymentRequirements.network, defaultNetwork);
  return { valid: true, body: validation.body as { x402Version: number; paymentHeader: string; paymentRequirements: { network?: string; scheme: 'exact' | 'upto'; maxAmountRequired: string; payTo: string; asset: string; resource: string }; authParams?: Record<string, unknown> }, network };
}

export function handleRouteError(c: Context, error: unknown, network: string, operation: string) {
  const message = formatError(error);
  return c.json(buildSettleErrorResponse(network, `${operation}: ${message}`), 500);
}
