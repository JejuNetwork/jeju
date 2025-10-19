/**
 * ElizaOS Services Authentication System
 * Comprehensive API key management and validation across all modalities
 */

// Core Authentication Components
export {
  AuthenticationService,
  TEST_KEYS,
  type ApiKeyValidationResult,
  type AuthStatus,
} from './AuthenticationService.ts';

// CLI Interface
export {
  CLIAuthCommands,
  registerAuthCommands,
  type CLICommand,
  type CLIOption,
} from './CLIAuthCommands.ts';

// GUI Interface - commented out for testing environment compatibility
// export { AuthenticationPanel, default as AuthPanel } from './AuthenticationPanel.tsx';

// Agent Plugin Integration
export { AgentAuthService, AuthHelper, authPluginIntegration } from './AgentPluginAuth.ts';

// Platform Integration
export {
  PlatformIntegrationService,
  PlatformIntegrationFactory,
  PlatformAuthUtils,
  type PlatformAuthConfig,
  type ClientSession,
  type KeyDistributionRequest,
  type KeyDistributionResponse,
} from './PlatformIntegration.ts';

// Demo and Testing
export {
  runComprehensiveDemo,
  demoCLIAuthentication,
  demoAgentPluginAuthentication,
  demoPlatformIntegration,
  demoSuccessAndFailureScenarios,
} from './demo-auth-system.ts';

/**
 * Quick setup helper for common authentication tasks
 */
export class QuickAuthSetup {
  /**
   * Initialize authentication for CLI usage
   */
  static async initializeForCLI(runtime: any) {
    const { registerAuthCommands } = await import('./CLIAuthCommands.ts');
    return registerAuthCommands(runtime);
  }

  /**
   * Initialize authentication for Agent plugin
   */
  static async initializeForAgent(runtime: any) {
    const { AgentAuthService } = await import('./AgentPluginAuth.ts');
    const service = await AgentAuthService.start(runtime);
    runtime.registerService(service);
    return service;
  }

  /**
   * Initialize authentication for GUI
   */
  static async initializeForGUI(runtime: any) {
    const { PlatformIntegrationFactory } = await import('./PlatformIntegration.ts');
    return PlatformIntegrationFactory.createForGUI(runtime);
  }

  /**
   * Quick validation check
   */
  static async quickValidation(_runtime: any) {
    const { AuthenticationService } = await import('./AuthenticationService.ts');
    const authService = new AuthenticationService(_runtime);
    return authService.validateAllProviders();
  }

  /**
   * Get test keys for development
   */
  static getTestKeys() {
    return ImportedTestKeys;
  }
}

/**
 * Authentication status checker utility
 */
export class AuthStatusChecker {
  /**
   * Check if system is ready for production
   */
  static async isProductionReady(_runtime: any): Promise<{
    ready: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const { AuthenticationService } = await import('./AuthenticationService.ts');
    const authService = new AuthenticationService(_runtime);

    try {
      const status = await authService.getAuthStatus();
      const issues: string[] = [];
      const recommendations: string[] = [];

      // Check overall status
      if (status.overall === 'failed') {
        issues.push('No valid API keys configured');
        recommendations.push('Run `elizaos auth:setup` to configure API keys');
      } else if (status.overall === 'degraded') {
        issues.push('Some providers are not configured');
        recommendations.push('Consider adding more API keys for redundancy');
      }

      // Check for test keys in production
      const testKeyProviders = Object.entries(status.providers)
        .filter(([_, result]) => result.keyType === 'test')
        .map(([provider, _]) => provider);

      if (testKeyProviders.length > 0) {
        issues.push(`Test keys detected for: ${testKeyProviders.join(', ')}`);
        recommendations.push('Replace test keys with production keys for live deployment');
      }

      // Check essential capabilities
      const hasEmbeddings = status.capabilities.includes('embeddings');
      if (!hasEmbeddings) {
        issues.push('No embedding capability available');
        recommendations.push('Configure OpenAI API key for embedding support');
      }

      return {
        ready: issues.length === 0,
        issues,
        recommendations,
      };
    } catch (_error) {
      return {
        ready: false,
        issues: ['Failed to check authentication status'],
        recommendations: ['Check system configuration and try again'],
      };
    }
  }

  /**
   * Get detailed system health report
   */
  static async getHealthReport(_runtime: any) {
    const { AuthenticationService } = await import('./AuthenticationService.ts');
    const authService = new AuthenticationService(_runtime);

    try {
      const status = await authService.getAuthStatus();
      const validation = await authService.validateAllProviders();

      return {
        timestamp: new Date().toISOString(),
        overall: status.overall,
        summary: validation.summary,
        providers: status.providers,
        capabilities: status.capabilities,
        lastChecked: status.lastChecked,
        healthScore: this.calculateHealthScore(status),
      };
    } catch (error) {
      return {
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        overall: 'failed',
        healthScore: 0,
      };
    }
  }

  /**
   * Calculate a health score (0-100) based on auth status
   */
  private static calculateHealthScore(status: any): number {
    const totalProviders = Object.keys(status.providers).length;
    const validProviders = Object.values(status.providers).filter((p: any) => p.isValid).length;
    const productionProviders = Object.values(status.providers).filter(
      (p: any) => p.keyType === 'production'
    ).length;

    let score = 0;

    // Base score from valid providers
    score += (validProviders / totalProviders) * 60;

    // Bonus for production keys
    score += (productionProviders / totalProviders) * 30;

    // Bonus for essential capabilities
    if (status.capabilities.includes('text_generation')) {
      score += 5;
    }
    if (status.capabilities.includes('embeddings')) {
      score += 5;
    }

    return Math.round(Math.min(100, score));
  }
}

// Import the classes for default export
import { AuthenticationService, TEST_KEYS as ImportedTestKeys } from './AuthenticationService.ts';
import { CLIAuthCommands } from './CLIAuthCommands.ts';
import { AuthenticationPanel } from './AuthenticationPanel.tsx';
import { AgentAuthService, AuthHelper } from './AgentPluginAuth.ts';
import { PlatformIntegrationService } from './PlatformIntegration.ts';

// Default export for convenience
export default {
  AuthenticationService,
  CLIAuthCommands,
  AuthenticationPanel,
  AgentAuthService,
  AuthHelper,
  PlatformIntegrationService,
  QuickAuthSetup,
  AuthStatusChecker,
  TEST_KEYS: ImportedTestKeys,
};
