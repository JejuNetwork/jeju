/**
 * Agent authentication for MCP requests.
 */

import type { AuthenticatedAgent, MCPAuthContext } from '../types/mcp'
import type { ApiKeyValidator } from './api-key-auth'

/**
 * Authentication options
 */
export interface AuthOptions {
  apiKey?: string
  userId?: string
}

/**
 * Agent authenticator class
 *
 * Requires a validator to be configured - no stub defaults.
 */
export class AgentAuthenticator {
  private apiKeyValidator: ApiKeyValidator

  constructor(apiKeyValidator: ApiKeyValidator) {
    this.apiKeyValidator = apiKeyValidator
  }

  /**
   * Set the API key validator
   */
  setApiKeyValidator(validator: ApiKeyValidator): void {
    this.apiKeyValidator = validator
  }

  /**
   * Authenticate agent from auth options
   *
   * @param auth - Authentication options (API key, etc.)
   * @returns Authenticated agent or null if authentication fails
   */
  async authenticate(auth: AuthOptions): Promise<AuthenticatedAgent | null> {
    if (!auth.apiKey) {
      return null
    }

    const validationResult = await this.apiKeyValidator(auth.apiKey)

    if (!validationResult) {
      return null
    }

    return {
      userId: validationResult.userId,
      agentId: validationResult.agentId,
    }
  }

  /**
   * Authenticate from MCP auth context
   *
   * @param context - MCP authentication context
   * @returns Authenticated agent or null if authentication fails
   */
  async authenticateFromContext(
    context: MCPAuthContext,
  ): Promise<AuthenticatedAgent | null> {
    return this.authenticate({
      apiKey: context.apiKey,
      userId: context.userId,
    })
  }
}

/**
 * Create an authenticator with the given validator
 *
 * @param validator - API key validator function
 * @returns Configured authenticator instance
 */
export function createAuthenticator(
  validator: ApiKeyValidator,
): AgentAuthenticator {
  return new AgentAuthenticator(validator)
}
