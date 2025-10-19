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
import anthropicPlugin from '@elizaos/plugin-anthropic';

describe('Full Project Flow with Real Keys', () => {
  let runtime: IAgentRuntime;
  let testProjectsDir: string;

  beforeAll(async () => {
    // Skip if no API keys
    const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
      console.log('⚠️  No API keys found - skipping full flow tests');
      return;
    }

    // Create test projects directory
    testProjectsDir = path.join(process.cwd(), '.test-full-flow-projects');
    await fs.mkdir(testProjectsDir, { recursive: true });

    // Set up test environment
    process.env.FORCE_BUNSQLITE = 'true';
    process.env.DATABASE_PATH = './.eliza/.test-full-flow';
    process.env.ELIZA_TEST_MODE = 'true';
    process.env.SECRET_SALT = process.env.SECRET_SALT || 'test-salt-for-testing-only-not-secure';

    // Initialize runtime with proper settings
    runtime = new AgentRuntime({
      agentId: uuidv4() as UUID,
      character: {
        name: 'Test Agent',
        bio: ['Test agent for full flow validation'],
        system: 'You are a helpful coding assistant',
        settings: {
          // Pass through API keys
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          USE_CLAUDE_PROXY: process.env.ANTHROPIC_API_KEY ? 'false' : 'true',
        },
        // Specify model provider based on available keys
        modelProvider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai',
      },
    });

    // Register plugins in correct order
    await runtime.registerPlugin(sqlPlugin);
    await runtime.registerPlugin(inferencePlugin);

    // Register the appropriate model provider plugin
    if (process.env.ANTHROPIC_API_KEY) {
      await runtime.registerPlugin(anthropicPlugin);
    } else if (process.env.OPENAI_API_KEY) {
      await runtime.registerPlugin(openaiPlugin);
    }

    await runtime.registerPlugin(formsPlugin);
    await runtime.registerPlugin(autocoderPlugin);

    // Initialize runtime
    await runtime.initialize();
  });

  it('should complete full project generation flow: setup -> PRD -> code -> validation', async () => {
    const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    console.log('🚀 Starting full project flow test');
    console.log(`   Using model provider: ${runtime.character.modelProvider}`);

    // Get services
    const codeGenService = runtime.getService('code-generation');
    const statusManager = runtime.getService('project-status-manager') as any;
    const projectPlanningService = runtime.getService('project-planning') as any;

    expect(codeGenService).toBeDefined();
    expect(statusManager).toBeDefined();
    expect(projectPlanningService).toBeDefined();

    // Track all status updates
    const statusHistory: any[] = [];
    statusManager.on('update', (update: any) => {
      statusHistory.push({
        timestamp: Date.now(),
        status: update.status,
        progress: update.progress,
        step: update.currentStep,
        message: update.message,
      });
      console.log(
        `📊 [${update.progress || 0}%] ${update.status}: ${update.message || update.currentStep || ''}`
      );
    });

    // Step 1: Create project request
    console.log('\n📝 Step 1: Creating project request...');
    const request = {
      projectName: 'hello-world-plugin',
      description: 'A simple plugin that greets users with Hello World',
      targetType: 'plugin' as const,
      requirements: [
        'Create a GREET action that responds with "Hello World"',
        'Add a greeting provider that shows current greeting',
        'Include proper TypeScript types',
        'Add unit tests for the action',
      ],
      apis: [],
      testScenarios: [
        'Should respond with Hello World when greeted',
        'Should validate message correctly',
        'Should provide greeting context',
      ],
    };

    // Step 2: Generate the project
    console.log('\n🔨 Step 2: Generating project...');
    const startTime = Date.now();
    const result = await (codeGenService as any).generateCode(request);
    const duration = Date.now() - startTime;

    // Step 3: Verify results
    console.log(`\n✅ Step 3: Verifying results (completed in ${(duration / 1000).toFixed(1)}s)`);

    expect(result.success).toBe(true);
    expect(result.projectPath).toBeDefined();
    expect(result.files).toBeDefined();
    expect(result.files.length).toBeGreaterThan(0);

    console.log(`   Generated ${result.files.length} files`);
    console.log(`   Project path: ${result.projectPath}`);

    // Step 4: Verify project phases were completed
    console.log('\n🔍 Step 4: Verifying project phases...');

    const phases = ['planning', 'generating', 'testing'];
    const completedPhases = statusHistory.map((s) => s.status).filter((s) => phases.includes(s));

    expect(completedPhases.length).toBeGreaterThan(0);
    console.log(`   Completed phases: ${[...new Set(completedPhases)].join(', ')}`);

    // Step 5: Verify PRD was created
    console.log('\n📋 Step 5: Verifying PRD...');

    const prdPath = path.join(result.projectPath, 'PRD.json');
    const prdExists = await fs
      .access(prdPath)
      .then(() => true)
      .catch(() => false);
    expect(prdExists).toBe(true);

    const prd = JSON.parse(await fs.readFile(prdPath, 'utf-8'));
    expect(prd.title).toBeDefined();
    expect(prd.architecture).toBeDefined();
    expect(prd.architecture.approach).toMatch(/^(clone-existing|extend-existing|new-plugin)$/);

    console.log(`   PRD approach: ${prd.architecture.approach}`);
    console.log(`   Components: ${prd.architecture.components.join(', ')}`);

    // Step 6: Verify essential files
    console.log('\n📁 Step 6: Verifying essential files...');

    const essentialFiles = [
      'package.json',
      'src/index.ts',
      'tsconfig.json',
      'README.md',
      '.gitignore',
    ];

    for (const file of essentialFiles) {
      const filePath = path.join(result.projectPath, file);
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
      console.log(`   ✓ ${file}`);
    }

    // Step 7: Verify action was created
    console.log('\n🎯 Step 7: Verifying GREET action...');

    const actionsDir = path.join(result.projectPath, 'src/actions');
    const actionsDirExists = await fs
      .access(actionsDir)
      .then(() => true)
      .catch(() => false);
    expect(actionsDirExists).toBe(true);

    if (actionsDirExists) {
      const actionFiles = await fs.readdir(actionsDir);
      const greetAction = actionFiles.find(
        (f) => f.toLowerCase().includes('greet') || f.toLowerCase().includes('hello')
      );
      expect(greetAction).toBeDefined();
      console.log(`   ✓ Found action file: ${greetAction}`);
    }

    // Step 8: Verify test files
    console.log('\n🧪 Step 8: Verifying test files...');

    const testsDir = path.join(result.projectPath, 'src/__tests__');
    const testsDirExists = await fs
      .access(testsDir)
      .then(() => true)
      .catch(() => false);
    expect(testsDirExists).toBe(true);
    console.log(`   ✓ Tests directory exists`);

    // Step 9: Verify validation results
    console.log('\n📊 Step 9: Checking validation results...');

    if (result.executionResults) {
      console.log(`   Lint: ${result.executionResults.lintPass ? '✅' : '❌'}`);
      console.log(`   Types: ${result.executionResults.typesPass ? '✅' : '❌'}`);
      console.log(`   Tests: ${result.executionResults.testsPass ? '✅' : '❌'}`);
      console.log(`   Build: ${result.executionResults.buildPass ? '✅' : '❌'}`);
    }

    // Step 10: Verify status tracking
    console.log('\n📈 Step 10: Verifying status tracking...');

    const projectHistory = statusManager.getHistory();
    expect(projectHistory.length).toBeGreaterThan(0);

    const latestProject = projectHistory[0];
    expect(latestProject.status).toBe('completed');
    expect(latestProject.filesGenerated).toBeGreaterThan(0);

    console.log(`   Project completed in ${((latestProject.duration || 0) / 1000).toFixed(1)}s`);
    console.log(`   Files generated: ${latestProject.filesGenerated}`);

    console.log('\n🎉 Full project flow test completed successfully!');
  });

  it('should handle complex project with multiple APIs', async () => {
    const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    console.log('🚀 Starting complex project test');

    const codeGenService = runtime.getService('code-generation');

    // Complex project with research phase
    const request = {
      projectName: 'weather-alert-plugin',
      description: 'A plugin that monitors weather and sends alerts',
      targetType: 'plugin' as const,
      requirements: [
        'Monitor weather for multiple cities',
        'Send alerts when severe weather is detected',
        'Cache weather data for efficiency',
        'Support multiple weather providers',
      ],
      apis: ['OpenWeatherMap', 'Redis'],
      testScenarios: [
        'Should fetch weather data',
        'Should cache results',
        'Should send alerts for severe weather',
      ],
    };

    console.log('🔨 Generating complex project...');
    const result = await (codeGenService as any).generateCode(request);

    if (!result.success) {
      // If it fails due to missing API keys, that's expected
      if (result.errors?.[0]?.includes('API_KEY')) {
        console.log('✅ Correctly validated API key requirements');
        expect(result.errors[0]).toContain('API_KEY');
        return;
      }
      throw new Error(`Unexpected failure: ${result.errors?.join(', ')}`);
    }

    // Verify research was performed
    const prdPath = path.join(result.projectPath, 'PRD.json');
    const prd = JSON.parse(await fs.readFile(prdPath, 'utf-8'));

    expect(prd.apiKeys).toBeDefined();
    expect(prd.apiKeys.length).toBeGreaterThan(0);
    console.log(`✅ PRD includes ${prd.apiKeys.length} required API keys`);
  });

  it('should use claude proxy when only OpenAI key is available', async () => {
    if (!process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping test - requires OpenAI key without Anthropic key');
      return;
    }

    console.log('🔄 Testing Claude proxy integration...');

    // The runtime should already be configured to use claude proxy
    expect(runtime.getSetting('USE_CLAUDE_PROXY')).toBe('true');

    // Test that we can generate code using OpenAI through the proxy
    const codeGenService = runtime.getService('code-generation');

    const request = {
      projectName: 'proxy-test-plugin',
      description: 'Test plugin to verify proxy works',
      targetType: 'plugin' as const,
      requirements: ['Simple test action'],
      apis: [],
    };

    const result = await (codeGenService as any).generateCode(request);
    expect(result.success).toBe(true);
    console.log('✅ Successfully generated code using Claude proxy with OpenAI');
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
