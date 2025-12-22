/**
 * MCP Agent Authentication
 *
 * Handles authentication for MCP requests using API keys or other methods
 */

import type { AuthenticatedAgent, MCPAuthContext } from '../types/mcp'
import type { ApiKeyValidator } from './api-key-auth'
import { defaultApiKeyValidator } from './api-key-auth'

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
 * Provides a flexible authentication system that can be configured
 * with different validators.
 */
export class AgentAuthenticator {
  private apiKeyValidator: ApiKeyValidator

  constructor(apiKeyValidator: ApiKeyValidator = defaultApiKeyValidator) {
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
      agentId: validationResult.agentId || validationResult.userId,
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
 * Default authenticator instance
 */
export const defaultAuthenticator = new AgentAuthenticator()

/**
 * Authenticate agent using default authenticator
 *
 * @param auth - Authentication options
 * @returns Authenticated agent or null
 */
export async function authenticateAgent(
  auth: AuthOptions,
): Promise<AuthenticatedAgent | null> {
  return defaultAuthenticator.authenticate(auth)
}

/**
 * Configure the default authenticator with a custom API key validator
 *
 * @param validator - API key validator function
 */
export function configureAuthentication(validator: ApiKeyValidator): void {
  defaultAuthenticator.setApiKeyValidator(validator)
}
