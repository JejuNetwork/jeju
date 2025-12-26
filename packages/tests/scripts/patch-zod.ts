/**
 * Patch Zod for compatibility with packages expecting Zod 3 API
 *
 * Adds:
 * - .loose() method for @elizaos/core compatibility
 * - .returns() method for synpress compatibility (Zod 3 API)
 */
import { z } from 'zod'

// Add loose() method to ZodObject prototype if not exists
const ZodObjectProto = Object.getPrototypeOf(z.object({}))
if (!ZodObjectProto.loose) {
  ZodObjectProto.loose = function () {
    return this.passthrough()
  }
}

// Add returns() method to ZodFunction for synpress compatibility
// In Zod 3, z.function().args().returns() was the API
// In Zod 4, z.function() returns a different type
const zodFunction = z.function as unknown as {
  (...args: unknown[]): { returns?: (schema: unknown) => unknown }
}

// Patch the function result prototype
if (typeof z.function === 'function') {
  const originalFunction = z.function
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(z as any).function = function (...args: unknown[]) {
    const result = originalFunction.apply(this, args as Parameters<typeof originalFunction>)
    if (result && typeof result === 'object' && !('returns' in result)) {
      // Add returns method that does nothing (Zod 4 infers return type differently)
      ;(result as { returns?: (schema: unknown) => unknown }).returns = function (schema: unknown) {
        return this
      }
    }
    return result
  }
}

console.log('Zod patched with .loose() and .returns() methods')
