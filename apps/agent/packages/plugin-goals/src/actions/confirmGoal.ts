import {
  type Action,
  type ActionExample,
  composePrompt,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  ModelType,
  parseKeyValueXml,
  type State,
  formatMessages,
} from '@elizaos/core';
import type { GoalService } from '../services/goalService';

// Interface for confirmation data stored in state
interface PendingGoalData {
  name: string;
  description?: string;
  taskType: 'daily' | 'one-off' | 'aspirational';
  priority?: 1 | 2 | 3 | 4;
  urgent?: boolean;
  dueDate?: string;
  recurring?: 'daily' | 'weekly' | 'monthly';
  tags?: string[];
  metadata?: Record<string, any>;
}

// Interface for confirmation response
interface ConfirmationResponse {
  isConfirmation: boolean;
  shouldProceed: boolean;
  modifications?: string;
}

/**
 * Template for extracting confirmation intent from user message
 */
const extractConfirmationTemplate = `
# Task: Extract Confirmation Intent

## User Message
{{text}}

## Message History
{{messageHistory}}

## Pending Task Details
{{pendingTask}}

## Instructions
Determine if the user is confirming, rejecting, or modifying the pending task creation.
Look for:
- Affirmative responses (yes, confirm, ok, do it, go ahead, etc.)
- Negative responses (no, cancel, nevermind, stop, etc.)
- Modification requests (change X to Y, make it priority 1, etc.)

Return an XML object with:
<response>
  <isConfirmation>true/false - whether this is a response to the pending task</isConfirmation>
  <shouldProceed>true/false - whether to create the task</shouldProceed>
  <modifications>Any requested changes to the task, or 'none'</modifications>
</response>

## Example Output
<response>
  <isConfirmation>true</isConfirmation>
  <shouldProceed>true</shouldProceed>
  <modifications>none</modifications>
</response>
`;

/**
 * Extracts confirmation intent from the user's message
 */
async function extractConfirmationIntent(
  runtime: IAgentRuntime,
  message: Memory,
  pendingTask: PendingGoalData | null,
  state: State
): Promise<ConfirmationResponse> {
  try {
    if (!pendingTask) {
      return { isConfirmation: false, shouldProceed: false };
    }

    const messageHistory = formatMessages({
      messages: state.data?.messages || [],
      entities: state.data?.entities || [],
    });

    const pendingTaskText = `
Name: ${pendingTask.name}
Type: ${pendingTask.taskType}
${pendingTask.priority ? `Priority: ${pendingTask.priority}` : ''}
${pendingTask.urgent ? 'Urgent: Yes' : ''}
${pendingTask.dueDate ? `Due Date: ${pendingTask.dueDate}` : ''}
${pendingTask.recurring ? `Recurring: ${pendingTask.recurring}` : ''}
`;

    const prompt = composePrompt({
      state: {
        text: message.content.text || '',
        messageHistory,
        pendingTask: pendingTaskText,
      },
      template: extractConfirmationTemplate,
    });

    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
      stopSequences: [],
    });

    const parsedResult = parseKeyValueXml(result) as ConfirmationResponse | null;

    if (!parsedResult) {
      logger.error('Failed to parse confirmation response');
      return { isConfirmation: false, shouldProceed: false };
    }

    return {
      isConfirmation: String(parsedResult.isConfirmation) === 'true',
      shouldProceed: String(parsedResult.shouldProceed) === 'true',
      modifications: parsedResult.modifications === 'none' ? undefined : parsedResult.modifications,
    };
  } catch (error) {
    logger.error('Error extracting confirmation intent:', error);
    return { isConfirmation: false, shouldProceed: false };
  }
}

/**
 * The CONFIRM_GOAL action handles the confirmation step of goal creation
 */
