import {
  Action,
  ActionResult,
  HandlerCallback,
  type IAgentRuntime,
  Memory,
  State,
  elizaLogger,
} from '@elizaos/core';
import { CodeGenerationService } from '../services/CodeGenerationService';
import type { ProjectType } from '../types/index';
import { FormsService, type Form } from '@elizaos/plugin-forms';

export const generateCodeAction: Action = {
  name: 'GENERATE_CODE',
  similes: [
    'BUILD_CODE',
    'CREATE_CODE',
    'WRITE_CODE',
    'DEVELOP_CODE',
    'IMPLEMENT_CODE',
    'CODE_GENERATION',
    'GENERATE_PROJECT',
    'BUILD_PROJECT',
  ],
  description: 'Generate code for ElizaOS projects using AI',

  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';

    // Check if this is a form submission
    const data = message.content.data as { action?: string };
    if (data?.action === 'GENERATE_CODE') {
      return true;
    }

    // Check for code generation keywords
    const genKeywords = ['generate', 'create', 'build', 'write', 'implement', 'code'];
    const contextKeywords = ['plugin', 'agent', 'action', 'provider', 'service'];

    const hasGenKeyword = genKeywords.some((keyword) => text.includes(keyword));
    const hasContextKeyword = contextKeywords.some((keyword) => text.includes(keyword));

    return hasGenKeyword && hasContextKeyword;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    elizaLogger.info('GENERATE_CODE action triggered');

    const codeGenService = runtime.getService('code-generation') as CodeGenerationService;
    if (!codeGenService) {
      elizaLogger.error('Code generation service not available');
      if (callback) {
        await callback({
          text: "I can't generate code right now - the code generation service isn't available. Please ensure all required API keys are configured.",
          error: true,
        });
      }
      return {
        success: false,
        error: 'Code generation service not available',
      };
    }

    const formsService = runtime.getService('forms') as FormsService | null;

    // Extract project type and data
    const projectType = await extractProjectType(runtime, message, state);
    elizaLogger.info(`Project type: ${projectType}`);

    // Handle form flow
    if (formsService) {
      // Check if we have active forms
      const activeForms = await formsService.listForms('active');
      const projectForm = activeForms.find((f: Form) => f.id.startsWith('project-'));

      if (projectForm && projectForm.status !== 'completed') {
        // We have an incomplete form, prompt for next step
        const nextStepPrompt = getNextStepPrompt(projectForm, message.content.text || '');

        if (callback) {
          await callback({
            text: nextStepPrompt,
            form: projectForm,
          });
        }

        return {
          success: true,
          data: {
            status: 'collecting_requirements',
            formId: projectForm.id,
          },
        };
      }

      // Check if this is a form submission
      const messageData = message.content.data as {
        formId?: string;
        formData?: any;
        action?: string;
        projectId?: string;
        projectType?: string;
      };
      if (messageData?.formId && messageData?.formData) {
        // Process form submission
        const formData = messageData.formData;
        const projectData = extractProjectData(formData);

        // Start generation
        if (callback) {
          await callback({
            text: `🚀 Starting code generation for your ${projectData.targetType}...\n\nThis may take a few minutes. I'll:\n1. Research best practices\n2. Generate the code structure\n3. Implement all features\n4. Run quality checks`,
          });
        }

        const result = await codeGenService.generateCode({
          projectName: projectData.projectName,
          description: projectData.description,
          requirements: projectData.requirements,
          apis: projectData.apis || [],
          targetType: projectData.targetType,
          testScenarios: projectData.testScenarios || [],
        });

        if (!result.success) {
          if (callback) {
            await callback({
              text: `❌ Code generation failed: ${result.errors?.join('\n') || 'Unknown error'}`,
              error: true,
            });
          }
          return {
            success: false,
            error: result.errors?.join('\n') || 'Code generation failed',
          };
        }

        // Prepare success response
        let successMessage = '✅ **Code generation complete!**\n\n';
        successMessage += `📁 **Project:** ${projectData.projectName}\n`;
        successMessage += `📋 **Type:** ${projectData.targetType}\n`;

        if (result.files) {
          successMessage += `📄 **Files generated:** ${result.files.length}\n`;
        }

        if (result.projectPath) {
          successMessage += `\n📍 **Project location:** ${result.projectPath}`;
        }

        if (result.executionResults) {
          successMessage += '\n\n**Quality Checks:**\n';
          successMessage += `${result.executionResults.lintPass ? '✅' : '❌'} Linting\n`;
          successMessage += `${result.executionResults.typesPass ? '✅' : '❌'} Type checking\n`;
          successMessage += `${result.executionResults.testsPass ? '✅' : '❌'} Tests\n`;
          successMessage += `${result.executionResults.buildPass ? '✅' : '❌'} Build\n`;
        }

        successMessage += `\n\n🎉 Your ${projectData.targetType} is ready! Let me know if you need any modifications.`;

        if (callback) {
          await callback({
            text: successMessage,
            data: {
              projectPath: result.projectPath,
              files: result.files,
            },
          });
        }

        return {
          success: true,
          data: {
            projectPath: result.projectPath,
            filesGenerated: result.files?.length || 0,
            executionResults: result.executionResults,
          },
        };
      }
    }

    // Direct code generation without form
    const requirements = extractRequirements(message.content.text || '');

    if (!requirements || requirements.length === 0) {
      if (callback) {
        await callback({
          text: 'I need more details about what you want to build. Could you describe:\n- What type of project (plugin, agent, etc.)?\n- What features or functionality it should have?\n- Any specific APIs or services it should use?',
          error: false,
        });
      }
      return {
        success: false,
        error: 'Insufficient requirements provided',
      };
    }

    const projectName = extractProjectName(message.content.text || '') || `project-${Date.now()}`;

    if (callback) {
      await callback({
        text: `🚀 Starting code generation based on your requirements...\n\nGenerating: ${projectName}\nType: ${projectType}`,
      });
    }

    const result = await codeGenService.generateCode({
      projectName,
      description: message.content.text || '',
      requirements,
      apis: extractAPIs(message.content.text || ''),
      targetType: projectType as ProjectType,
    });

    if (!result.success) {
      if (callback) {
        await callback({
          text: `❌ Code generation failed: ${result.errors?.join('\n') || 'Unknown error'}`,
          error: true,
        });
      }
      return {
        success: false,
        error: result.errors?.join('\n') || 'Code generation failed',
      };
    }

    let responseText = '✅ Code generation complete!\n\n';
    responseText += `📁 Project: ${projectName}\n`;

    if (result.files) {
      responseText += `📄 Files generated: ${result.files.length}\n`;
    }

    if (result.projectPath) {
      responseText += `📍 Location: ${result.projectPath}\n`;
    }

    responseText += '\n🎉 Your code is ready!';

    if (callback) {
      await callback({
        text: responseText,
        data: result,
      });
    }

    return {
      success: true,
      data: result,
    };
  },

  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Generate a plugin that monitors crypto prices and sends alerts',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "I'll generate a crypto price monitoring plugin for you. Let me create the code structure with price tracking and alert functionality.",
          action: 'GENERATE_CODE',
        },
      },
    ],
  ],
};

