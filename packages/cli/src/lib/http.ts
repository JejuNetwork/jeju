/**
 * HTTP utilities for CLI
 * 
 * Shared fetch wrappers with proper typing and fail-fast error handling.
 */

import { z } from 'zod';
import { validate } from '../schemas';

/**
 * Fetch JSON from a URL and validate with a Zod schema.
 * Throws on network errors, non-OK responses, or validation failures.
 */
export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
  } = {}
): Promise<T> {
  const { method = 'GET', headers = {}, body, timeout = 10000 } = options;

  const requestInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
  };

  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetch(url, requestInit);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
  }

  const data = await response.json();
  return validate(data, schema, url);
}

/**
 * Fetch JSON without schema validation (for responses with variable structure).
 * Throws on network errors or non-OK responses.
 */
export async function fetchJsonRaw<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
  } = {}
): Promise<T> {
  const { method = 'GET', headers = {}, body, timeout = 10000 } = options;

  const requestInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
  };

  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetch(url, requestInit);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Check if a URL responds successfully to a health check.
 * Returns false on any error (network, timeout, non-OK status).
 */
export async function checkHealth(url: string, timeout = 3000): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if an RPC endpoint is responding (JSON-RPC format).
 */
export async function checkRpcEndpoint(url: string, timeout = 3000): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      signal: AbortSignal.timeout(timeout),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for a URL to become healthy with retries.
 */
export async function waitForHealth(
  url: string,
  options: { timeout?: number; interval?: number; maxAttempts?: number } = {}
): Promise<boolean> {
  const { timeout = 3000, interval = 1000, maxAttempts = 30 } = options;

  for (let i = 0; i < maxAttempts; i++) {
    if (await checkHealth(url, timeout)) {
      return true;
    }
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}
