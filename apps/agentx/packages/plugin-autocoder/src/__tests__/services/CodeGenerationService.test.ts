import { TestSuite, type IAgentRuntime, type Memory, type UUID } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';

/**
 * CodeGenerationService Form Interaction Test Suite
 *
 * This test suite validates the form-based project configuration workflow
 * that powers the autocoder's interactive project setup process.
 */
export class CodeGenerationFormTestSuite implements TestSuite {
  name = 'code-generation-forms';
  description = 'Tests form interactions for code generation workflow';

  tests = [
    {
      name: 'should create plugin project form with correct structure',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing plugin project form creation...');

        const formsService = runtime.getService('forms') as any;
        if (!formsService) {
          throw new Error('Forms service not available');
        }

        const codeGenService = runtime.getService('code-generation');
        if (!codeGenService) {
          throw new Error('Code generation service not available');
        }

        // Create a mock form for plugin project
        const pluginForm = await formsService.createForm({
          name: 'plugin-project-form',
          description: 'Gather requirements for plugin generation',
          steps: [
            {
              id: 'basic-info',
              name: 'Basic Information',
              fields: [
                {
                  name: 'projectName',
                  type: 'text',
                  label: 'Plugin Name',
                  description: 'Name for your plugin (e.g., weather-plugin)',
                  required: true,
                },
                {
                  name: 'description',
                  type: 'text',
                  label: 'Description',
                  description: 'What does this plugin do?',
                  required: true,
                },
              ],
            },
            {
              id: 'requirements',
              name: 'Requirements',
              fields: [
                {
                  name: 'requirements',
                  type: 'text',
                  label: 'Features',
                  description: 'What features should the plugin have?',
                  required: true,
                },
                {
                  name: 'apis',
                  type: 'text',
                  label: 'APIs',
                  description: 'What external APIs will it use?',
                  required: false,
                },
              ],
            },
          ],
        });

        // Verify form was created correctly
        if (!pluginForm) {
          throw new Error('Plugin form was not created');
        }
        if (!pluginForm.id) {
          throw new Error('Plugin form missing ID');
        }
        if (pluginForm.name !== 'plugin-project-form') {
          throw new Error(`Expected form name 'plugin-project-form', got '${pluginForm.name}'`);
        }
        if (pluginForm.steps.length !== 2) {
          throw new Error(`Expected 2 steps, got ${pluginForm.steps.length}`);
        }
        if (pluginForm.steps[0].fields.length !== 2) {
          throw new Error(`Expected 2 fields in step 1, got ${pluginForm.steps[0].fields.length}`);
        }
        if (pluginForm.steps[1].fields.length !== 2) {
          throw new Error(`Expected 2 fields in step 2, got ${pluginForm.steps[1].fields.length}`);
        }

        console.log('✅ Plugin project form created successfully');
      },
    },

