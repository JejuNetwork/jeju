import type { Context } from 'hono';
import { validateVerifyRequest, validateSettleRequest } from './request-validation';
import { buildVerifyErrorResponse, buildSettleErrorResponse, formatError } from './response-builders';
import type { VerifyRequest, SettleRequest, SettleRequestWithAuth } from './schemas';

function getNetworkFromRequest(requirementsNetwork: string | undefined, defaultNetwork: string): string {
  if (!requirementsNetwork) {
    return defaultNetwork;
  }
  if (typeof requirementsNetwork !== 'string' || requirementsNetwork.length === 0) {
    return defaultNetwork;
  }
  return requirementsNetwork;
}

export async function parseJsonBody<T>(c: Context): Promise<{ body: T; error?: string }> {
  try {
    const body = await c.req.json<T>();
    return { body };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON request body';
    return { body: null as T, error: message };
  }
}

export function handleVerifyRequest(
  c: Context,
  body: unknown,
  defaultNetwork: string
): { valid: false; response: Response } | { valid: true; body: VerifyRequest; network: string } {
  const validation = validateVerifyRequest(body);
  if (!validation.valid || !validation.body) {
    const isClientError = validation.error && (
      validation.error.includes('Missing') ||
      validation.error.includes('Invalid JSON') ||
      validation.error.includes('Unsupported x402Version') ||
      validation.error.includes('Required')
    );
    const status = isClientError ? 400 : 200;
    return { valid: false, response: c.json(buildVerifyErrorResponse(validation.error ?? 'Validation failed'), status) };
  }

  const network = getNetworkFromRequest(validation.body.paymentRequirements.network, defaultNetwork);
  return { valid: true, body: validation.body, network };
}

export function handleSettleRequest(
  c: Context,
  body: unknown,
  defaultNetwork: string,
  requireAuthParams: true
): { valid: false; response: Response } | { valid: true; body: SettleRequestWithAuth; network: string };
export function handleSettleRequest(
  c: Context,
  body: unknown,
  defaultNetwork: string,
  requireAuthParams?: false
): { valid: false; response: Response } | { valid: true; body: SettleRequest; network: string };
export function handleSettleRequest(
  c: Context,
  body: unknown,
  defaultNetwork: string,
  requireAuthParams = false
): { valid: false; response: Response } | { valid: true; body: SettleRequest | SettleRequestWithAuth; network: string } {
  const validation = requireAuthParams 
    ? validateSettleRequest(body, true)
    : validateSettleRequest(body, false);
  if (!validation.valid || !validation.body) {
    const isClientError = validation.error && (
      validation.error.includes('Missing') ||
      validation.error.includes('Invalid JSON') ||
      validation.error.includes('Unsupported x402Version') ||
      validation.error.includes('Required')
    );
    const status = isClientError ? 400 : 200;
    return {
      valid: false,
      response: c.json(buildSettleErrorResponse(defaultNetwork, validation.error ?? 'Validation failed'), status),
    };
  }

  const network = getNetworkFromRequest(validation.body.paymentRequirements.network, defaultNetwork);
  return { valid: true, body: validation.body, network };
}

export function handleRouteError(c: Context, error: unknown, network: string, operation: string) {
  const message = formatError(error);
  return c.json(buildSettleErrorResponse(network, `${operation}: ${message}`), 500);
}
