/**
 * Zod 4 Compatibility Layer
 *
 * Patches Zod to add backwards-compatible methods for packages
 * expecting Zod 3 API (like synpress).
 *
 * Must be imported BEFORE any code that uses Zod 3 API.
 *
 * Usage:
 * ```typescript
 * import '@jejunetwork/tests/zod-compat' // First import
 * import { testWithSynpress } from '@synthetixio/synpress'
 * ```
 */

import { z } from 'zod'

// Get the ZodFunction class prototype
const testFn = z.function()
const ZodFunctionProto = Object.getPrototypeOf(testFn)

// Add .returns() method for Zod 3 compatibility
if (!ZodFunctionProto.returns) {
  ZodFunctionProto.returns = function <T extends z.ZodTypeAny>(_returnType: T) {
    // In Zod 4, we create a new function schema with the return type
    // For compatibility, we just return self since Zod 4 handles returns differently
    return this
  }
}

// Add .args() method for Zod 3 compatibility if not present
if (!ZodFunctionProto.args) {
  ZodFunctionProto.args = function <T extends z.ZodTuple>(
    ..._items: T extends z.ZodTuple<infer Items> ? Items : never[]
  ) {
    return this
  }
}

// Add .implement() method for Zod 3 compatibility
if (!ZodFunctionProto.implement) {
  ZodFunctionProto.implement = <F extends (...args: never[]) => unknown>(
    fn: F,
  ): F => fn
}

// Add .loose() method to ZodObject for @elizaos/core compatibility
const ZodObjectProto = Object.getPrototypeOf(z.object({}))
if (!ZodObjectProto.loose) {
  ZodObjectProto.loose = function () {
    return this.passthrough()
  }
}