// Helper functions
async function extractProjectType(
  runtime: IAgentRuntime,
  message: Memory,
  _state?: State
): Promise<string> {
  const text = message.content.text?.toLowerCase() || '';

  if (text.includes('plugin')) {
    return 'plugin';
  }
  if (text.includes('agent') || text.includes('bot')) {
    return 'agent';
  }
  if (text.includes('workflow')) {
    return 'workflow';
  }
  if (text.includes('mcp')) {
    return 'mcp';
  }
  if (text.includes('app') || text.includes('application')) {
    return 'full-stack';
  }

  // Check form data
  const data = message.content.data as {
    action?: string;
    projectId?: string;
    projectType?: string;
    formId?: string;
    formData?: any;
  };
  if (data?.projectType) {
    return data.projectType;
  }

  // Check recent memories for context
  const recentMemories = await runtime.getMemories({
    roomId: message.roomId,
    count: 10,
    unique: false,
    tableName: 'messages',
  });

  for (const memory of recentMemories) {
    const memText = memory.content.text?.toLowerCase() || '';
    if (memText.includes('plugin')) {
      return 'plugin';
    }
    if (memText.includes('agent')) {
      return 'agent';
    }
    if (memText.includes('workflow')) {
      return 'workflow';
    }
  }

  return 'plugin'; // default
}

