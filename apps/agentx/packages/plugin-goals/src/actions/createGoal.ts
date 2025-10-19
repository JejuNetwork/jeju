import {
  type Action,
  type ActionExample,
  formatMessages,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  ModelType,
  parseKeyValueXml,
  type State,
  type UUID,
  composePrompt,
} from '@elizaos/core';
import { GoalData } from '../types';
import type { GoalService } from '../services/goalService';

// Interface for parsed goal data
interface GoalInput {
  name: string;
  description?: string;
  ownerType: 'agent' | 'entity';
}

// Interface for similarity check result
interface SimilarityCheckResult {
  hasSimilar: boolean;
  similarGoalName?: string;
  confidence: number;
}

/**
 * Template for extracting goal information from the user's message.
 */
const extractGoalTemplate = `
# Task: Extract Goal Information

## User Message
{{text}}

## Message History
{{messageHistory}}

## Instructions
Parse the user's message to extract information for creating a new goal.
Determine if this goal is for the agent itself or for tracking a user's goal.

Goals should be long-term achievable objectives, not short-term tasks.

Return an XML object with these fields:
<response>
  <name>A clear, concise name for the goal</name>
  <description>Optional detailed description</description>
  <ownerType>Either "agent" (for agent's own goals) or "entity" (for user's goals)</ownerType>
</response>

If the message doesn't clearly indicate a goal to create, return empty response.

## Example Output Format
<response>
  <name>Learn Spanish fluently</name>
  <description>Achieve conversational fluency in Spanish within 6 months</description>
  <ownerType>entity</ownerType>
</response>
`;

/**
 * Template for checking if a similar goal already exists
 */
const checkSimilarityTemplate = `
# Task: Check Goal Similarity

## New Goal
Name: {{newGoalName}}
Description: {{newGoalDescription}}

## Existing Goals
{{existingGoals}}

## Instructions
Determine if the new goal is similar to any existing goals.
Consider goals similar if they have the same objective, even if worded differently.

Return an XML object:
<response>
  <hasSimilar>true or false</hasSimilar>
  <similarGoalName>Name of the similar goal if found</similarGoalName>
  <confidence>0-100 indicating confidence in similarity</confidence>
</response>

## Example
New Goal: "Get better at public speaking"
Existing Goal: "Improve presentation skills"
These are similar (confidence: 85)
`;

/**
 * Extracts goal information from the user's message.
 */
async function extractGoalInfo(
  runtime: IAgentRuntime,
  message: Memory,
  state: State
): Promise<GoalInput | null> {
  try {
    const messageHistory = formatMessages({
      messages: state.data.messages || [],
      entities: state.data.entities || [],
    });

    const prompt = composePrompt({
      state: {
        text: message.content.text || '',
        messageHistory,
      },
      template: extractGoalTemplate,
    });

    const result = await runtime.useModel(ModelType.TEXT_LARGE, {
      prompt,
      stopSequences: [],
    });

    logger.debug('Extract goal result:', result);

    // Parse XML from the text results
    const parsedResult = parseKeyValueXml(result);

    if (!parsedResult || !parsedResult.name) {
      logger.error('Failed to extract valid goal information from XML');
      return null;
    }

    return {
      name: String(parsedResult.name),
      description: parsedResult.description ? String(parsedResult.description) : undefined,
      ownerType: (parsedResult.ownerType === 'agent' ? 'agent' : 'entity') as 'agent' | 'entity',
    };
  } catch (error) {
    logger.error('Error extracting goal information:', error);
    return null;
  }
}

/**
 * Checks if a similar goal already exists
 */
async function checkForSimilarGoal(
  runtime: IAgentRuntime,
  newGoal: GoalInput,
  existingGoals: any[]
): Promise<SimilarityCheckResult> {
  try {
    if (existingGoals.length === 0) {
      return { hasSimilar: false, confidence: 0 };
    }

    // Format existing goals
    const existingGoalsText = existingGoals
      .map((goal) => `- ${goal.name}: ${goal.description || 'No description'}`)
      .join('\n');

    const prompt = composePrompt({
      state: {
        newGoalName: newGoal.name,
        newGoalDescription: newGoal.description || 'No description',
        existingGoals: existingGoalsText,
      },
      template: checkSimilarityTemplate,
    });

    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
      stopSequences: [],
    });

    const parsedResult = parseKeyValueXml(result) as SimilarityCheckResult | null;

    if (!parsedResult) {
      return { hasSimilar: false, confidence: 0 };
    }

    return {
      hasSimilar: String(parsedResult.hasSimilar) === 'true',
      similarGoalName: parsedResult.similarGoalName,
      confidence: parseInt(String(parsedResult.confidence || 0), 10),
    };
  } catch (error) {
    logger.error('Error checking for similar goals:', error);
    return { hasSimilar: false, confidence: 0 };
  }
}

/**
 * The CREATE_GOAL action allows the agent to create a new goal.
 */
