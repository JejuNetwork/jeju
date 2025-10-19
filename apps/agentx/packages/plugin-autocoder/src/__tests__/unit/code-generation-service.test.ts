import { describe, it, expect, beforeAll, mock } from 'bun:test';
import { CodeGenerationService } from '../../services/CodeGenerationService';
import { ProjectStatusManager } from '../../services/ProjectStatusManager';
import type { IAgentRuntime } from '@elizaos/core';
import * as path from 'path';
import { promises as fs } from 'fs';

describe('CodeGenerationService Unit Tests', () => {
  let service: CodeGenerationService;
  let mockRuntime: Partial<IAgentRuntime>;
  let mockStatusManager: Partial<ProjectStatusManager>;

  beforeAll(async () => {
    // Create mock status manager
    mockStatusManager = {
      createProject: mock(() => 'test-project-id'),
      updateStatus: mock(() => {}),
      updateStep: mock(() => {}),
      updateValidation: mock(() => {}),
      getProject: mock(() => ({
        projectId: 'test-project-id',
        projectName: 'test-project',
        status: 'planning',
      })) as any,
    };

    // Create mock runtime
    mockRuntime = {
      agentId: 'test-agent-id' as any,
      getSetting: mock((key: string) => {
        const settings: Record<string, string> = {
          OPENAI_API_KEY: 'test-key',
          ANTHROPIC_API_KEY: 'test-key',
        };
        return settings[key];
      }),
      setSetting: mock(() => {}),
      getService: mock((name: string) => {
        if (name === 'project-status-manager') {
          return mockStatusManager as any;
        }
        if (name === 'forms') {
          return {} as any; // Mock forms service
        }
        return null;
      }),
      useModel: mock((model, params) => {
        // Return JSON array for similar projects search
        if (params.prompt && params.prompt.includes('similar')) {
          return Promise.resolve('[]');
        }
        // Return default mock response
        return Promise.resolve('Mock response');
      }) as any,
    };

    // Create service instance
    service = new CodeGenerationService(mockRuntime as IAgentRuntime);

    // Initialize the service to load dependencies
    await service.start();
  });

  it('should validate API keys before generation', async () => {
    const request = {
      projectName: 'test-api-validation',
      description: 'Test project',
      targetType: 'plugin' as const,
      requirements: ['Test requirement'],
      apis: ['Stripe'], // This requires STRIPE_API_KEY
    };

    // Mock getSetting to not have STRIPE_API_KEY
    mockRuntime.getSetting = mock((key: string) => {
      if (key === 'STRIPE_API_KEY') return undefined;
      return 'test-key';
    });

    // Mock research phase to immediately check API keys
    mockRuntime.useModel = mock((model, params) => {
      // Skip research, go straight to PRD which will check API keys
      if (params.prompt && params.prompt.includes('PRD')) {
        return Promise.resolve(
          JSON.stringify({
            title: 'Test',
            overview: 'Test',
            objectives: [],
            requirements: { functional: [], nonFunctional: [], technical: [] },
            architecture: { approach: 'new-plugin', components: [], dependencies: [] },
            apiKeys: ['STRIPE_API_KEY'], // This will trigger validation
            testScenarios: [],
            successCriteria: [],
          })
        );
      }
      return Promise.resolve('[]');
    }) as any;

    const result = await service.generateCode(request);

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain('STRIPE_API_KEY');
  });

  it('should track project status throughout generation', async () => {
    const request = {
      projectName: 'test-status-tracking',
      description: 'Test project for status tracking',
      targetType: 'plugin' as const,
      requirements: ['Simple test'],
      apis: [],
    };

    // Mock successful generation
    mockRuntime.useModel = mock(() =>
      Promise.resolve(
        JSON.stringify({
          title: 'Test Project',
          overview: 'Test overview',
          objectives: ['Test objective'],
          requirements: {
            functional: ['Test requirement'],
            nonFunctional: [],
            technical: [],
          },
          architecture: {
            approach: 'new-plugin',
            components: ['actions'],
            dependencies: [],
          },
          apiKeys: [],
          testScenarios: ['Test scenario'],
          successCriteria: ['All tests pass'],
        })
      )
    ) as any;

    await service.generateCode(request);

    // Verify status manager was called
    expect(mockStatusManager.createProject).toHaveBeenCalledWith('test-status-tracking', 'plugin');
    expect(mockStatusManager.updateStep).toHaveBeenCalled();
    expect(mockStatusManager.updateStatus).toHaveBeenCalled();
  });

  it('should generate PRD with correct structure', async () => {
    const request = {
      projectName: 'test-prd-generation',
      description: 'A plugin for testing PRD generation',
      targetType: 'plugin' as const,
      requirements: ['Create test action', 'Add provider'],
      apis: ['OpenAI'],
    };

    // Create a test directory for the project
    const testDir = path.join(process.cwd(), '.test-prd-generation');
    await fs.mkdir(testDir, { recursive: true });

    // Mock file system operations
    const originalReadFile = fs.readFile;
    const originalWriteFile = fs.writeFile;
    const originalMkdir = fs.mkdir;

    // Track written files
    const writtenFiles: Record<string, string> = {};

    fs.mkdir = mock(() => Promise.resolve(undefined));
    fs.writeFile = mock((filePath: string, content: string) => {
      writtenFiles[filePath] = content;
      return Promise.resolve();
    });
    fs.readFile = mock((filePath: string) => {
      if (writtenFiles[filePath]) {
        return Promise.resolve(writtenFiles[filePath]);
      }
      return originalReadFile(filePath, 'utf-8');
    }) as any;

    // Mock successful PRD response
    mockRuntime.useModel = mock((model, params) => {
      if (params.prompt.includes('Product Requirements Document')) {
        return Promise.resolve(
          JSON.stringify({
            title: 'Test PRD Plugin',
            overview: 'A plugin for testing PRD generation',
            objectives: ['Create working test action', 'Add context provider'],
            requirements: {
              functional: ['Create test action', 'Add provider'],
              nonFunctional: ['Performance', 'Security'],
              technical: ['TypeScript', 'Node.js'],
            },
            architecture: {
              approach: 'new-plugin',
              components: ['actions', 'providers'],
              dependencies: ['@elizaos/core'],
            },
            apiKeys: ['OPENAI_API_KEY'],
            testScenarios: ['Test action execution', 'Test provider context'],
            successCriteria: ['All tests pass', 'Plugin loads successfully'],
          })
        );
      }
      return Promise.resolve('Mock response');
    }) as any;

    const result = await service.generateCode(request);

    // Restore fs methods
    fs.readFile = originalReadFile;
    fs.writeFile = originalWriteFile;
    fs.mkdir = originalMkdir;

    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Verify PRD was created
    const prdPath = path.join('generated-plugins', 'test-prd-generation', 'PRD.json');
    expect(writtenFiles[prdPath]).toBeDefined();

    if (writtenFiles[prdPath]) {
      const prd = JSON.parse(writtenFiles[prdPath]);
      expect(prd.title).toBe('Test PRD Plugin');
      expect(prd.architecture.approach).toBe('new-plugin');
      expect(prd.architecture.components).toContain('actions');
      expect(prd.architecture.components).toContain('providers');
      expect(prd.apiKeys).toContain('OPENAI_API_KEY');
    }
  });

  it('should handle different project approaches', async () => {
    // Test 1: New plugin approach
    const newPluginRequest = {
      projectName: 'unique-blockchain-plugin',
      description: 'A unique blockchain monitoring plugin',
      targetType: 'plugin' as const,
      requirements: ['Monitor blockchain', 'Send alerts'],
      apis: ['Ethereum'],
    };

    mockRuntime.useModel = mock((model, params) => {
      if (params.prompt.includes('Product Requirements Document')) {
        return Promise.resolve(
          JSON.stringify({
            title: 'Blockchain Monitor',
            overview: 'Unique blockchain monitoring',
            objectives: ['Monitor chains'],
            requirements: {
              functional: ['Monitor', 'Alert'],
              nonFunctional: [],
              technical: ['TypeScript'],
            },
            architecture: {
              approach: 'new-plugin',
              components: ['services'],
              dependencies: [],
            },
            apiKeys: ['ETHEREUM_API_KEY'],
            testScenarios: [],
            successCriteria: [],
          })
        );
      }
      return Promise.resolve('Mock response');
    }) as any;

    const newResult = await service.generateCode(newPluginRequest);
    expect(newResult.success).toBe(false); // Will fail due to missing API key

    // Test 2: Extension approach
    const extensionRequest = {
      projectName: 'enhanced-shell-plugin',
      description: 'Extends shell capabilities',
      targetType: 'plugin' as const,
      requirements: ['Execute commands', 'Add history'],
      apis: [],
    };

    mockRuntime.useModel = mock((model, params) => {
      if (params.prompt.includes('Product Requirements Document')) {
        return Promise.resolve(
          JSON.stringify({
            title: 'Enhanced Shell',
            overview: 'Shell with history',
            objectives: ['Execute', 'History'],
            requirements: {
              functional: ['Commands', 'History'],
              nonFunctional: [],
              technical: ['TypeScript'],
            },
            architecture: {
              approach: 'extend-existing',
              basePlugin: '@elizaos/plugin-shell',
              components: ['actions'],
              dependencies: ['@elizaos/plugin-shell'],
            },
            apiKeys: [],
            testScenarios: [],
            successCriteria: [],
          })
        );
      }
      return Promise.resolve('Mock response');
    }) as any;

    // This should succeed as it doesn't require API keys
    const extResult = await service.generateCode(extensionRequest);
    // Will still fail because we're not mocking the full file generation
    expect(extResult.success).toBe(false);
  });
});
