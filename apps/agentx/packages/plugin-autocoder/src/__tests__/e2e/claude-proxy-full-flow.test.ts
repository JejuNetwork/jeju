import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { AgentRuntime, type IAgentRuntime, type UUID } from '@elizaos/core';
import { autocoderPlugin } from '../../index';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { promises as fs } from 'fs';
// Import required plugins
import sqlPlugin from '@elizaos/plugin-sql';
import formsPlugin from '@elizaos/plugin-forms';
import inferencePlugin from '@elizaos/plugin-inference';
import openaiPlugin from '@elizaos/plugin-openai';

describe('Claude Proxy Full Flow Tests', () => {
  let runtime: IAgentRuntime;
  let testProjectsDir: string;

  beforeAll(async () => {
    // Create test projects directory
    testProjectsDir = path.join(process.cwd(), '.test-generated-plugins-claude-proxy');
    await fs.mkdir(testProjectsDir, { recursive: true });

    // Set up test environment
    process.env.FORCE_BUNSQLITE = 'true';
    process.env.DATABASE_PATH = './.eliza/.test-claude-proxy';
    process.env.ELIZA_TEST_MODE = 'true';
    process.env.SECRET_SALT = process.env.SECRET_SALT || 'test-salt-for-testing-only-not-secure';

    // Initialize runtime
    runtime = new AgentRuntime({
      agentId: uuidv4() as UUID,
      character: {
        name: 'Test Agent',
        bio: ['Test agent for claude proxy integration'],
        system: 'You are a helpful assistant',
        settings: {
          // Enable claude proxy mode
          USE_CLAUDE_PROXY: 'true',
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'test-key',
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
        },
      },
    });

    // Register required plugins in correct order
    await runtime.registerPlugin(sqlPlugin);
    await runtime.registerPlugin(inferencePlugin);
    await runtime.registerPlugin(openaiPlugin);
    await runtime.registerPlugin(formsPlugin);
    await runtime.registerPlugin(autocoderPlugin);

    // Initialize runtime
    await runtime.initialize();
  });

  it('should complete full project generation flow with status updates', async () => {
    const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    // Get services
    const codeGenService = runtime.getService('code-generation');
    const statusManager = runtime.getService('project-status-manager') as any;

    expect(codeGenService).toBeDefined();
    expect(statusManager).toBeDefined();

    // Subscribe to status updates
    const statusUpdates: any[] = [];
    statusManager.on('update', (update: any) => {
      statusUpdates.push(update);
      console.log(`Status Update: ${update.status} - ${update.message}`);
    });

    // Create project request
    const request = {
      projectName: 'test-full-flow-plugin',
      description: 'A plugin that demonstrates the full autocoder flow',
      targetType: 'plugin' as const,
      requirements: [
        'Create an action that greets users by name',
        'Include a provider that shows current time',
        'Add proper TypeScript types',
        'Include comprehensive tests',
      ],
      apis: [],
      testScenarios: [
        'Should greet user with provided name',
        'Should show current time in provider',
      ],
    };

    // Generate project
    const result = await (codeGenService as any).generateCode(request);

    // Verify result
    expect(result.success).toBe(true);
    expect(result.projectPath).toBeDefined();
    expect(result.files).toBeDefined();
    expect(result.files.length).toBeGreaterThan(0);

    // Verify status updates were sent
    expect(statusUpdates.length).toBeGreaterThan(0);

    // Check for key status transitions
    const statuses = statusUpdates.map((u) => u.status);
    expect(statuses).toContain('planning');
    expect(statuses).toContain('generating');
    expect(statuses).toContain('testing');
    expect(statuses).toContain('completed');

    // Verify project files
    const projectPath = result.projectPath;

    // Check essential files
    const essentialFiles = [
      'package.json',
      'src/index.ts',
      'tsconfig.json',
      'README.md',
      'PRD.json',
    ];

    for (const file of essentialFiles) {
      const filePath = path.join(projectPath, file);
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    }

    // Verify PRD was generated
    const prdPath = path.join(projectPath, 'PRD.json');
    const prdContent = await fs.readFile(prdPath, 'utf-8');
    const prd = JSON.parse(prdContent);

    expect(prd.title).toBeDefined();
    expect(prd.architecture).toBeDefined();
    expect(prd.architecture.approach).toMatch(/^(clone-existing|extend-existing|new-plugin)$/);

    // Check validation results
    if (result.executionResults) {
      console.log('Validation Results:');
      console.log(`  Lint: ${result.executionResults.lintPass ? '✅' : '❌'}`);
      console.log(`  Types: ${result.executionResults.typesPass ? '✅' : '❌'}`);
      console.log(`  Tests: ${result.executionResults.testsPass ? '✅' : '❌'}`);
      console.log(`  Build: ${result.executionResults.buildPass ? '✅' : '❌'}`);
    }
  });

  it('should use Claude proxy when configured with OpenAI', async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping test - no OpenAI API key');
      return;
    }

    // Get inference service to test proxy
    const inferenceService = runtime.getService('inference') as any;
    expect(inferenceService).toBeDefined();

    // Test that Claude requests are proxied through OpenAI
    const response = await runtime.useModel('text_large', {
      prompt: 'Generate a simple TypeScript function that adds two numbers',
      temperature: 0.7,
      max_tokens: 200,
    });

    expect(response).toBeDefined();
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  });

  it('should handle research model type correctly', async () => {
    const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    const codeGenService = runtime.getService('code-generation');

    // Test project that triggers research
    const request = {
      projectName: 'test-research-integration',
      description: 'A plugin that integrates with multiple APIs',
      targetType: 'plugin' as const,
      requirements: [
        'Integrate with GitHub API for issue tracking',
        'Use OpenAI for text generation',
        'Implement caching with Redis',
      ],
      apis: ['GitHub', 'OpenAI', 'Redis'],
      testScenarios: ['Test API integrations'],
    };

    // This should trigger research phase
    const result = await (codeGenService as any).generateCode(request);

    expect(result.success).toBe(true);

    // Check if PRD includes research findings
    const prdPath = path.join(result.projectPath, 'PRD.json');
    const prdContent = await fs.readFile(prdPath, 'utf-8');
    const prd = JSON.parse(prdContent);

    // PRD should include API keys based on research
    expect(prd.apiKeys).toBeDefined();
    expect(prd.apiKeys.length).toBeGreaterThan(0);
  });

  it('should track project history correctly', async () => {
    const statusManager = runtime.getService('project-status-manager') as any;

    // Get current summary
    const summary = statusManager.getStatusSummary();
    expect(summary).toBeDefined();
    expect(summary.active).toBeGreaterThanOrEqual(0);
    expect(summary.completed).toBeGreaterThanOrEqual(0);

    // Get project history
    const history = statusManager.getHistory();
    expect(Array.isArray(history)).toBe(true);

    // If we've run previous tests, we should have some history
    if (history.length > 0) {
      const project = history[0];
      expect(project.id).toBeDefined();
      expect(project.name).toBeDefined();
      expect(project.status).toMatch(/^(completed|failed)$/);
      expect(project.startedAt).toBeDefined();
    }
  });

  it('should handle API key validation correctly', async () => {
    const codeGenService = runtime.getService('code-generation');

    // Test project requiring specific API key
    const request = {
      projectName: 'test-api-key-validation',
      description: 'A plugin that requires specific API keys',
      targetType: 'plugin' as const,
      requirements: ['Use Stripe API for payments'],
      apis: ['Stripe'],
      testScenarios: ['Test payment processing'],
    };

    // This should fail if STRIPE_API_KEY is not set
    const result = await (codeGenService as any).generateCode(request);

    if (!runtime.getSetting('STRIPE_API_KEY')) {
      // Should fail with missing API key error
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors[0]).toContain('STRIPE_API_KEY');
    } else {
      // Should succeed if key is present
      expect(result.success).toBe(true);
    }
  });

  it('should generate plugin with different approaches based on existing plugins', async () => {
    const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    const codeGenService = runtime.getService('code-generation');

    // Test 1: New plugin (no similar existing)
    const newPluginRequest = {
      projectName: 'test-unique-blockchain-plugin',
      description: 'A plugin for blockchain transaction monitoring',
      targetType: 'plugin' as const,
      requirements: ['Monitor Ethereum transactions', 'Alert on large transfers'],
      apis: ['Ethereum'],
      testScenarios: ['Test transaction monitoring'],
    };

    const newResult = await (codeGenService as any).generateCode(newPluginRequest);
    expect(newResult.success).toBe(true);

    const newPrd = JSON.parse(
      await fs.readFile(path.join(newResult.projectPath, 'PRD.json'), 'utf-8')
    );
    expect(newPrd.architecture.approach).toBe('new-plugin');

    // Test 2: Extension (similar to existing)
    const extensionRequest = {
      projectName: 'test-enhanced-shell-plugin',
      description: 'A plugin that extends shell capabilities with advanced features',
      targetType: 'plugin' as const,
      requirements: ['Execute shell commands', 'Add command history', 'Add command aliases'],
      apis: [],
      testScenarios: ['Test shell execution with history'],
    };

    const extResult = await (codeGenService as any).generateCode(extensionRequest);
    expect(extResult.success).toBe(true);

    const extPrd = JSON.parse(
      await fs.readFile(path.join(extResult.projectPath, 'PRD.json'), 'utf-8')
    );
    // Should recognize similarity to shell plugin and suggest extension
    expect(['extend-existing', 'new-plugin']).toContain(extPrd.architecture.approach);
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectsDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to clean up test directory:', error);
    }
  });
});
