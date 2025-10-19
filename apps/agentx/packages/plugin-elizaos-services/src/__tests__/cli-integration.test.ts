/**
 * CLI Integration Tests for Authentication System
 * Tests actual CLI command execution with real environment
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtemp, writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '@elizaos/core';

interface TestEnvironment {
  tempDir: string;
  envFile: string;
  originalEnv: NodeJS.ProcessEnv;
}

/**
 * Create a test environment with temporary directory and .env file
 */
async function createTestEnvironment(withTestKeys = true): Promise<TestEnvironment> {
  const tempDir = await mkdtemp(join(tmpdir(), 'eliza-auth-cli-test-'));
  const envFile = join(tempDir, '.env');

  // Store original environment
  const originalEnv = { ...process.env };

  if (withTestKeys) {
    const envContent = `
OPENAI_API_KEY="sk-test-elizaos-openai-key-for-development-only"
GROQ_API_KEY="gsk_test-elizaos-groq-key-for-development-only"
ANTHROPIC_API_KEY="sk-ant-test-elizaos-anthropic-key-for-development-only"
NODE_ENV="test"
LOG_LEVEL="error"
`.trim();

    await writeFile(envFile, envContent);
  }

  return { tempDir, envFile, originalEnv };
}

/**
 * Cleanup test environment
 */
async function cleanupTestEnvironment(env: TestEnvironment): Promise<void> {
  try {
    await unlink(env.envFile).catch(() => {}); // Ignore errors if file doesn't exist

    // Restore original environment
    process.env = env.originalEnv;
  } catch (error) {
    logger.warn('Error during test environment cleanup:', error);
  }
}

/**
 * Execute CLI command with test environment
 */
function execCLICommand(command: string, env: TestEnvironment): string {
  try {
    // Build the full CLI path - adjust this to your actual CLI location
    const cliPath = join(__dirname, '../../../cli/dist/index.js');
    const fullCommand = `bun "${cliPath}" ${command}`;

    return execSync(fullCommand, {
      encoding: 'utf8',
      cwd: env.tempDir,
      env: {
        ...env.originalEnv,
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
      },
      timeout: 30000, // 30 second timeout
      stdio: 'pipe',
    });
  } catch (error: any) {
    // Return the output even if command failed (for testing error cases)
    return error.stdout || error.stderr || error.message;
  }
}

