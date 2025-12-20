/**
 * Preload script to patch zod with .loose() method
 * This is needed because @elizaos/core v1.6.x uses zod's .loose() method
 * which only exists in zod v4, but it's bundled with an older version.
 */

import { z } from 'zod';

// Add .loose() method to ZodObject if it doesn't exist
const ZodObjectProto = Object.getPrototypeOf(z.object({}));
if (!ZodObjectProto.loose) {
  ZodObjectProto.loose = function() {
    return this.passthrough();
  };
}

export {};