function extractRequirements(text: string): string[] {
  const requirements: string[] = [];

  // Look for bullet points or numbered lists
  const lines = text.split('\n');
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.match(/^[-*•]/) || trimmed.match(/^\d+[.)]/)) {
      requirements.push(trimmed.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, ''));
    }
  });

  // If no list found, extract from sentences
  if (requirements.length === 0) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    sentences.forEach((sentence) => {
      if (sentence.includes('should') || sentence.includes('must') || sentence.includes('need')) {
        requirements.push(sentence.trim());
      }
    });
  }

  // If still no requirements, use the whole text
  if (requirements.length === 0 && text.length > 20) {
    requirements.push(text);
  }

  return requirements;
}

function extractAPIs(text: string): string[] {
  const apis: string[] = [];
  const apiPatterns = [
    /(\w+)\s+API/gi,
    /API[:\s]+(\w+)/gi,
    /uses?\s+(\w+)/gi,
    /integrates?\s+with\s+(\w+)/gi,
  ];

  apiPatterns.forEach((pattern) => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        apis.push(match[1]);
      }
    }
  });

  return [...new Set(apis)]; // Remove duplicates
}

function extractProjectName(text: string): string | null {
  // Look for quoted names
  const quotedMatch = text.match(/["']([^"']+)["']/);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // Look for "called" or "named" patterns
  const namedMatch = text.match(/(?:called|named)\s+(\S+)/i);
  if (namedMatch) {
    return namedMatch[1];
  }

  return null;
}

function getNextStepPrompt(form: any, completedStepId: string): string {
  // Determine next step in form based on what was just completed
  const steps = form.steps || [];
  const currentStepIndex = steps.findIndex((s: any) => s.id === completedStepId);

  if (currentStepIndex >= 0 && currentStepIndex < steps.length - 1) {
    const nextStep = steps[currentStepIndex + 1];
    return `Great! Now let's ${nextStep.title}. ${nextStep.description || ''}`;
  }

  return 'Perfect! I have all the information I need. Let me start generating your code...';
}

function extractProjectData(formData: any): any {
  // Extract and structure project data from form
  const data: any = {
    projectName: formData.projectName || formData.project_name || 'unnamed-project',
    description: formData.description || '',
    requirements: [],
    apis: [],
    targetType: formData.projectType || 'plugin',
  };

  // Extract requirements
  if (formData.requirements) {
    data.requirements = formData.requirements.split('\n').filter((r: string) => r.trim());
  }

  // Extract APIs
  if (formData.apis) {
    data.apis = formData.apis
      .split(/[,\n]/)
      .map((a: string) => a.trim())
      .filter(Boolean);
  }

  // Extract test scenarios
  if (formData.test_scenarios) {
    data.testScenarios = formData.test_scenarios.split('\n').filter((s: string) => s.trim());
  }

  // GitHub settings
  data.createGithubRepo = formData.create_github === true || formData.create_github === 'true';
  data.privateRepo = formData.private_repo === true || formData.private_repo === 'true';

  // Agent-specific data
  if (formData.agent_name) {
    data.projectName = formData.agent_name;
    data.targetType = 'agent';
  }

  if (formData.personality) {
    data.requirements.push(`Agent personality: ${formData.personality}`);
  }

  if (formData.capabilities) {
    data.requirements.push(`Agent capabilities: ${formData.capabilities}`);
  }

  if (formData.plugins) {
    const plugins = formData.plugins
      .split(/[,\n]/)
      .map((p: string) => p.trim())
      .filter(Boolean);
    data.requirements.push(`Include plugins: ${plugins.join(', ')}`);
  }

  return data;
}