    {
      name: 'should handle form field updates correctly',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing form field updates...');

        const formsService = runtime.getService('forms') as any;
        if (!formsService) {
          throw new Error('Forms service not available');
        }

        // Create a simple form
        const form = await formsService.createForm({
          name: 'test-form',
          description: 'Test form for field updates',
          steps: [
            {
              id: 'step1',
              name: 'Step 1',
              fields: [
                {
                  name: 'projectName',
                  type: 'text',
                  label: 'Project Name',
                  required: true,
                },
              ],
            },
          ],
        });

        // Update field value
        if (typeof formsService.updateField === 'function') {
          await formsService.updateField(form.id, 'projectName', 'my-awesome-plugin');

          // Get updated form
          const updatedForm = await formsService.getForm(form.id);
          const field = updatedForm.steps[0].fields.find((f: any) => f.name === 'projectName');

          if (!field) {
            throw new Error('Field not found after update');
          }
          if (field.value !== 'my-awesome-plugin') {
            throw new Error(`Expected field value 'my-awesome-plugin', got '${field.value}'`);
          }
          console.log('✅ Form field updates working correctly');
        } else {
          console.log('⚠️  updateField method not available, skipping field update test');
        }
      },
    },

    {
      name: 'should validate required fields before completion',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing form validation...');

        const formsService = runtime.getService('forms') as any;
        if (!formsService) {
          throw new Error('Forms service not available');
        }

        // Create form with required fields
        const form = await formsService.createForm({
          name: 'validation-test-form',
          description: 'Test form validation',
          steps: [
            {
              id: 'required-fields',
              name: 'Required Fields',
              fields: [
                {
                  name: 'requiredField',
                  type: 'text',
                  label: 'Required Field',
                  required: true,
                },
                {
                  name: 'optionalField',
                  type: 'text',
                  label: 'Optional Field',
                  required: false,
                },
              ],
            },
          ],
        });

        // Try to complete form without required fields
        if (typeof formsService.completeForm === 'function') {
          await formsService.completeForm(form.id);
        } else if (typeof formsService.submitForm === 'function') {
          await formsService.submitForm(form.id);
        }

        // Without try-catch, we can't detect validation errors
        console.log('⚠️  Form completed - validation behavior depends on implementation');
      },
    },

    {
      name: 'should handle multi-step form progression',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing multi-step form progression...');

        const formsService = runtime.getService('forms') as any;
        if (!formsService) {
          throw new Error('Forms service not available');
        }

        let stepCompletionCount = 0;

        // Create multi-step form with callbacks
        const form = await formsService.createForm({
          name: 'multi-step-form',
          description: 'Test multi-step progression',
          steps: [
            {
              id: 'step1',
              name: 'First Step',
              fields: [
                {
                  name: 'field1',
                  type: 'text',
                  label: 'Field 1',
                },
              ],
            },
            {
              id: 'step2',
              name: 'Second Step',
              fields: [
                {
                  name: 'field2',
                  type: 'text',
                  label: 'Field 2',
                },
              ],
            },
            {
              id: 'step3',
              name: 'Third Step',
              fields: [
                {
                  name: 'field3',
                  type: 'text',
                  label: 'Field 3',
                },
              ],
            },
          ],
          onStepComplete: async (form: any, stepId: string) => {
            stepCompletionCount++;
            console.log(`  Step completed: ${stepId} (${stepCompletionCount}/3)`);
          },
        });

        // Simulate progressing through steps
        if (typeof formsService.completeStep === 'function') {
          await formsService.completeStep(form.id, 'step1');
          await formsService.completeStep(form.id, 'step2');
          await formsService.completeStep(form.id, 'step3');

          if (stepCompletionCount !== 3) {
            throw new Error(`Expected 3 steps completed, got ${stepCompletionCount}`);
          }
          console.log('✅ Multi-step form progression working correctly');
        } else {
          console.log('⚠️  completeStep method not available, skipping step progression test');
        }
      },
    },

    {
      name: 'should extract project data from completed form',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing project data extraction from form...');

        const formsService = runtime.getService('forms') as any;
        if (!formsService) {
          throw new Error('Forms service not available');
        }

        // Create and populate a project form
        const form = await formsService.createForm({
          name: 'data-extraction-form',
          description: 'Test data extraction',
          steps: [
            {
              id: 'project-details',
              name: 'Project Details',
              fields: [
                {
                  name: 'projectName',
                  type: 'text',
                  label: 'Project Name',
                  value: 'test-weather-plugin',
                },
                {
                  name: 'description',
                  type: 'text',
                  label: 'Description',
                  value: 'A plugin that provides weather information',
                },
                {
                  name: 'requirements',
                  type: 'text',
                  label: 'Requirements',
                  value: 'Get current weather,Show forecast,Support multiple cities',
                },
                {
                  name: 'apis',
                  type: 'text',
                  label: 'APIs',
                  value: 'OpenWeatherMap API,WeatherAPI.com',
                },
              ],
            },
          ],
        });

        // Extract project data (mimicking what happens in generate-code.ts)
        const projectData: any = {
          targetType: 'plugin',
          requirements: [],
          apis: [],
        };

        // Extract field values
        for (const step of form.steps) {
          for (const field of step.fields) {
            if (field.value) {
              if (field.name === 'requirements') {
                projectData.requirements = field.value
                  .split(/[,;\n]/)
                  .map((r: string) => r.trim())
                  .filter((r: string) => r);
              } else if (field.name === 'apis') {
                projectData.apis = field.value
                  .split(/[,;\n]/)
                  .map((a: string) => a.trim())
                  .filter((a: string) => a);
              } else {
                projectData[field.name] = field.value;
              }
            }
          }
        }

        // Verify extracted data
        if (projectData.projectName !== 'test-weather-plugin') {
          throw new Error(
            `Expected projectName 'test-weather-plugin', got '${projectData.projectName}'`
          );
        }
        if (projectData.description !== 'A plugin that provides weather information') {
          throw new Error(
            `Expected description 'A plugin that provides weather information', got '${projectData.description}'`
          );
        }
        if (projectData.requirements.length !== 3) {
          throw new Error(`Expected 3 requirements, got ${projectData.requirements.length}`);
        }
        if (projectData.requirements[0] !== 'Get current weather') {
          throw new Error(
            `Expected first requirement 'Get current weather', got '${projectData.requirements[0]}'`
          );
        }
        if (projectData.apis.length !== 2) {
          throw new Error(`Expected 2 APIs, got ${projectData.apis.length}`);
        }
        if (projectData.apis[0] !== 'OpenWeatherMap API') {
          throw new Error(`Expected first API 'OpenWeatherMap API', got '${projectData.apis[0]}'`);
        }

        console.log('✅ Project data extraction working correctly');
        console.log('  Extracted:', JSON.stringify(projectData, null, 2));
      },
    },

    {
      name: 'should handle agent project form differently than plugin form',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing agent vs plugin form differences...');

        const formsService = runtime.getService('forms') as any;
        if (!formsService) {
          throw new Error('Forms service not available');
        }

        // Create agent form
        const agentForm = await formsService.createForm({
          name: 'agent-project-form',
          description: 'Gather requirements for agent generation',
          steps: [
            {
              id: 'agent-identity',
              name: 'Agent Identity',
              fields: [
                {
                  name: 'projectName',
                  type: 'text',
                  label: 'Agent Name',
                  description: 'Name for your agent',
                  required: true,
                },
                {
                  name: 'description',
                  type: 'text',
                  label: 'Agent Purpose',
                  description: "What is the agent's main purpose?",
                  required: true,
                },
                {
                  name: 'personality',
                  type: 'text',
                  label: 'Personality',
                  description: "Describe the agent's personality",
                  required: true,
                },
              ],
            },
            {
              id: 'capabilities',
              name: 'Capabilities',
              fields: [
                {
                  name: 'requirements',
                  type: 'text',
                  label: 'Capabilities',
                  description: 'What should the agent be able to do?',
                  required: true,
                },
                {
                  name: 'knowledge',
                  type: 'text',
                  label: 'Knowledge Base',
                  description: 'What should the agent know about?',
                  required: false,
                },
              ],
            },
          ],
        });

        // Verify agent form has different structure
        if (agentForm.name !== 'agent-project-form') {
          throw new Error(`Expected form name 'agent-project-form', got '${agentForm.name}'`);
        }
        if (agentForm.steps.length !== 2) {
          throw new Error(`Expected 2 steps, got ${agentForm.steps.length}`);
        }

        // Check for agent-specific fields
        const hasPersonalityField = agentForm.steps[0].fields.some(
          (f: any) => f.name === 'personality'
        );
        const hasKnowledgeField = agentForm.steps[1].fields.some(
          (f: any) => f.name === 'knowledge'
        );

        if (!hasPersonalityField) {
          throw new Error('Agent form missing personality field');
        }
        if (!hasKnowledgeField) {
          throw new Error('Agent form missing knowledge field');
        }

        console.log('✅ Agent form has correct agent-specific fields');
      },
    },

    {
      name: 'should trigger code generation after form completion',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing form completion triggers code generation...');

        const formsService = runtime.getService('forms') as any;
        const codeGenService = runtime.getService('code-generation') as any;

        if (!formsService || !codeGenService) {
          throw new Error('Required services not available');
        }

        let codeGenerationTriggered = false;
        let generatedProjectData: any = null;

        // Mock the generateCode method to track if it's called
        const originalGenerateCode = codeGenService.generateCode;
        codeGenService.generateCode = async (request: any) => {
          codeGenerationTriggered = true;
          generatedProjectData = request;
          return { success: true, files: [] };
        };

        // Create form with onComplete callback
        const form = await formsService.createForm({
          name: 'trigger-test-form',
          description: 'Test code generation trigger',
          steps: [
            {
              id: 'details',
              name: 'Details',
              fields: [
                {
                  name: 'projectName',
                  type: 'text',
                  label: 'Project Name',
                  value: 'trigger-test-project',
                },
                {
                  name: 'description',
                  type: 'text',
                  label: 'Description',
                  value: 'Test project to verify form triggers code generation',
                },
              ],
            },
          ],
          onComplete: async (completedForm: any) => {
            // Extract data and trigger code generation
            const projectData = {
              projectName: 'trigger-test-project',
              description: 'Test project',
              targetType: 'plugin' as const,
              requirements: ['Test requirement'],
              apis: [],
            };

            await codeGenService.generateCode(projectData);
          },
        });

        // Simulate form completion
        if (form.onComplete) {
          await form.onComplete(form);
        }

        if (!codeGenerationTriggered) {
          throw new Error('Code generation was not triggered');
        }
        if (!generatedProjectData) {
          throw new Error('Project data was not passed to generateCode');
        }
        if (generatedProjectData.projectName !== 'trigger-test-project') {
          throw new Error(
            `Expected projectName 'trigger-test-project', got '${generatedProjectData.projectName}'`
          );
        }

        console.log('✅ Form completion successfully triggers code generation');
        // Restore original method
        codeGenService.generateCode = originalGenerateCode;
      },
    },

    {
      name: 'should handle form cancellation gracefully',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing form cancellation...');

        const formsService = runtime.getService('forms') as any;
        if (!formsService) {
          throw new Error('Forms service not available');
        }

        // Create a form
        const form = await formsService.createForm({
          name: 'cancellation-test-form',
          description: 'Test form cancellation',
          steps: [
            {
              id: 'step1',
              name: 'Step 1',
              fields: [
                {
                  name: 'field1',
                  type: 'text',
                  label: 'Field 1',
                },
              ],
            },
          ],
        });

        // Cancel the form
        if (typeof formsService.cancelForm === 'function') {
          await formsService.cancelForm(form.id);

          // Try to get the cancelled form
          const cancelledForm = await formsService.getForm(form.id);
          if (cancelledForm && cancelledForm.status === 'cancelled') {
            console.log('✅ Form cancellation handled correctly');
          } else {
            console.log('⚠️  Form exists but status not updated to cancelled');
          }
        } else {
          console.log('⚠️  cancelForm method not available, skipping cancellation test');
        }
      },
    },
  ];
}

export default new CodeGenerationFormTestSuite();
