import { describe, it, expect, beforeAll } from 'bun:test';
import { AgentRuntime, type IAgentRuntime, type UUID } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';

describe('Autocoder Agent Integration', () => {
  let runtime: IAgentRuntime;

  beforeAll(async () => {
    // Load environment variables from root .env
    const dotenv = require('dotenv');
    const path = require('path');
    const envPath = path.join(process.cwd(), '..', '..', '.env');
    dotenv.config({ path: envPath });

    // Create agent with autocoder plugin
    runtime = new AgentRuntime({
      agentId: uuidv4() as UUID,
      character: {
        plugins: [
          '@elizaos/plugin-sql',
          '@elizaos/plugin-forms',
          '@elizaos/plugin-openai',
          '@elizaos/plugin-autocoder',
        ],
        name: 'Autocoder Agent',
        bio: ['An AI assistant specialized in generating code autonomously'],
        system:
          'You are an expert code generation assistant with access to the Autocoder plugin. Help users create plugins, agents, and other code projects.',
        settings: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
      },
    });

    // Initialize the runtime
    await runtime.initialize();
  });

  it('should have autocoder plugin loaded', () => {
    // Check that the plugin is loaded
    const services = runtime.services;

    console.log(
      'Available services:',
      Array.from(services.values()).map((s) => s.constructor.name)
    );

    // Should have code generation service
    const codeGenService = runtime.getService('code-generation');
    expect(codeGenService).toBeDefined();

    // Should have project planning service
    const planningService = runtime.getService('project-planning');
    expect(planningService).toBeDefined();

    // Should have forms service (required dependency)
    const formsService = runtime.getService('forms');
    expect(formsService).toBeDefined();
  });

  it('should have autocoder actions available', () => {
    // Get all actions
    const actions = runtime.actions;

    console.log(
      'Available actions:',
      actions.map((a) => a.name)
    );

    // Should have code generation actions
    const generateCodeAction = actions.find((a) => a.name === 'GENERATE_CODE');
    expect(generateCodeAction).toBeDefined();

    const createProjectAction = actions.find((a) => a.name === 'CREATE_PROJECT');
    expect(createProjectAction).toBeDefined();

    const setupEnvironmentAction = actions.find((a) => a.name === 'SETUP_ENVIRONMENT');
    expect(setupEnvironmentAction).toBeDefined();
  });

  it('should have autocoder providers available', () => {
    // Get all providers
    const providers = runtime.providers;

    console.log(
      'Available providers:',
      providers.map((p) => p.name)
    );

    // Should have autocoder providers
    const projectsProvider = providers.find((p) => p.name === 'projects');
    expect(projectsProvider).toBeDefined();

    const currentProjectProvider = providers.find((p) => p.name === 'current-project');
    expect(currentProjectProvider).toBeDefined();
  });

  it('should validate GENERATE_CODE action for valid requests', async () => {
    const generateCodeAction = runtime.actions.find((a) => a.name === 'GENERATE_CODE');
    expect(generateCodeAction).toBeDefined();

    // Test valid code generation request
    const validMessage = {
      id: uuidv4() as UUID,
      entityId: uuidv4() as UUID,
      roomId: 'test-room' as UUID,
      userId: 'test-user' as UUID,
      agentId: runtime.agentId,
      content: {
        text: 'Create a new plugin that sends email notifications',
      },
      createdAt: Date.now(),
    };

    const isValid = await generateCodeAction!.validate(runtime, validMessage);
    expect(isValid).toBe(true);
  });

  it('should not validate GENERATE_CODE for non-code requests', async () => {
    const generateCodeAction = runtime.actions.find((a) => a.name === 'GENERATE_CODE');
    expect(generateCodeAction).toBeDefined();

    // Test invalid request (no code generation keywords)
    const invalidMessage = {
      id: uuidv4() as UUID,
      entityId: uuidv4() as UUID,
      roomId: 'test-room' as UUID,
      userId: 'test-user' as UUID,
      agentId: runtime.agentId,
      content: {
        text: 'What is the weather today?',
      },
      createdAt: Date.now(),
    };

    const isValid = await generateCodeAction!.validate(runtime, invalidMessage);
    expect(isValid).toBe(false);
  });

  it('should provide project context through providers', async () => {
    const projectsProvider = runtime.providers.find((p) => p.name === 'projects');
    expect(projectsProvider).toBeDefined();

    // Get projects context
    const context = await projectsProvider!.get(runtime, {} as any, {} as any);

    console.log('Projects context:', context);

    expect(context).toHaveProperty('text');
    expect(context.text).toContain('[PROJECTS]');
  });

  it('should handle CREATE_PROJECT action', async () => {
    const createProjectAction = runtime.actions.find((a) => a.name === 'CREATE_PROJECT');
    expect(createProjectAction).toBeDefined();

    // Test project creation request
    const createMessage = {
      id: uuidv4() as UUID,
      entityId: uuidv4() as UUID,
      roomId: 'test-room' as UUID,
      userId: 'test-user' as UUID,
      agentId: runtime.agentId,
      content: {
        text: 'I want to create a new plugin for weather data',
      },
      createdAt: Date.now(),
    };

    const isValid = await createProjectAction!.validate(runtime, createMessage);
    expect(isValid).toBe(true);
  });

  it('should have proper service initialization', async () => {
    // Code generation service should be started
    const codeGenService = runtime.getService('code-generation');
    expect(codeGenService).toBeDefined();

    // Check if it has the expected methods
    expect(typeof (codeGenService as any).generateCode).toBe('function');
    expect(typeof (codeGenService as any).start).toBe('function');
    expect(typeof (codeGenService as any).stop).toBe('function');
  });

  it('should support form-based code generation', async () => {
    const formsService = runtime.getService('forms');
    expect(formsService).toBeDefined();

    // Forms service should be available for interactive code generation
    const createProjectAction = runtime.actions.find((a) => a.name === 'CREATE_PROJECT');

    // The action should create forms when handling requests
    const message = {
      id: uuidv4() as UUID,
      entityId: uuidv4() as UUID,
      roomId: 'test-room' as UUID,
      userId: 'test-user' as UUID,
      agentId: runtime.agentId,
      content: {
        text: 'Create a new plugin project',
      },
      createdAt: Date.now(),
    };

    // Just validate that the action would handle this
    const isValid = await createProjectAction!.validate(runtime, message);
    expect(isValid).toBe(true);
  });
});
