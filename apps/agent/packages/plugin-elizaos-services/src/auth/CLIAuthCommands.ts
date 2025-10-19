/**
 * CLI Authentication Commands for ElizaOS Services
 * Provides elizaos auth commands for key management
 */

import type { IAgentRuntime } from '@elizaos/core';
import { AuthenticationService, TEST_KEYS } from './AuthenticationService.js';

export interface CLICommand {
  name: string;
  description: string;
  options?: CLIOption[];
  handler: (args: any, runtime?: IAgentRuntime) => Promise<void>;
}

export interface CLIOption {
  name: string;
  description: string;
  required?: boolean;
  type: 'string' | 'boolean';
}

/**
 * CLI Authentication Commands
 */
export class CLIAuthCommands {
  private authService: AuthenticationService;

  constructor(runtime: IAgentRuntime) {
    this.authService = new AuthenticationService(runtime);
  }

  /**
   * Get all auth-related CLI commands
   */
  getCommands(): CLICommand[] {
    return [
      {
        name: 'auth:status',
        description: 'Check authentication status for all providers',
        handler: this.handleAuthStatus.bind(this),
      },
      {
        name: 'auth:test',
        description: 'Test API functionality for all configured providers',
        handler: this.handleAuthTest.bind(this),
      },
      {
        name: 'auth:validate',
        description: 'Validate specific API key',
        options: [
          {
            name: 'provider',
            description: 'Provider name (openai, groq, anthropic)',
            required: true,
            type: 'string',
          },
          {
            name: 'key',
            description: 'API key to validate',
            required: true,
            type: 'string',
          },
        ],
        handler: this.handleAuthValidate.bind(this),
      },
      {
        name: 'auth:test-keys',
        description: 'Show available test keys for development',
        handler: this.handleTestKeys.bind(this),
      },
      {
        name: 'auth:clear-cache',
        description: 'Clear authentication cache',
        handler: this.handleClearCache.bind(this),
      },
      {
        name: 'auth:setup',
        description: 'Interactive API key setup wizard',
        handler: this.handleSetup.bind(this),
      },
    ];
  }

