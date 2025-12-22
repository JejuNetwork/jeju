// Patch zod to add .loose() method for @elizaos/core compatibility
import { z } from 'zod'

// Add loose() method to ZodObject prototype if not exists
const ZodObjectProto = Object.getPrototypeOf(z.object({}))
if (!ZodObjectProto.loose) {
  ZodObjectProto.loose = function () {
    return this.passthrough()
  }
}

console.log('Zod patched with .loose() method')
