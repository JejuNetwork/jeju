/**
 * Agent Plugin Authentication Integration
 * Integrates authentication service with ElizaOS plugin runtime
 */

import type { IAgentRuntime, Plugin } from '@elizaos/core';
import { logger, Service } from '@elizaos/core';
import { AuthenticationService } from './AuthenticationService.js';
import { registerAuthCommands } from './CLIAuthCommands.js';

/**
 * Authentication Service for Plugin Integration
 */
export class AgentAuthService extends Service {
  capabilityDescription = 'Manages API key authentication and validation for ElizaOS services';

  private authService: AuthenticationService;

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
    if (!runtime) {
      throw new Error('Runtime is required for AgentAuthService');
    }
    this.authService = new AuthenticationService(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<AgentAuthService> {
    logger.info('Starting ElizaOS Services Authentication Service...');

    const service = new AgentAuthService(runtime);

    // Perform initial auth check
    try {
      const status = await service.authService.getAuthStatus();
      logger.info(
        `Authentication initialized: ${status.overall} (${Object.keys(status.providers).length} providers)`
      );

      if (status.overall === 'failed') {
        logger.warn('No valid API keys configured. Some plugin features may not work.');
        logger.info('Use `elizaos auth:setup` to configure API keys.');
      }
    } catch (error) {
      logger.error('Failed to initialize authentication:', error);
    }

    return service;
  }

  /**
   * Get current authentication status
   */
  async getAuthStatus() {
    return this.authService.getAuthStatus();
  }

  /**
   * Validate specific API key
   */
  async validateApiKey(provider: string, apiKey: string) {
    return this.authService.validateApiKey(provider, apiKey);
  }

  /**
   * Test API functionality
   */
  async testApiFunctionality(provider: string) {
    return this.authService.testApiFunctionality(provider);
  }

  /**
   * Check if provider is authenticated and capable
   */
  async isProviderReady(provider: string, capability?: string): Promise<boolean> {
    try {
      const status = await this.authService.getAuthStatus();
      const providerStatus = status.providers[provider];

      if (!providerStatus?.isValid) {
        return false;
      }

      if (capability && !providerStatus.capabilities.includes(capability)) {
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`Failed to check provider readiness for ${provider}:`, error);
      return false;
    }
  }

  /**
   * Get the best available provider for a capability
   */
  async getBestProvider(capability: string): Promise<string | null> {
    try {
      const status = await this.authService.getAuthStatus();

      // Find all providers that support the capability
      const availableProviders = Object.entries(status.providers)
        .filter(([_provider, result]) => result.isValid && result.capabilities.includes(capability))
        .map(([provider, _result]) => provider);

      if (availableProviders.length === 0) {
        return null;
      }

      // Prefer production keys over test keys
      const productionProviders = Object.entries(status.providers)
        .filter(
          ([provider, result]) =>
            availableProviders.includes(provider) && result.keyType === 'production'
        )
        .map(([provider, _result]) => provider);

      if (productionProviders.length > 0) {
        // Return first production provider (could add load balancing logic here)
        return productionProviders[0];
      }

      // Fall back to test providers
      return availableProviders[0];
    } catch (error) {
      logger.error(`Failed to find best provider for ${capability}:`, error);
      return null;
    }
  }

  /**
   * Validate all providers and return summary
   */
  async validateAllProviders() {
    return this.authService.validateAllProviders();
  }

  /**
   * Clear authentication cache
   */
  clearCache(): void {
    this.authService.clearCache();
  }

  /**
   * Stop the service and cleanup resources
   */
  async stop(): Promise<void> {
    this.clearCache();
    logger.info('ElizaOS Services Authentication Service stopped');
  }
}

/**
 * Plugin Integration for Authentication
 */
export const authPluginIntegration: Partial<Plugin> = {
  name: 'elizaos-services-auth-integration',
  description: 'Authentication integration for ElizaOS services',

  services: [AgentAuthService],

  init: async (config: Record<string, string>, runtime: IAgentRuntime) => {
    logger.info('Initializing ElizaOS Services Authentication Plugin...');

    // Register CLI commands if in CLI context
    if (typeof process !== 'undefined' && process.argv) {
      try {
        const commands = registerAuthCommands(runtime);
        logger.debug(`Registered ${commands.length} authentication CLI commands`);
      } catch (error) {
        logger.warn('Failed to register CLI commands:', error);
      }
    }

    // Validate configuration on startup
    const authService = new AuthenticationService(runtime);
    try {
      const validation = await authService.validateAllProviders();

      if (!validation.overall) {
        logger.warn('Authentication validation failed:', validation.summary);
        logger.info('Use `elizaos auth:setup` for configuration help');
      } else {
        logger.info('Authentication validation passed:', validation.summary);
      }
    } catch (error) {
      logger.error('Failed to validate providers on startup:', error);
    }
  },
};

/**
 * Helper functions for plugin usage
 */
export class AuthHelper {
  /**
   * Check if a provider is ready for use
   */
  static async isProviderReady(
    runtime: IAgentRuntime,
    provider: string,
    capability?: string
  ): Promise<boolean> {
    const authService = runtime.getService<AgentAuthService>('elizaos-services-auth');
    if (!authService) {
      logger.warn('Authentication service not available');
      return false;
    }

    return authService.isProviderReady(provider, capability);
  }

  /**
   * Get the best provider for a capability
   */
  static async getBestProvider(runtime: IAgentRuntime, capability: string): Promise<string | null> {
    const authService = runtime.getService<AgentAuthService>('elizaos-services-auth');
    if (!authService) {
      logger.warn('Authentication service not available');
      return null;
    }

    return authService.getBestProvider(capability);
  }

  /**
   * Validate provider before using in model calls
   */
  static async validateBeforeUse(
    runtime: IAgentRuntime,
    provider: string,
    capability: string
  ): Promise<{ isValid: boolean; error?: string }> {
    try {
      const isReady = await AuthHelper.isProviderReady(runtime, provider, capability);

      if (!isReady) {
        return {
          isValid: false,
          error: `Provider ${provider} is not ready for ${capability}. Check API key configuration.`,
        };
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get authentication status for debugging
   */
  static async getDebugInfo(runtime: IAgentRuntime): Promise<any> {
    const authService = runtime.getService<AgentAuthService>('elizaos-services-auth');
    if (!authService) {
      return { error: 'Authentication service not available' };
    }

    try {
      const status = await authService.getAuthStatus();
      return {
        overall: status.overall,
        providers: Object.keys(status.providers),
        capabilities: status.capabilities,
        lastChecked: status.lastChecked,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to get auth status',
      };
    }
  }
}
