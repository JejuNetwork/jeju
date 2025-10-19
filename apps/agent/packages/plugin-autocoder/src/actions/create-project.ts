import {
  Action,
  ActionResult,
  HandlerCallback,
  type IAgentRuntime,
  Memory,
  State,
  type UUID,
  elizaLogger,
} from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';
import type { ProjectMetadata, ProjectType } from '../types/index';
import { FormsService } from '@elizaos/plugin-forms';

/**
 * Extract project name from user message
 */
function extractProjectName(text: string): string | null {
  // Look for quoted names
  const quotedMatch = text.match(/["']([^"']+)["']/);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // Look for patterns like "called X", "named X"
  const namedMatch = text.match(/(?:called|named)\s+(\S+)/i);
  if (namedMatch) {
    return namedMatch[1];
  }

  // Extract from specific patterns
  const patterns = [/create\s+(?:a\s+)?(?:new\s+)?(\S+)/i, /(?:build|make)\s+(?:a\s+)?(\S+)/i];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Extract project type from user message
 */
function extractProjectType(text: string): ProjectType {
  const lower = text.toLowerCase();

  if (lower.includes('plugin')) {
    return 'plugin';
  }
  if (lower.includes('agent') || lower.includes('bot')) {
    return 'agent';
  }
  if (lower.includes('workflow') || lower.includes('flow')) {
    return 'workflow';
  }
  if (lower.includes('mcp') || lower.includes('model context')) {
    return 'mcp';
  }
  if (lower.includes('app') || lower.includes('application')) {
    return 'full-stack';
  }

  // Default to plugin for ElizaOS
  return 'plugin';
}

function getFormTemplate(projectType: string) {
  switch (projectType) {
    case 'plugin':
      return {
        title: 'ElizaOS Plugin Project',
        description: "Let's gather information to create your plugin",
        fields: [
          {
            id: 'project_name',
            label: 'Project Name',
            type: 'text',
            placeholder: 'my-awesome-plugin',
            required: true,
            helpText: 'What would you like to name your plugin?',
          },
          {
            id: 'description',
            label: 'Description',
            type: 'textarea',
            placeholder: 'A plugin that does amazing things...',
            required: true,
            helpText: 'Describe what your plugin will do',
          },
          {
            id: 'requirements',
            label: 'Requirements',
            type: 'textarea',
            placeholder: 'List the key features and functionality...',
            required: true,
            helpText: 'What specific features or capabilities should this plugin have?',
          },
          {
            id: 'apis',
            label: 'External APIs (optional)',
            type: 'textarea',
            placeholder: 'OpenAI API, Discord API, etc.',
            required: false,
            helpText: 'List any external APIs or services this plugin will use',
          },
          {
            id: 'test_scenarios',
            label: 'Test Scenarios (optional)',
            type: 'textarea',
            placeholder: 'User asks for weather, plugin responds with...',
            required: false,
            helpText: 'Describe some test scenarios to validate the plugin works correctly',
          },
        ],
      };

    case 'agent':
      return {
        title: 'ElizaOS Agent Project',
        description: "Let's design your agent's personality and capabilities",
        fields: [
          {
            id: 'agent_name',
            label: 'Agent Name',
            type: 'text',
            placeholder: 'My Assistant',
            required: true,
            helpText: "What's your agent's name?",
          },
          {
            id: 'personality',
            label: 'Personality & Bio',
            type: 'textarea',
            placeholder: 'A helpful, friendly assistant who...',
            required: true,
            helpText: "Describe your agent's personality and background",
          },
          {
            id: 'capabilities',
            label: 'Capabilities',
            type: 'textarea',
            placeholder: 'Can help with coding, answer questions...',
            required: true,
            helpText: 'What should your agent be able to do?',
          },
          {
            id: 'plugins',
            label: 'Plugins to Include',
            type: 'textarea',
            placeholder: 'twitter, discord, knowledge...',
            required: false,
            helpText: 'Which ElizaOS plugins should this agent use?',
          },
        ],
      };

    case 'workflow':
      return {
        title: 'Workflow Project',
        description: 'Define your workflow automation',
        fields: [
          {
            id: 'workflow_name',
            label: 'Workflow Name',
            type: 'text',
            placeholder: 'data-processing-workflow',
            required: true,
          },
          {
            id: 'description',
            label: 'Description',
            type: 'textarea',
            placeholder: 'This workflow processes data and...',
            required: true,
          },
          {
            id: 'steps',
            label: 'Workflow Steps',
            type: 'textarea',
            placeholder: '1. Fetch data\n2. Process\n3. Store results',
            required: true,
            helpText: 'List the steps in your workflow',
          },
          {
            id: 'triggers',
            label: 'Triggers',
            type: 'textarea',
            placeholder: 'On schedule, webhook, manual...',
            required: false,
          },
        ],
      };

    default:
      return {
        title: 'New Project',
        description: 'Tell me about your project',
        fields: [
          {
            id: 'project_name',
            label: 'Project Name',
            type: 'text',
            required: true,
          },
          {
            id: 'description',
            label: 'Description',
            type: 'textarea',
            required: true,
          },
          {
            id: 'requirements',
            label: 'Requirements',
            type: 'textarea',
            required: true,
          },
        ],
      };
  }
}

export const createProjectAction: Action = {
  name: 'CREATE_PROJECT',
  similes: [
    'GENERATE_CODE',
    'BUILD_PROJECT',
    'CREATE_PLUGIN',
    'CREATE_AGENT',
    'BUILD_PLUGIN',
    'BUILD_AGENT',
    'MAKE_PROJECT',
    'NEW_PROJECT',
    'DEVELOP_PLUGIN',
    'CODE_PROJECT',
  ],
  description:
    'Create a new ElizaOS project (plugin, agent, workflow, etc.) with AI-generated code',

  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';

    // Check for project creation keywords
    const createKeywords = ['create', 'build', 'make', 'generate', 'develop', 'code'];
    const projectKeywords = ['project', 'plugin', 'agent', 'bot', 'workflow', 'app', 'application'];

    const hasCreateKeyword = createKeywords.some((keyword) => text.includes(keyword));
    const hasProjectKeyword = projectKeywords.some((keyword) => text.includes(keyword));

    // Also check for "I want to..." patterns
    const wantPatterns = [
      /i want to (?:create|build|make)/i,
      /i need (?:a|an) (?:new )?(?:plugin|agent|bot)/i,
      /can you (?:create|build|make|help me)/i,
      /help me (?:create|build|make)/i,
    ];

    const hasWantPattern = wantPatterns.some((pattern) => pattern.test(text));

    return (hasCreateKeyword && hasProjectKeyword) || hasWantPattern;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    elizaLogger.info('CREATE_PROJECT action triggered');

    const formsService = runtime.getService('forms') as FormsService | null;
    if (!formsService) {
      elizaLogger.error('Forms service not available');
      if (callback) {
        await callback({
          text: "I can't create projects right now - the forms service isn't available. Please try again later.",
          error: true,
        });
      }
      return {
        success: false,
        error: 'Forms service not available',
      };
    }

    const projectType = extractProjectType(message.content.text || '');
    const suggestedName = extractProjectName(message.content.text || '');

    elizaLogger.info(`Detected project type: ${projectType}, suggested name: ${suggestedName}`);

    // Create form for project details
    const formTemplate = getFormTemplate(projectType);

    const projectId = uuidv4();
    const formId = uuidv4() as UUID; // Separate UUID for the form
    const formData = {
      id: formId,
      ...formTemplate,
      onCancel: {
        action: 'CANCEL_FORM',
        data: { formId },
      },
      onSubmit: {
        action: 'GENERATE_CODE',
        data: {
          projectId,
          projectType,
        },
      },
    };

    // Create the form
    await formsService.createForm(formData);

    // Store project metadata
    const projectMetadata: ProjectMetadata = {
      id: projectId as UUID,
      name: suggestedName || 'Unnamed Project',
      type: projectType,
      description: message.content.text || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'planning',
    };

    await runtime.createMemory(
      {
        id: uuidv4() as UUID,
        entityId: runtime.agentId,
        roomId: message.roomId,
        agentId: runtime.agentId,
        content: {
          text: `Project metadata: ${JSON.stringify(projectMetadata)}`,
          type: 'project_metadata',
          metadata: projectMetadata,
        },
        createdAt: Date.now(),
      },
      'project_metadata'
    );

    // Send response with form
    const responseText =
      projectType === 'agent'
        ? "Great! Let's create your ElizaOS agent. I'll help you design their personality and capabilities."
        : projectType === 'plugin'
          ? "Excellent! Let's build your ElizaOS plugin. I'll help you define its features and functionality."
          : "Perfect! Let's create your project. Please fill out the details below.";

    if (callback) {
      await callback({
        text: responseText,
        form: formData,
      });
    }

    return {
      success: true,
      data: {
        projectId,
        projectType,
        formId: formData.id,
      },
    };
  },

  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: "I want to create a new ElizaOS plugin called 'weather-bot' that fetches weather data",
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "Excellent! Let's build your ElizaOS plugin. I'll help you define its features and functionality.",
          action: 'CREATE_PROJECT',
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Can you help me build an agent for customer support?',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "Great! Let's create your ElizaOS agent. I'll help you design their personality and capabilities.",
          action: 'CREATE_PROJECT',
        },
      },
    ],
  ],
};
