/**
 * Error handling middleware for fail-fast validation errors
 */

import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

export async function errorHandler(c: Context, next: Next): Promise<Response | void> {
  try {
    return await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    
    const message = error instanceof Error ? error.message : 'Internal server error';
    const lowerMessage = message.toLowerCase();
    
    // Check for auth-related errors (401) - check header validation failures
    const isAuthError = lowerMessage.includes('x-jeju-address') 
      || lowerMessage.includes('authentication')
      || lowerMessage.includes('x-jeju-signature')
      || lowerMessage.includes('x-jeju-nonce');
    
    // Check for not found errors (404)
    const isNotFound = lowerMessage.includes('not found');
    
    // Check for permission errors (403)
    const isForbidden = lowerMessage.includes('access denied') 
      || lowerMessage.includes('permission')
      || lowerMessage.includes('not authorized');
    
    // Check for validation/bad request errors (400)
    const isBadRequest = lowerMessage.includes('invalid')
      || lowerMessage.includes('required')
      || lowerMessage.includes('validation failed')
      || lowerMessage.includes('expected')
      || lowerMessage.includes('no version data')
      || lowerMessage.includes('no attachment');
    
    const statusCode = isAuthError ? 401
      : isNotFound ? 404
      : isForbidden ? 403
      : isBadRequest ? 400
      : 500;
    
    return c.json({ error: message }, statusCode);
  }
}