  /**
   * Handle auth:status command
   */
  private async handleAuthStatus(): Promise<void> {
    console.log('🔍 Checking Authentication Status...\n');

    try {
      const status = await this.authService.getAuthStatus();

      console.log(
        `📊 Overall Status: ${this.getStatusIcon(status.overall)} ${status.overall.toUpperCase()}`
      );
      console.log(`🕒 Last Checked: ${status.lastChecked.toLocaleString()}`);
      console.log(`⚡ Available Capabilities: ${status.capabilities.join(', ')}\n`);

      console.log('📋 Provider Details:');
      console.log('═'.repeat(80));

      for (const [provider, result] of Object.entries(status.providers)) {
        const icon = result.isValid ? '✅' : '❌';
        const keyType =
          result.keyType === 'test'
            ? '🧪 TEST'
            : result.keyType === 'production'
              ? '🚀 PROD'
              : '❌ INVALID';

        console.log(`${icon} ${provider.toUpperCase()}`);
        console.log(`   Type: ${keyType}`);
        console.log(`   Capabilities: ${result.capabilities.join(', ') || 'None'}`);

        if (result.errorMessage) {
          console.log(`   Error: ${result.errorMessage}`);
        }

        if (result.rateLimits) {
          console.log(`   Rate Limits: ${result.rateLimits.remaining} remaining`);
        }

        console.log('');
      }

      if (status.overall === 'failed') {
        console.log(
          '⚠️  No valid API keys configured. Use `elizaos auth:setup` to configure keys.'
        );
      } else if (status.overall === 'degraded') {
        console.log(
          '⚠️  Some providers are not configured. Consider adding more API keys for redundancy.'
        );
      } else {
        console.log('🎉 All systems operational!');
      }
    } catch (error) {
      console.error(
        '❌ Failed to check authentication status:',
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  }

  /**
   * Handle auth:test command
   */
  private async handleAuthTest(): Promise<void> {
    console.log('🧪 Testing API Functionality...\n');

    const providers = ['openai', 'groq', 'anthropic'];
    const results: { [provider: string]: any } = {};

    for (const provider of providers) {
      console.log(`Testing ${provider}...`);

      try {
        const result = await this.authService.testApiFunctionality(provider);
        results[provider] = result;

        if (result.success) {
          console.log(`✅ ${provider}: ${result.response?.substring(0, 50) || 'SUCCESS'}...`);
          console.log(`   Latency: ${result.latency}ms, Tokens: ${result.tokenUsage || 'N/A'}\n`);
        } else {
          console.log(`❌ ${provider}: ${result.error}\n`);
        }
      } catch (error) {
        console.log(
          `💥 ${provider}: Test crashed - ${error instanceof Error ? error.message : error}\n`
        );
        results[provider] = { success: false, error: 'Test crashed' };
      }
    }

    // Summary
    const successful = Object.values(results).filter((r) => r.success).length;
    const total = Object.keys(results).length;

    console.log('═'.repeat(50));
    console.log(`📊 Test Results: ${successful}/${total} providers working`);

    if (successful === total) {
      console.log('🎉 All API tests passed!');
    } else if (successful > 0) {
      console.log('⚠️  Some APIs are not working. Check your configuration.');
    } else {
      console.log('❌ No APIs are working. Please check your API keys.');
    }
  }

  /**
   * Handle auth:validate command
   */
  private async handleAuthValidate(args: { provider: string; key: string }): Promise<void> {
    console.log(`🔍 Validating ${args.provider} API key...\n`);

    try {
      const result = await this.authService.validateApiKey(args.provider, args.key);

      if (result.isValid) {
        console.log('✅ API Key Valid');
        console.log(`   Provider: ${result.provider}`);
        console.log(`   Type: ${result.keyType}`);
        console.log(`   Capabilities: ${result.capabilities.join(', ')}`);

        if (result.rateLimits) {
          console.log(`   Rate Limits: ${result.rateLimits.remaining} remaining`);
        }
      } else {
        console.log('❌ API Key Invalid');
        console.log(`   Error: ${result.errorMessage || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('❌ Validation failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  /**
   * Handle auth:test-keys command
   */
  private async handleTestKeys(): Promise<void> {
    console.log('🧪 Available Test Keys for Development\n');
    console.log('═'.repeat(60));
    console.log('These keys are safe for development and testing:');
    console.log('');

    for (const [name, key] of Object.entries(TEST_KEYS)) {
      const provider = name.replace('_TEST_KEY', '').toLowerCase();
      console.log(`${provider.toUpperCase()}:`);
      console.log(`  Key: ${key}`);
      console.log(`  Usage: export ${name.replace('_TEST_KEY', '_API_KEY')}="${key}"`);
      console.log('');
    }

    console.log('💡 Test keys provide simulated responses without real API costs.');
    console.log('💡 Use them for development, testing, and CI/CD pipelines.');
  }

  /**
   * Handle auth:clear-cache command
   */
  private async handleClearCache(): Promise<void> {
    console.log('🧹 Clearing authentication cache...');

    this.authService.clearCache();

    console.log('✅ Authentication cache cleared.');
    console.log('💡 Next validation calls will perform fresh API checks.');
  }

  /**
   * Handle auth:setup command (Interactive wizard)
   */
  private async handleSetup(): Promise<void> {
    console.log('🚀 ElizaOS Services API Key Setup Wizard\n');
    console.log('This wizard will help you configure API keys for all providers.');
    console.log('═'.repeat(70));

    const providers = [
      {
        name: 'OpenAI',
        envVar: 'OPENAI_API_KEY',
        description: 'Required for text generation, embeddings, and image description',
        getUrl: 'https://platform.openai.com/account/api-keys',
      },
      {
        name: 'Groq',
        envVar: 'GROQ_API_KEY',
        description: 'Optional for fast text generation with Llama models',
        getUrl: 'https://console.groq.com/keys',
      },
      {
        name: 'Anthropic',
        envVar: 'ANTHROPIC_API_KEY',
        description: 'Optional for Claude text generation and image description',
        getUrl: 'https://console.anthropic.com/account/keys',
      },
    ];

    console.log('\n📋 Provider Information:');
    console.log('');

    for (const provider of providers) {
      console.log(`${provider.name}:`);
      console.log(`  Environment Variable: ${provider.envVar}`);
      console.log(`  Description: ${provider.description}`);
      console.log(`  Get API Key: ${provider.getUrl}`);
      console.log('');
    }

    console.log('💡 Setup Instructions:');
    console.log('1. Get API keys from the URLs above');
    console.log('2. Add them to your .env file:');
    console.log('   OPENAI_API_KEY=sk-...');
    console.log('   GROQ_API_KEY=gsk_...');
    console.log('   ANTHROPIC_API_KEY=sk-ant-...');
    console.log('3. Run `elizaos auth:status` to verify configuration');
    console.log('');

    console.log('🧪 For Development/Testing:');
    console.log('Use `elizaos auth:test-keys` to see test keys that work without real API costs.');
  }

  /**
   * Get status icon for overall status
   */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'healthy':
        return '✅';
      case 'degraded':
        return '⚠️';
      case 'failed':
        return '❌';
      default:
        return '❓';
    }
  }
}

/**
 * Export CLI command registration function
 */
export function registerAuthCommands(runtime: IAgentRuntime): CLICommand[] {
  const authCommands = new CLIAuthCommands(runtime);
  return authCommands.getCommands();
}