export const createGoalAction: Action = {
  name: 'CREATE_GOAL',
  similes: ['NEW_GOAL', 'ADD_GOAL', 'SET_GOAL', 'MAKE_GOAL', 'ESTABLISH_GOAL'],
  description: 'Create a new goal or objective to track',
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const dataService = runtime.getService('goals') as GoalService;
    if (!dataService) {
      console.error('[CREATE_GOAL] Goals service not found');
      return false;
    }

    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback,
    _responses?: Memory[]
  ) => {
    logger.debug('[CREATE_GOAL] Handler started', {
      entityId: message.entityId,
      agentId: message.agentId,
      roomId: message.roomId,
    });

    try {
      const dataService = runtime.getService('goals') as GoalService;
      if (!dataService) {
        logger.error('[CREATE_GOAL] Goals service not found');
        throw new Error('Goal tracking is not available at the moment.');
      }

      // Extract goal information from the message
      const goalInput = await extractGoalInfo(runtime, message, state || ({} as State));

      if (!goalInput) {
        logger.debug('[CREATE_GOAL] Could not extract goal information');
        await callback?.({
          text: 'I could not understand what goal you want to create. Please specify a clear goal.',
          actions: ['CREATE_GOAL_FAILED'],
          source: message.content.source,
        });
        return {
          success: false,
          data: {
            actionName: 'CREATE_GOAL',
            error: 'Could not extract goal information',
          },
          values: {
            success: false,
          },
        };
      }

      // Determine owner ID based on ownerType
      const ownerId =
        goalInput.ownerType === 'agent' ? (runtime.agentId as UUID) : (message.entityId as UUID);

      // Check for existing similar goals
      const existingGoals = await dataService.getGoals({
        ownerType: goalInput.ownerType,
        ownerId: ownerId,
      });

      // Calculate active goal count
      const activeGoalCount = existingGoals.filter((g) => !g.isCompleted).length;

      const similarityCheck = await checkForSimilarGoal(runtime, goalInput, existingGoals);

      if (similarityCheck.hasSimilar && similarityCheck.confidence > 70) {
        if (callback) {
          await callback({
            text: `It looks like there's already a similar goal: "${similarityCheck.similarGoalName}". Are you sure you want to add this as a separate goal?`,
            actions: ['CREATE_GOAL_SIMILAR_EXISTS'],
            source: message.content.source,
          });
        }
        return {
          data: {
            actionName: 'CREATE_GOAL',
            warning: 'Similar goal exists',
            similarGoal: similarityCheck.similarGoalName,
            confidence: similarityCheck.confidence,
          },
          values: {
            success: false,
            hasSimilar: true,
            similarGoal: similarityCheck.similarGoalName,
          },
          success: false,
        };
      }

      // Step 6: Create the goal
      const tags = ['GOAL'];
      if (goalInput.ownerType === 'agent') {
        tags.push('agent-goal');
      } else {
        tags.push('entity-goal');
      }

      const metadata: Record<string, any> = {
        createdAt: new Date().toISOString(),
      };

      const createdGoalId = await dataService.createGoal({
        agentId: runtime.agentId,
        ownerType: goalInput.ownerType,
        ownerId,
        name: goalInput.name,
        description: goalInput.description || goalInput.name,
        metadata,
        tags,
      });

      if (!createdGoalId) {
        throw new Error('Failed to create goal');
      }

      // Step 7: Send success message with guidance based on goal count
      let successMessage = `✅ New goal created: "${goalInput.name}"`;

      if (activeGoalCount >= 4) {
        successMessage += `\n\n⚠️ You now have ${activeGoalCount + 1} active goals. Consider focusing on completing some of these before adding more.`;
      }

      if (callback) {
        await callback({
          text: successMessage,
          actions: ['CREATE_GOAL_SUCCESS'],
          source: message.content.source,
        });
      }

      return {
        data: {
          actionName: 'CREATE_GOAL',
          createdGoalId,
          goalInfo: goalInput,
          activeGoalCount: activeGoalCount + 1,
        },
        values: {
          success: true,
          goalId: createdGoalId,
          goalName: goalInput.name,
          ownerType: goalInput.ownerType,
          totalGoals: activeGoalCount + 1,
        },
        success: true,
      };
    } catch (error) {
      logger.error('Error in createGoal handler:', error);
      if (callback) {
        await callback({
          text: 'I encountered an error while creating your goal. Please try again.',
          actions: ['CREATE_GOAL_FAILED'],
          source: message.content.source,
        });
      }
      return {
        data: {
          actionName: 'CREATE_GOAL',
          error: error instanceof Error ? error.message : String(error),
        },
        values: {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        success: false,
      };
    }
  },

  examples: [
    // Multi-action: Create goal then list all goals to show chaining workflow
    [
      {
        name: '{{user}}',
        content: {
          text: 'Create a goal to learn French fluently and show me all my goals',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "I'll create a goal to learn French fluently and then show you all your goals.",
          thought:
            'The user wants to create a new goal and see their complete goal list. I need to chain CREATE_GOAL with LIST_GOALS to complete this workflow in the proper sequence.',
          actions: ['CREATE_GOAL', 'LIST_GOALS'],
        },
      },
    ],
    // Multi-action: Create goal then confirm it to demonstrate goal lifecycle workflow
    [
      {
        name: '{{user}}',
        content: {
          text: 'Add a goal to run a marathon and ask me to confirm it',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "I'll create a goal to run a marathon and then ask for your confirmation to ensure it's exactly what you want.",
          thought:
            'The user wants goal creation followed by confirmation. This demonstrates the create-confirm workflow pattern where we create the goal and then verify it with the user before finalizing.',
          actions: ['CREATE_GOAL', 'CONFIRM_GOAL'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'I want to set a goal to learn French fluently',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: '✅ New goal created: "Learn French fluently"',
          actions: ['CREATE_GOAL_SUCCESS'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'Add a goal for me to run a marathon',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: '✅ New goal created: "Run a marathon"',
          actions: ['CREATE_GOAL_SUCCESS'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'I have a goal to get better at cooking',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: '✅ New goal created: "Get better at cooking"\n\n⚠️ You now have 5 active goals. Consider focusing on completing some of these before adding more.',
          actions: ['CREATE_GOAL_SUCCESS'],
        },
      },
    ],
  ] as ActionExample[][],
};

export default createGoalAction;
