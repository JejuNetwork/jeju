/// <reference types="cypress" />

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Cypress plugin configuration for Ollama testing
 */
export default (on: Cypress.PluginEvents, config: Cypress.PluginConfig) => {
  // Task for executing shell commands
  on('task', {
    async exec(command: string) {
      const { stdout, stderr } = await execAsync(command);
      return { stdout, stderr, success: true };
    },

    async cleanupTestEnvironment() {
      console.log('🧹 Cleaning up test environment...');

      // Stop any test Ollama containers
      await execAsync('podman stop ollama-test-container 2>/dev/null || true');
      await execAsync('podman rm ollama-test-container 2>/dev/null || true');

      // Clean up temporary files
      await execAsync('rm -rf /tmp/ollama-test-* 2>/dev/null || true');

      // Reset any test configuration
      await execAsync('rm -f ./data/.test-config 2>/dev/null || true');

      console.log('✅ Test environment cleaned');
      return { success: true };
    },

    async clearConfiguration() {
      console.log('🧹 Clearing test configuration...');

      // Remove .env temporarily for first-run testing
      await execAsync('mv .env .env.backup 2>/dev/null || true');

      // Remove setup completion marker
      await execAsync('rm -f ./data/.setup-complete 2>/dev/null || true');

      console.log('✅ Configuration cleared');
      return { success: true };
    },

    async restoreConfiguration() {
      console.log('🔄 Restoring configuration...');

      // Restore .env if it was backed up
      await execAsync('mv .env.backup .env 2>/dev/null || true');

      console.log('✅ Configuration restored');
      return { success: true };
    },

    async checkOllamaHealth() {
      console.log('🏥 Checking Ollama health...');

      const { stdout } = await execAsync('curl -s http://localhost:11434/api/version');
      const version = JSON.parse(stdout);

      console.log('✅ Ollama is healthy:', version);
      return { healthy: true, version };
    },

    async checkPodmanAvailable() {
      console.log('🔍 Checking if Podman is available...');

      await execAsync('podman --version');
      console.log('✅ Podman is available');
      return { available: true };
    },

    async setupTestOllama() {
      console.log('🚀 Setting up test Ollama instance...');

      // Pull a small model for testing
      const { stdout, stderr } = await execAsync(
        'ollama pull llama3.2:3b',
        { timeout: 300000 } // 5 minutes timeout
      );

      console.log('✅ Test Ollama model ready');
      return { success: true, stdout, stderr };
    },

    async generateTestData() {
      console.log('📊 Generating test data...');

      const testData = {
        timestamp: Date.now(),
        testId: `test-${Math.random().toString(36).substring(7)}`,
        ollamaConfig: {
          model: 'llama3.2:3b',
          url: 'http://localhost:11434',
        },
      };

      return testData;
    },

    log(message: string) {
      console.log(`[CYPRESS LOG] ${message}`);
      return null;
    },
  });

  // Return a new config object with our settings
  const configWithEnv = config as any;
  return {
    ...config,
    defaultCommandTimeout: 30000,
    pageLoadTimeout: 60000,
    requestTimeout: 30000,
    responseTimeout: 30000,
    video: true,
    screenshotOnRunFailure: true,
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',
    env: {
      ...(configWithEnv.env || {}),
      BACKEND_URL: configWithEnv.env?.BACKEND_URL || 'http://localhost:7777',
      FRONTEND_URL: configWithEnv.env?.FRONTEND_URL || 'http://localhost:1420',
    },
    retries: {
      runMode: 2,
      openMode: 1,
    },
  };
};
