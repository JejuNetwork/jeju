import { describe, it, expect, beforeAll } from 'bun:test';
import {
  AgentRuntime,
  type IAgentRuntime,
  type UUID,
  type Memory,
  generateText,
} from '@elizaos/core';
import { autocoderPlugin } from '../../index';
import { FormsService } from '@elizaos/plugin-forms';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { promises as fs } from 'fs';
// Import required plugins
import sqlPlugin from '@elizaos/plugin-sql';
import formsPlugin from '@elizaos/plugin-forms';
import inferencePlugin from '@elizaos/plugin-inference';
import openaiPlugin from '@elizaos/plugin-openai';
import anthropicPlugin from '@elizaos/plugin-anthropic';

describe('Forms Integration Flow', () => {
  let runtime: IAgentRuntime;
  let formsService: FormsService;

  beforeAll(async () => {
    // Skip if no API keys
    const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
      console.log('⚠️  No API keys found - skipping forms integration tests');
      return;
    }

    // Set up test environment
    process.env.FORCE_BUNSQLITE = 'true';
    process.env.DATABASE_PATH = './.eliza/.test-forms-flow';
    process.env.ELIZA_TEST_MODE = 'true';
    process.env.SECRET_SALT = process.env.SECRET_SALT || 'test-salt-for-testing-only-not-secure';

    // Initialize runtime
    runtime = new AgentRuntime({
      agentId: uuidv4() as UUID,
      character: {
        name: 'Test Agent',
        bio: ['Test agent for forms integration'],
        system: 'You are a helpful coding assistant',
        settings: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
        modelProvider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai',
      },
    });

    // Register plugins
    await runtime.registerPlugin(sqlPlugin);
    await runtime.registerPlugin(inferencePlugin);

    if (process.env.ANTHROPIC_API_KEY) {
      await runtime.registerPlugin(anthropicPlugin);
    } else if (process.env.OPENAI_API_KEY) {
      await runtime.registerPlugin(openaiPlugin);
    }

    await runtime.registerPlugin(formsPlugin);
    await runtime.registerPlugin(autocoderPlugin);

    // Initialize runtime
    await runtime.initialize();

    // Get forms service
    formsService = runtime.getService('forms') as FormsService;
  });

  it('should handle CREATE_PROJECT action and create a form', async () => {
    const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    const roomId = uuidv4() as UUID;
    const userId = uuidv4() as UUID;

    // Create a message that triggers CREATE_PROJECT
    const message: Memory = {
      id: uuidv4() as UUID,
      entityId: userId,
      agentId: runtime.agentId,
      roomId,
      content: {
        text: 'Create a new plugin called weather-monitor that checks weather data',
        type: 'text',
      },
      createdAt: Date.now(),
    };

    // Get the CREATE_PROJECT action
    const createProjectAction = runtime.actions.find((a) => a.name === 'CREATE_PROJECT');
    expect(createProjectAction).toBeDefined();

    // Validate the action
    const isValid = await createProjectAction!.validate(runtime, message);
    expect(isValid).toBe(true);

    // Execute the action
    if (isValid) {
      const callback = async (response: any) => {
        console.log('Action response:', response);

        // Check if a form was created
        const forms = await formsService.getAllForms();
        const projectForm = forms.find((f) => f.name === 'create-plugin');

        expect(projectForm).toBeDefined();
        expect(projectForm?.status).toBe('active');
        console.log('✅ Form created successfully');
      };

      await createProjectAction!.handler(runtime, message, undefined, undefined, callback);
    }
  });

  it('should handle complete form flow for plugin generation', async () => {
    const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    const roomId = uuidv4() as UUID;
    const userId = uuidv4() as UUID;

    // Step 1: Create form
    const form = await formsService.createForm({
      name: 'test-plugin-form',
      description: 'Test plugin creation form',
      status: 'active',
      roomId,
      agentId: runtime.agentId,
      entityId: userId,
      stepOrder: ['basic', 'requirements', 'apis', 'confirm'],
      currentStep: 'basic',
      metadata: {
        projectType: 'plugin',
      },
      formData: {},
      createdAt: Date.now(),
    });

    expect(form).toBeDefined();
    console.log('✅ Form created');

    // Step 2: Fill basic info
    await formsService.updateForm(form.id, {
      formData: {
        projectName: 'test-calculator-plugin',
        projectDescription: 'A plugin that performs calculations',
        primaryFunction: 'Perform basic math operations',
      },
      currentStep: 'requirements',
    });

    console.log('✅ Basic info filled');

    // Step 3: Fill requirements
    await formsService.updateForm(form.id, {
      formData: {
        ...form.formData,
        keyFeatures: ['Add numbers', 'Subtract numbers', 'Multiply numbers'],
        targetUsers: 'Anyone who needs calculations',
      },
      currentStep: 'apis',
    });

    console.log('✅ Requirements filled');

    // Step 4: Fill API info
    await formsService.updateForm(form.id, {
      formData: {
        ...form.formData,
        requiredAPIs: [],
        externalServices: [],
      },
      currentStep: 'confirm',
    });

    console.log('✅ API info filled');

    // Step 5: Complete form
    await formsService.updateForm(form.id, {
      status: 'completed',
      completedAt: Date.now(),
    });

    console.log('✅ Form completed');

    // Step 6: Trigger code generation
    const generateAction = runtime.actions.find((a) => a.name === 'GENERATE_CODE');
    expect(generateAction).toBeDefined();

    const generateMessage: Memory = {
      id: uuidv4() as UUID,
      entityId: userId,
      agentId: runtime.agentId,
      roomId,
      content: {
        text: 'Generate the code for the calculator plugin',
        type: 'text',
        formId: form.id,
      },
      createdAt: Date.now(),
    };

    const isValid = await generateAction!.validate(runtime, generateMessage);
    expect(isValid).toBe(true);

    if (isValid) {
      const result = await new Promise((resolve) => {
        const callback = async (response: any) => {
          console.log('Generation response:', response);
          resolve(response);
        };
        generateAction!.handler(runtime, generateMessage, undefined, undefined, callback);
      });

      console.log('✅ Code generation triggered');
    }
  });

  it('should track project status throughout form flow', async () => {
    const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
      console.log('Skipping test - no API key available');
      return;
    }

    const statusManager = runtime.getService('project-status-manager') as any;
    expect(statusManager).toBeDefined();

    // Get current projects
    const activeProjects = statusManager.getActiveProjects();
    console.log(`Active projects: ${activeProjects.length}`);

    // Get project history
    const history = statusManager.getHistory();
    console.log(`Project history: ${history.length} entries`);

    // Get summary
    const summary = statusManager.getStatusSummary();
    console.log('Status summary:', {
      active: summary.active,
      completed: summary.completed,
      failed: summary.failed,
      totalGenerated: summary.totalGenerated,
      averageDuration: `${(summary.averageDuration / 1000).toFixed(1)}s`,
    });
  });
});
