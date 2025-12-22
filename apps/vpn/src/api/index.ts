/**
 * API layer that works in both Tauri and web contexts
 *
 * All responses are validated with Zod schemas
 */

import type { z } from 'zod'
import { isTauri, mockInvoke } from './mock'
import { expectValid } from './schemas'

/**
 * Invoke a command - uses Tauri if available, otherwise mock API
 * Validates response against schema if provided
 */
export async function invoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
  schema?: z.ZodType<T>,
): Promise<T> {
  let result: T

  if (isTauri()) {
    // Conditional dynamic import: Tauri API only available in Tauri runtime, not in web bundles
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/tauri')
    result = await tauriInvoke<T>(cmd, args)
  } else {
    result = await mockInvoke<T>(cmd, args)
  }

  // Validate response if schema provided
  if (schema) {
    return expectValid(schema, result, `API response for ${cmd}`)
  }

  return result
}

export { isTauri }