export const confirmGoalAction: Action = {
  name: 'CONFIRM_GOAL',
  similes: ['CONFIRM_TASK', 'APPROVE_GOAL', 'APPROVE_TASK', 'GOAL_CONFIRM'],
  description:
    'Confirms or cancels a pending goal creation after user review. Can be chained with LIST_GOALS to see updated list or UPDATE_GOAL to modify the confirmed goal.',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    // This action is only valid if there's a pending goal in the state
    const pendingGoal = state?.data?.pendingGoal as PendingGoalData | undefined;
    return !!pendingGoal;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options: any,
    callback?: HandlerCallback
  ) => {
    try {
      if (!state) {
        if (callback) {
          await callback({
            text: 'Unable to process confirmation without state context.',
            actions: ['CONFIRM_GOAL_ERROR'],
            source: message.content.source,
          });
        }
        return {
          text: 'Unable to process confirmation without state context.',
          data: {
            actionName: 'CONFIRM_GOAL',
            error: 'missing_state_context',
          },
          values: {
            success: false,
            errorType: 'missing_state_context',
          },
          success: false,
        };
      }

      const pendingGoal = state.data?.pendingGoal as PendingGoalData | undefined;
      if (!pendingGoal) {
        if (callback) {
          await callback({
            text: "I don't have a pending task to confirm. Would you like to create a new task?",
            actions: ['CONFIRM_GOAL_NO_PENDING'],
            source: message.content.source,
          });
        }
        return {
          text: "I don't have a pending task to confirm. Would you like to create a new task?",
          data: {
            actionName: 'CONFIRM_GOAL',
            error: 'no_pending_goal',
          },
          values: {
            success: false,
            errorType: 'no_pending_goal',
          },
          success: false,
        };
      }

      if (!message.roomId || !message.entityId) {
        if (callback) {
          await callback({
            text: 'I cannot confirm a goal without a room and entity context.',
            actions: ['CONFIRM_GOAL_ERROR'],
            source: message.content.source,
          });
        }
        return {
          text: 'I cannot confirm a goal without a room and entity context.',
          data: {
            actionName: 'CONFIRM_GOAL',
            error: 'missing_context',
          },
          values: {
            success: false,
            errorType: 'missing_context',
          },
          success: false,
        };
      }

      // Extract confirmation intent
      const confirmation = await extractConfirmationIntent(runtime, message, pendingGoal, state);

      if (!confirmation.isConfirmation) {
        // User said something unrelated to the confirmation
        if (callback) {
          await callback({
            text: `I'm still waiting for your confirmation on the task "${pendingGoal.name}". Would you like me to create it?`,
            actions: ['CONFIRM_GOAL_WAITING'],
            source: message.content.source,
          });
        }
        return {
          text: `I'm still waiting for your confirmation on the task "${pendingGoal.name}". Would you like me to create it?`,
          data: {
            actionName: 'CONFIRM_GOAL',
            status: 'waiting_for_confirmation',
            pendingGoalName: pendingGoal.name,
          },
          values: {
            success: false,
            awaiting_confirmation: true,
            goalName: pendingGoal.name,
          },
          success: false,
        };
      }

      if (!confirmation.shouldProceed) {
        // User rejected the task
        // Clear the pending goal from state
        delete state.data.pendingGoal;

        if (callback) {
          await callback({
            text: "Okay, I've cancelled the task creation. Let me know if you'd like to create a different task.",
            actions: ['CONFIRM_GOAL_CANCELLED'],
            source: message.content.source,
          });
        }
        return {
          text: "Okay, I've cancelled the task creation. Let me know if you'd like to create a different task.",
          data: {
            actionName: 'CONFIRM_GOAL',
            status: 'cancelled',
            cancelledGoalName: pendingGoal.name,
          },
          values: {
            success: true,
            goalCancelled: true,
            goalName: pendingGoal.name,
          },
          success: true,
        };
      }

      // User confirmed - create the task
      const dataService = runtime.getService('goals') as GoalService;

      // Check for duplicates one more time
      const existingGoals = await dataService.getGoals({
        ownerId: message.entityId,
        ownerType: 'entity',
        isCompleted: false,
      });

      const duplicateGoal = existingGoals.find((g) => g.name.trim() === pendingGoal.name.trim());

      if (duplicateGoal) {
        delete state.data.pendingGoal;
        if (callback) {
          await callback({
            text: `It looks like you already have an active goal named "${pendingGoal.name}". I haven't added a duplicate.`,
            actions: ['CONFIRM_GOAL_DUPLICATE'],
            source: message.content.source,
          });
        }
        return {
          text: `It looks like you already have an active goal named "${pendingGoal.name}". I haven't added a duplicate.`,
          data: {
            actionName: 'CONFIRM_GOAL',
            error: 'duplicate_goal',
            duplicateGoalName: pendingGoal.name,
          },
          values: {
            success: false,
            errorType: 'duplicate_goal',
            goalName: pendingGoal.name,
          },
          success: false,
        };
      }

      // Create the goal
      const createdGoalId = await dataService.createGoal({
        agentId: runtime.agentId,
        ownerType: 'entity',
        ownerId: message.entityId,
        name: pendingGoal.name,
        description: pendingGoal.description || pendingGoal.name,
        metadata: {
          ...pendingGoal.metadata,
          taskType: pendingGoal.taskType,
          priority: pendingGoal.priority,
          urgent: pendingGoal.urgent,
          dueDate: pendingGoal.dueDate,
          recurring: pendingGoal.recurring,
        },
        tags: pendingGoal.tags || [],
      });

      if (!createdGoalId) {
        throw new Error('Failed to create goal');
      }

      // Clear the pending goal from state
      delete state.data.pendingGoal;

      // Send success message
      let successMessage = '';
      if (pendingGoal.taskType === 'daily') {
        successMessage = `✅ Created daily task: "${pendingGoal.name}".`;
      } else if (pendingGoal.taskType === 'one-off') {
        const priorityText = `Priority ${pendingGoal.priority || 3}`;
        const urgentText = pendingGoal.urgent ? ', Urgent' : '';
        const dueDateText = pendingGoal.dueDate
          ? `, Due: ${new Date(pendingGoal.dueDate).toLocaleDateString()}`
          : '';
        successMessage = `✅ Created task: "${pendingGoal.name}" (${priorityText}${urgentText}${dueDateText})`;
      } else {
        successMessage = `✅ Created aspirational goal: "${pendingGoal.name}"`;
      }

      if (confirmation.modifications) {
        successMessage += `\n\nNote: I created the task as originally described. The modifications you mentioned ("${confirmation.modifications}") weren't applied. You can use UPDATE_GOAL to make changes.`;
      }

      if (callback) {
        await callback({
          text: successMessage,
          actions: ['CONFIRM_GOAL_SUCCESS'],
          source: message.content.source,
        });
      }

      return {
        text: successMessage,
        data: {
          actionName: 'CONFIRM_GOAL',
          status: 'success',
          goalId: createdGoalId,
          goalName: pendingGoal.name,
          taskType: pendingGoal.taskType,
          priority: pendingGoal.priority,
          urgent: pendingGoal.urgent,
          dueDate: pendingGoal.dueDate,
          modifications: confirmation.modifications,
        },
        values: {
          success: true,
          goalCreated: true,
          goalId: createdGoalId,
          goalName: pendingGoal.name,
        },
        success: true,
      };
    } catch (error) {
      logger.error('Error in confirmGoal handler:', error);
      const errorMessage = 'I encountered an error while confirming your goal. Please try again.';
      if (callback) {
        await callback({
          text: errorMessage,
          actions: ['CONFIRM_GOAL_ERROR'],
          source: message.content.source,
        });
      }
      return {
        text: errorMessage,
        data: {
          actionName: 'CONFIRM_GOAL',
          error: 'execution_error',
          errorDetails: error instanceof Error ? error.message : 'Unknown error',
        },
        values: {
          success: false,
          errorType: 'execution_error',
          hasError: true,
        },
        success: false,
      };
    }
  },

  examples: [
    // Multi-action: Create goal preview, confirm, then list all goals to show complete workflow
    [
      {
        name: '{{user}}',
        content: {
          text: 'Add a goal to finish my taxes by April 15 and show me all my goals after',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "I'll create a one-off goal: 'Finish taxes' with Priority 2, Due April 15. After you confirm, I'll show you all your goals.",
          thought:
            'The user wants to create a goal with confirmation and then see their complete goal list. I need to chain CREATE_GOAL, CONFIRM_GOAL, and LIST_GOALS to handle the full workflow from creation through confirmation to viewing the updated list.',
          actions: ['CREATE_GOAL_PREVIEW'],
        },
      },
      {
        name: '{{user}}',
        content: {
          text: 'Yes, that looks good',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "✅ Created task: 'Finish taxes' (Priority 2, Due: 4/15/2024). Now showing all your goals.",
          actions: ['CONFIRM_GOAL_SUCCESS', 'LIST_GOALS'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'Add a goal to finish my taxes by April 15',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "I'll create a one-off goal: 'Finish taxes' with Priority 2, Due April 15.\n\nIs this correct?",
          actions: ['CREATE_GOAL_PREVIEW'],
        },
      },
      {
        name: '{{user}}',
        content: {
          text: 'Yes, that looks good',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "✅ Created task: 'Finish taxes' (Priority 2, Due: 4/15/2024)",
          actions: ['CONFIRM_GOAL_SUCCESS'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'I want to add a daily task to exercise',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "I'll create a daily goal: 'Exercise'.\n\nIs this correct?",
          actions: ['CREATE_GOAL_PREVIEW'],
        },
      },
      {
        name: '{{user}}',
        content: {
          text: 'Actually, nevermind',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "Okay, I've cancelled the task creation. Let me know if you'd like to create a different task.",
          actions: ['CONFIRM_GOAL_CANCELLED'],
        },
      },
    ],
  ] as ActionExample[][],
};

export default confirmGoalAction;
