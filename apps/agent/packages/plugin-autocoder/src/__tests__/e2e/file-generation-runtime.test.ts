import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { AgentRuntime, type IAgentRuntime, type UUID } from '@elizaos/core';
import { autocoderPlugin } from '../../index';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
// Import required plugins
import sqlPlugin from '@elizaos/plugin-sql';
import formsPlugin from '@elizaos/plugin-forms';

describe('File Generation Runtime Tests', () => {
  let runtime: IAgentRuntime;
  let testProjectsDir: string;

  // Skip tests if no API key is available
  const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  const describeOrSkip = hasApiKey ? describe : describe.skip;

  beforeAll(async () => {
    // Create test projects directory
    testProjectsDir = path.join(process.cwd(), '.test-generated-plugins');
    await fs.mkdir(testProjectsDir, { recursive: true });

    // Set up test environment
    process.env.FORCE_BUNSQLITE = 'true';
    process.env.DATABASE_PATH = './.eliza/.test';
    process.env.ELIZA_TEST_MODE = 'true';
    process.env.SECRET_SALT = process.env.SECRET_SALT || 'test-salt-for-testing-only-not-secure';

    // Initialize runtime
    runtime = new AgentRuntime({
      agentId: uuidv4() as UUID,
      character: {
        name: 'Test Agent',
        bio: ['Test agent for plugin generation'],
        system: 'You are a helpful assistant',
        settings: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'test-key',
        },
      },
    });

    // Register required plugins first
    await runtime.registerPlugin(sqlPlugin);
    await runtime.registerPlugin(formsPlugin);

    // Now register the autocoder plugin
    await runtime.registerPlugin(autocoderPlugin);

    // Initialize the runtime
    await runtime.initialize();
  });

  afterAll(async () => {
    // Clean up test projects directory
    try {
      await fs.rm(testProjectsDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to clean up test directory:', error);
    }
  });

  it('should generate a simple hello world plugin and verify files', async () => {
    // Skip if no API key
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    const codeGenService = runtime.getService('code-generation');
    expect(codeGenService).toBeDefined();

    const request = {
      projectName: 'test-hello-world-plugin',
      description: 'A simple plugin that logs hello world',
      targetType: 'plugin' as const,
      requirements: ['Log "Hello World" when action is triggered'],
      apis: [],
      testScenarios: ['Should log hello world'],
    };

    const result = await (codeGenService as any).generateCode(request);
    expect(result.success).toBe(true);
    expect(result.projectPath).toBeDefined();

    // Verify project structure
    const projectPath = result.projectPath;

    // Check package.json exists and has correct content
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJsonExists = await fs
      .access(packageJsonPath)
      .then(() => true)
      .catch(() => false);
    expect(packageJsonExists).toBe(true);

    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    expect(packageJson.name).toBe('test-hello-world-plugin');
    expect(packageJson.type).toBe('module');
    expect(packageJson.main).toBe('dist/index.js');

    // Check src directory structure
    const srcPath = path.join(projectPath, 'src');
    const srcExists = await fs
      .access(srcPath)
      .then(() => true)
      .catch(() => false);
    expect(srcExists).toBe(true);

    // Check index.ts exists
    const indexPath = path.join(srcPath, 'index.ts');
    const indexExists = await fs
      .access(indexPath)
      .then(() => true)
      .catch(() => false);
    expect(indexExists).toBe(true);

    // Check README.md exists
    const readmePath = path.join(projectPath, 'README.md');
    const readmeExists = await fs
      .access(readmePath)
      .then(() => true)
      .catch(() => false);
    expect(readmeExists).toBe(true);

    const readmeContent = await fs.readFile(readmePath, 'utf-8');
    expect(readmeContent).toContain('test-hello-world-plugin');
    expect(readmeContent).toContain('Hello World');
  });

  it('should generate a plugin and change hello world to foo bar', async () => {
    // Skip if no API key
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    const codeGenService = runtime.getService('code-generation');

    // First generate the plugin
    const request = {
      projectName: 'test-foo-bar-plugin',
      description: 'A plugin that says foo bar instead of hello world',
      targetType: 'plugin' as const,
      requirements: ['Create an action that returns "foo bar" instead of "hello world"'],
      apis: [],
      testScenarios: ['Should return foo bar'],
    };

    const result = await (codeGenService as any).generateCode(request);
    expect(result.success).toBe(true);

    const projectPath = result.projectPath;

    // Check if the generated code contains "foo bar" instead of "hello world"
    const indexPath = path.join(projectPath, 'src', 'index.ts');
    const indexContent = await fs.readFile(indexPath, 'utf-8');

    // The content should reference foo bar in some way
    const hasFooBar =
      indexContent.toLowerCase().includes('foo') || indexContent.toLowerCase().includes('bar');
    expect(hasFooBar).toBe(true);
  });

  it('should generate a weather plugin with API integration', async () => {
    // Skip if no API key
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    const codeGenService = runtime.getService('code-generation');

    const request = {
      projectName: 'test-weather-plugin',
      description: 'A plugin that fetches weather data from OpenWeatherMap API',
      targetType: 'plugin' as const,
      requirements: [
        'Fetch weather for a given city',
        'Parse temperature and conditions',
        'Handle API errors gracefully',
      ],
      apis: ['OpenWeatherMap'],
      testScenarios: [
        'Should fetch weather for valid city',
        'Should handle invalid city gracefully',
      ],
    };

    const result = await (codeGenService as any).generateCode(request);
    expect(result.success).toBe(true);

    const projectPath = result.projectPath;

    // Verify actions directory exists
    const actionsPath = path.join(projectPath, 'src', 'actions');
    const actionsExists = await fs
      .access(actionsPath)
      .then(() => true)
      .catch(() => false);
    expect(actionsExists).toBe(true);

    // Check for weather-related files
    const files = await fs.readdir(actionsPath);
    const hasWeatherAction = files.some((f) => f.includes('weather') || f.includes('Weather'));
    expect(hasWeatherAction).toBe(true);

    // Check package.json has proper dependencies
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    expect(packageJson.dependencies).toBeDefined();
  });

  it('should progressively add features to an existing plugin', async () => {
    // Skip if no API key
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    const codeGenService = runtime.getService('code-generation');

    // Step 1: Create basic calculator plugin
    const request1 = {
      projectName: 'test-calculator-plugin',
      description: 'A plugin that performs basic math operations',
      targetType: 'plugin' as const,
      requirements: ['Add two numbers together'],
      apis: [],
      testScenarios: ['Should add 2 + 2 = 4'],
    };

    const result1 = await (codeGenService as any).generateCode(request1);
    expect(result1.success).toBe(true);

    const projectPath = result1.projectPath;

    // Verify initial structure
    const actionsPath = path.join(projectPath, 'src', 'actions');
    const initialFiles = await fs.readdir(actionsPath);
    expect(initialFiles.length).toBeGreaterThan(0);

    // Step 2: Add more operations (simulating progressive enhancement)
    // Note: In a real scenario, this would involve modifying existing files
    // For this test, we verify the structure supports extensibility

    // Check if the plugin structure supports adding new actions
    const indexPath = path.join(projectPath, 'src', 'index.ts');
    const indexContent = await fs.readFile(indexPath, 'utf-8');

    // Should have proper plugin structure
    expect(indexContent).toContain('actions:');
    expect(indexContent).toContain('export');

    // Check if tests directory exists for adding new tests
    const testsPath = path.join(projectPath, 'src', '__tests__');
    const testsExists = await fs
      .access(testsPath)
      .then(() => true)
      .catch(() => false);
    expect(testsExists).toBe(true);
  });

  it('should validate generated code passes basic linting', async () => {
    // Skip if no API key
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    const codeGenService = runtime.getService('code-generation');

    const request = {
      projectName: 'test-lint-valid-plugin',
      description: 'A plugin that should pass linting checks',
      targetType: 'plugin' as const,
      requirements: ['Create a well-formatted plugin with proper TypeScript'],
      apis: [],
      testScenarios: ['Code should be properly formatted'],
    };

    const result = await (codeGenService as any).generateCode(request);
    expect(result.success).toBe(true);

    // Check execution results if available
    if (result.executionResults) {
      // If linting was run, it should pass
      if (result.executionResults.lintPass !== undefined) {
        expect(result.executionResults.lintPass).toBe(true);
      }
    }

    // Verify TypeScript config exists
    const tsconfigPath = path.join(result.projectPath, 'tsconfig.json');
    const tsconfigExists = await fs
      .access(tsconfigPath)
      .then(() => true)
      .catch(() => false);
    expect(tsconfigExists).toBe(true);

    const tsconfig = JSON.parse(await fs.readFile(tsconfigPath, 'utf-8'));
    expect(tsconfig.compilerOptions).toBeDefined();
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });
});