describe('CLI Authentication Integration', () => {
  let testEnv: TestEnvironment;

  afterEach(async () => {
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
    }
  });

  describe('auth providers status', () => {
    it('should show provider status with test keys', async () => {
      testEnv = await createTestEnvironment(true);

      const output = execCLICommand('auth providers status', testEnv);

      expect(output).toContain('AI Providers Authentication Status');
      expect(output).toContain('OPENAI');
      expect(output).toContain('GROQ');
      expect(output).toContain('ANTHROPIC');
      expect(output).toContain('TEST'); // Should show test key types
    });

    it('should show failed status without API keys', async () => {
      testEnv = await createTestEnvironment(false);

      const output = execCLICommand('auth providers status', testEnv);

      expect(output).toContain('AI Providers Authentication Status');
      expect(output.toUpperCase()).toContain('FAILED');
      expect(output).toContain('not configured');
    });

    it('should provide helpful recommendations', async () => {
      testEnv = await createTestEnvironment(false);

      const output = execCLICommand('auth providers status', testEnv);

      expect(output).toContain('setup');
    });
  });

  describe('auth providers test', () => {
    it('should test all providers with test keys', async () => {
      testEnv = await createTestEnvironment(true);

      const output = execCLICommand('auth providers test', testEnv);

      expect(output).toContain('AI Provider Functionality Test');
      expect(output).toContain('openai');
      expect(output).toContain('groq');
      expect(output.toUpperCase()).toContain('SUCCESS');
    });

    it('should test specific provider', async () => {
      testEnv = await createTestEnvironment(true);

      const output = execCLICommand('auth providers test --provider openai', testEnv);

      expect(output).toContain('openai');
      expect(output).not.toContain('groq'); // Should not test other providers
    });

    it('should handle invalid provider gracefully', async () => {
      testEnv = await createTestEnvironment(true);

      const output = execCLICommand('auth providers test --provider invalid', testEnv);

      expect(output.toLowerCase()).toContain('invalid');
    });

    it('should fail tests without API keys', async () => {
      testEnv = await createTestEnvironment(false);

      const output = execCLICommand('auth providers test', testEnv);

      expect(output.toLowerCase()).toContain('not configured');
    });
  });

  describe('auth providers keys', () => {
    it('should display test keys information', async () => {
      testEnv = await createTestEnvironment(false);

      const output = execCLICommand('auth providers keys', testEnv);

      expect(output).toContain('Development Test Keys');
      expect(output).toContain('sk-test-elizaos-openai-key-for-development-only');
      expect(output).toContain('gsk_test-elizaos-groq-key-for-development-only');
      expect(output).toContain('sk-ant-test-elizaos-anthropic-key-for-development-only');
      expect(output).toContain('export OPENAI_API_KEY');
    });

    it('should provide usage instructions', async () => {
      testEnv = await createTestEnvironment(false);

      const output = execCLICommand('auth providers keys', testEnv);

      expect(output).toContain('export');
      expect(output).toContain('simulated responses');
      expect(output).toContain('development');
    });
  });

  describe('auth providers setup', () => {
    it('should show setup information', async () => {
      testEnv = await createTestEnvironment(false);

      // Note: This is a non-interactive test, so we can't test full interactive setup
      // But we can test that the setup command starts correctly
      const output = execCLICommand('auth providers setup', testEnv);

      expect(output).toContain('setup');
    });

    it('should display provider information', async () => {
      testEnv = await createTestEnvironment(false);

      const output = execCLICommand('auth providers setup', testEnv);

      expect(output).toContain('OpenAI');
      expect(output).toContain('Groq');
      expect(output).toContain('Anthropic');
    });
  });

  describe('Integration with main auth command', () => {
    it('should work as subcommand of auth', async () => {
      testEnv = await createTestEnvironment(true);

      // Test that providers is properly integrated as subcommand
      const output = execCLICommand('auth providers status', testEnv);

      expect(output).toContain('Authentication Status');
      expect(output).not.toContain('Command not found');
      expect(output).not.toContain('Unknown command');
    });

    it('should show help for providers subcommand', async () => {
      testEnv = await createTestEnvironment(false);

      const output = execCLICommand('auth providers --help', testEnv);

      expect(output).toContain('providers');
      expect(output).toContain('status');
      expect(output).toContain('setup');
      expect(output).toContain('test');
      expect(output).toContain('keys');
    });

    it('should maintain consistency with main auth command', async () => {
      testEnv = await createTestEnvironment(true);

      // Both should work and not conflict
      const authOutput = execCLICommand('auth status', testEnv);
      const providersOutput = execCLICommand('auth providers status', testEnv);

      expect(authOutput).not.toContain('error');
      expect(providersOutput).not.toContain('error');

      // They should be different outputs (one for platform auth, one for providers)
      expect(authOutput).not.toBe(providersOutput);
    });
  });

  describe('Error Handling', () => {
    it('should handle CLI errors gracefully', async () => {
      testEnv = await createTestEnvironment(false);

      // Test with invalid command
      const output = execCLICommand('auth providers invalid-command', testEnv);

      expect(output.toLowerCase()).toMatch(/error|invalid|unknown/);
    });

    it('should provide helpful error messages', async () => {
      testEnv = await createTestEnvironment(false);

      // Test status when no keys configured
      const output = execCLICommand('auth providers status', testEnv);

      expect(output.toLowerCase()).toMatch(/no valid api keys|not configured/);
      expect(output).toContain('setup'); // Should suggest setup
    });

    it('should handle timeout gracefully', async () => {
      testEnv = await createTestEnvironment(true);

      // This should complete within timeout
      const startTime = Date.now();
      const output = execCLICommand('auth providers status', testEnv);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(25000); // Should complete within 25 seconds
      expect(output).toBeDefined();
    });
  });

  describe('Environment File Integration', () => {
    it('should read API keys from .env file', async () => {
      testEnv = await createTestEnvironment(true);

      const output = execCLICommand('auth providers status', testEnv);

      // Should detect the test keys from .env file
      expect(output).toContain('TEST');
      expect(output).not.toContain('not configured');
    });

    it('should handle missing .env file', async () => {
      testEnv = await createTestEnvironment(false);

      const output = execCLICommand('auth providers status', testEnv);

      // Should work even without .env file
      expect(output).toContain('AI Providers Authentication Status');
      expect(output.toLowerCase()).toContain('not configured');
    });

    it('should work with partial .env configuration', async () => {
      testEnv = await createTestEnvironment(false);

      // Create partial .env with only OpenAI key
      const partialEnv = 'OPENAI_API_KEY="sk-test-elizaos-openai-key-for-development-only"';
      await writeFile(testEnv.envFile, partialEnv);

      const output = execCLICommand('auth providers status', testEnv);

      expect(output.toUpperCase()).toContain('DEGRADED');
      expect(output).toContain('OPENAI');
    });
  });

  describe('Performance', () => {
    it('should execute status check within reasonable time', async () => {
      testEnv = await createTestEnvironment(true);

      const startTime = Date.now();
      const output = execCLICommand('auth providers status', testEnv);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
      expect(output).toContain('Status');
    });

    it('should handle concurrent commands', async () => {
      testEnv = await createTestEnvironment(true);

      // This is a basic test - in practice you'd want more sophisticated concurrency testing
      const output1 = execCLICommand('auth providers status', testEnv);
      const output2 = execCLICommand('auth providers keys', testEnv);

      expect(output1).toContain('Status');
      expect(output2).toContain('Test Keys');
    });
  });
});
