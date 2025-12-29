/**
 * VPN Shared Library
 *
 * Provides a unified interface for invoking Tauri commands that works both:
 * - In production Tauri builds (uses real Rust backend)
 * - In web development mode (uses mock handlers from ./mock.ts)
 *
 * The `isTauri()` function detects the environment and routes accordingly.
 */

import { isDevelopmentEnv } from '@jejunetwork/config'
import type { z } from 'zod'
import { isTauri, mockInvoke } from './mock'
import { expectValid } from './validation'

export * from './schemas'
export * from './utils'
export * from './validation'
export { isTauri }

/**
 * Invoke a Tauri command with optional Zod schema validation.
 *
 * In Tauri environment: Calls real Rust backend via IPC.
 * In web/browser: Falls back to mock handlers for development.
 *
 * @param cmd - Command name matching a Tauri #[tauri::command]
 * @param args - Arguments to pass to the command
 * @param schema - Optional Zod schema to validate the response
 */
export async function invoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
  schema?: z.ZodType<T>,
): Promise<T> {
  let result: T

  if (isTauri()) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
    result = await tauriInvoke<T>(cmd, args)
  } else {
    // Development mode: use mock handlers
    // Console warning in dev to make it clear mocks are active
    if (isDevelopmentEnv()) {
      console.debug(`[Mock] ${cmd}`, args)
    }
    result = await mockInvoke<T>(cmd, args)
  }

  if (schema) {
    return expectValid(schema, result, `API response for ${cmd}`)
  }

  return result
}
