import { TestSuite, type IAgentRuntime, type Memory, type UUID } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';

export class BasicFunctionalityTestSuite implements TestSuite {
  name = 'basic-functionality';
  description = 'Basic functionality tests for autocoder plugin';

  tests = [
    {
      name: 'should have required services available',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing service availability...');

        // Check if core services are available
        const codeGenService = runtime.getService('code-generation');
        const projectPlanningService = runtime.getService('project-planning');
        const secretsManagerService = runtime.getService('secrets-manager');
        const projectStatusManager = runtime.getService('project-status-manager');
        const formsService = runtime.getService('forms');

        if (!codeGenService) {
          throw new Error('Code generation service not available');
        }

        if (!projectPlanningService) {
          throw new Error('Project planning service not available');
        }

        if (!secretsManagerService) {
          throw new Error('Secrets manager service not available');
        }

        if (!projectStatusManager) {
          throw new Error('Project status manager service not available');
        }

        if (!formsService) {
          throw new Error('Forms service not available');
        }

        console.log('✅ All required services are available');
      },
    },

    {
      name: 'should have generate code action registered',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing action registration...');

        // Check if the generate code action is registered
        const generateCodeAction = runtime.actions.find(
          (action) => action.name === 'GENERATE_CODE'
        );

        if (!generateCodeAction) {
          throw new Error('GENERATE_CODE action not found');
        }

        console.log('✅ GENERATE_CODE action is registered');

        // Test action validation
        const testMessage: Memory = {
          id: uuidv4() as UUID,
          entityId: uuidv4() as UUID,
          agentId: runtime.agentId,
          roomId: uuidv4() as UUID,
          content: {
            text: 'generate a weather plugin',
            type: 'text',
          },
          createdAt: Date.now(),
        };

        const isValid = await generateCodeAction.validate(runtime, testMessage);
        if (!isValid) {
          throw new Error('GENERATE_CODE action validation failed');
        }

        console.log('✅ GENERATE_CODE action validation passed');
      },
    },

    {
      name: 'should have projects provider available',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing provider availability...');

        // Check if the projects provider is registered
        const projectsProvider = runtime.providers.find(
          (provider) => provider.name === 'PROJECTS_CONTEXT'
        );

        if (!projectsProvider) {
          throw new Error('PROJECTS_CONTEXT provider not found');
        }

        console.log('✅ PROJECTS_CONTEXT provider is registered');

        // Test provider functionality
        const testMessage: Memory = {
          id: uuidv4() as UUID,
          entityId: uuidv4() as UUID,
          agentId: runtime.agentId,
          roomId: uuidv4() as UUID,
          content: {
            text: 'test message',
            type: 'text',
          },
          createdAt: Date.now(),
        };

        const testState = {
          values: {},
          data: {},
          text: '',
        };

        const result = await projectsProvider.get(runtime, testMessage, testState);
        if (!result) {
          throw new Error('PROJECTS_CONTEXT provider returned null');
        }

        console.log('✅ PROJECTS_CONTEXT provider functionality verified');
      },
    },

    {
      name: 'should handle project status tracking',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing project status tracking...');

        const statusManager = runtime.getService('project-status-manager') as any;
        if (!statusManager) {
          throw new Error('Project status manager not available');
        }

        // Test project creation
        const projectId = statusManager.createProject('test-project', 'plugin');
        if (!projectId) {
          throw new Error('Failed to create project');
        }

        console.log(`✅ Created project: ${projectId}`);

        // Test status updates
        statusManager.updateStatus(projectId, {
          status: 'generating',
          progress: 50,
          message: 'Generating code...',
        });

        // Test step updates
        statusManager.updateStep(projectId, 'Code Generation', 'Creating plugin structure...');

        // Test validation updates
        statusManager.updateValidation(projectId, 'lint', true);
        statusManager.updateValidation(projectId, 'typeCheck', true);

        // Get project status
        const project = statusManager.getProject(projectId);
        if (!project) {
          throw new Error('Failed to retrieve project');
        }

        console.log('✅ Project status tracking successful');
      },
    },

    {
      name: 'should handle forms service functionality',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing forms service functionality...');

        const formsService = runtime.getService('forms') as any;
        if (!formsService) {
          throw new Error('Forms service not available');
        }

        // Test form creation
        const form = await formsService.createForm({
          name: 'test-form',
          description: 'Test form',
          steps: [
            {
              id: 'step1',
              name: 'Step 1',
              fields: [
                {
                  id: 'projectName',
                  type: 'text',
                  label: 'Project Name',
                  description: 'Enter project name',
                },
              ],
            },
          ],
        });

        if (!form) {
          throw new Error('Failed to create form');
        }

        console.log(`✅ Created form: ${form.id}`);

        // Test form retrieval
        const retrievedForm = await formsService.getForm(form.id);
        if (!retrievedForm) {
          throw new Error('Failed to retrieve form');
        }

        console.log('✅ Form retrieval successful');
      },
    },

    {
      name: 'should initialize without errors',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing plugin initialization...');

        // Check that the plugin was initialized without errors
        const pluginName = '@elizaos/plugin-autocoder';
        const plugin = runtime.plugins.find((p) => p.name === pluginName);

        if (!plugin) {
          throw new Error(`Plugin ${pluginName} not found in runtime`);
        }

        console.log('✅ Plugin found in runtime');

        // Test that services are properly initialized
        const services = [
          'code-generation',
          'project-planning',
          'secrets-manager',
          'project-status-manager',
        ];
        for (const serviceName of services) {
          const service = runtime.getService(serviceName);
          if (!service) {
            throw new Error(`Service ${serviceName} not initialized`);
          }
        }

        console.log('✅ All plugin services initialized correctly');
      },
    },
  ];
}

export default new BasicFunctionalityTestSuite();
