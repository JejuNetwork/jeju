import type { z } from 'zod'
import { isTauri, mockInvoke } from './mock'
import { expectValid } from './validation'

export * from './schemas'
export * from './utils'
export * from './validation'
export { isTauri }

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
    result = await mockInvoke<T>(cmd, args)
  }

  if (schema) {
    return expectValid(schema, result, `API response for ${cmd}`)
  }

  return result
}
