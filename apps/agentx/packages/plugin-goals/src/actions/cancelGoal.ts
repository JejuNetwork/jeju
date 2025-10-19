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
import type { GoalData } from '../types';

// Interface for task cancellation properties
interface TaskCancellation {
  taskId: string;
  taskName: string;
  isFound: boolean;
}

/**
 * Template for extracting task cancellation information from user message
 */
const extractCancellationTemplate = `
# Task: Extract Task Cancellation Information

## User Message
{{text}}

## Message History
{{messageHistory}}

## Available Tasks
{{availableTasks}}

## Instructions
Parse the user's message to identify which task they want to cancel or delete.
Match against the list of available tasks by name or description.
If multiple tasks have similar names, choose the closest match.

Return an XML object with:\n<response>\n  <taskId>ID of the task being cancelled, or \'null\' if not found</taskId>\n  <taskName>Name of the task being cancelled, or \'null\' if not found</taskName>\n  <isFound>\'true\' or \'false\' indicating if a matching task was found</isFound>\n</response>\n\n## Example Output Format\n<response>\n  <taskId>123e4567-e89b-12d3-a456-426614174000</taskId>\n  <taskName>Finish report</taskName>\n  <isFound>true</isFound>\n</response>\n\nIf no matching task was found:\n<response>\n  <taskId>null</taskId>\n  <taskName>null</taskName>\n  <isFound>false</isFound>\n</response>\n`;

/**
 * Extracts which goal the user wants to cancel
 */
async function extractTaskCancellation(
  runtime: IAgentRuntime,
  message: Memory,
  availableGoals: GoalData[],
  state: State
): Promise<TaskCancellation> {
  try {
    // Format available tasks for the prompt
    const tasksText = availableGoals
      .map((task) => {
        return `ID: ${task.id}\nName: ${task.name}\nDescription: ${task.description || task.name}\nTags: ${task.tags?.join(', ') || 'none'}\n`;
      })
      .join('\n---\n');

    const messageHistory = formatMessages({
      messages: state.data?.messages || [],
      entities: state.data?.entities || [],
    });

    const prompt = composePrompt({
      state: {
        text: message.content.text || '',
        availableTasks: tasksText,
        messageHistory,
      },
      template: extractCancellationTemplate,
    });

    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
      stopSequences: [],
    });

    // Parse XML from the text results
    const parsedResult = parseKeyValueXml(result) as TaskCancellation | null;

    logger.debug('Parsed XML Result', parsedResult);

    if (!parsedResult || typeof parsedResult.isFound === 'undefined') {
      logger.error('Failed to parse valid task cancellation information from XML');
      return { taskId: '', taskName: '', isFound: false };
    }

    // Convert string 'true'/'false' to boolean and handle 'null' strings
    const finalResult: TaskCancellation = {
      taskId: parsedResult.taskId === 'null' ? '' : String(parsedResult.taskId || ''),
      taskName: parsedResult.taskName === 'null' ? '' : String(parsedResult.taskName || ''),
      isFound: String(parsedResult.isFound) === 'true',
    };

    return finalResult;
  } catch (error) {
    logger.error('Error extracting task cancellation information:', error);
    return { taskId: '', taskName: '', isFound: false };
  }
}

/**
 * The CANCEL_GOAL action allows users to cancel/delete a task.
 */
export const cancelGoalAction: Action = {
  name: 'CANCEL_GOAL',
  similes: ['DELETE_GOAL', 'REMOVE_TASK', 'DELETE_TASK', 'REMOVE_GOAL'],
  description:
    "Cancels and deletes a goal item from the user's task list immediately. Can be chained with LIST_GOALS to see remaining goals or CREATE_GOAL to add a new one.",

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    // Check if *any* active GOALs exist
    try {
      if (!message.roomId) {
        return false;
      }
      const dataService = runtime.getService('goals') as GoalService;
      const goals = await dataService.getGoals({
        ownerType: 'entity',
        ownerId: message.entityId,
        isCompleted: false,
      });
      return goals.length > 0;
    } catch (error) {
      logger.error('Error validating CANCEL_GOAL action:', error);
      return false;
    }
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
            text: 'Unable to process request without state context.',
            actions: ['CANCEL_GOAL_ERROR'],
            source: message.content.source,
          });
        }
        return {
          data: {
            actionName: 'CANCEL_GOAL',
            error: 'No state context',
          },
          values: {
            success: false,
            error: 'No state context',
          },
          success: false,
        };
      }
      if (!message.roomId) {
        if (callback) {
          await callback({
            text: 'I cannot manage goals without a room context.',
            actions: ['CANCEL_GOAL_ERROR'],
            source: message.content.source,
          });
        }
        return {
          data: {
            actionName: 'CANCEL_GOAL',
            error: 'Missing room context',
          },
          values: {
            success: false,
            error: 'Missing room context',
          },
          success: false,
        };
      }
      const dataService = runtime.getService('goals') as GoalService;

      // Get active goals for the entity
      const activeGoals = await dataService.getGoals({
        ownerType: 'entity',
        ownerId: message.entityId,
        isCompleted: false,
      });

      if (activeGoals.length === 0) {
        if (callback) {
          await callback({
            text: "You don't have any active goals to cancel.",
            actions: ['CANCEL_GOAL_NONE'],
            source: message.content.source,
          });
        }
        return {
          data: {
            actionName: 'CANCEL_GOAL',
            error: 'No active goals',
            activeGoalsCount: 0,
          },
          values: {
            success: false,
            error: 'No active goals',
            hasActiveGoals: false,
          },
          success: false,
        };
      }

      // Extract which goal to cancel
      const cancelInfo = await extractTaskCancellation(runtime, message, activeGoals, state);

      if (!cancelInfo.isFound || !cancelInfo.taskId) {
        // Show the list of goals
        const goalsList = activeGoals.map((goal, index) => `${index + 1}. ${goal.name}`).join('\n');

        if (callback) {
          await callback({
            text: `I couldn't determine which goal you want to cancel. Here are your active goals:\n\n${goalsList}\n\nPlease specify which one you'd like to cancel.`,
            actions: ['CANCEL_GOAL_NOT_FOUND'],
            source: message.content.source,
          });
        }
        return {
          data: {
            actionName: 'CANCEL_GOAL',
            error: 'Goal not found',
            availableGoals: goalsList,
            activeGoalsCount: activeGoals.length,
          },
          values: {
            success: false,
            error: 'Goal not found',
            needsClarification: true,
          },
          success: false,
        };
      }

      // Find the goal to cancel
      const goalToCancel = activeGoals.find((g) => g.id === cancelInfo.taskId);

      if (!goalToCancel) {
        if (callback) {
          await callback({
            text: `I couldn't find a goal matching "${cancelInfo.taskName}". Please try again.`,
            actions: ['CANCEL_GOAL_NOT_FOUND'],
            source: message.content.source,
          });
        }
        return {
          data: {
            actionName: 'CANCEL_GOAL',
            error: 'Goal not found',
            attemptedGoalName: cancelInfo.taskName,
          },
          values: {
            success: false,
            error: 'Goal not found',
          },
          success: false,
        };
      }

      // Delete the goal
      const success = await dataService.deleteGoal(goalToCancel.id);

      if (success) {
        if (callback) {
          await callback({
            text: `✅ Cancelled goal: "${goalToCancel.name}"`,
            actions: ['CANCEL_GOAL_SUCCESS'],
            source: message.content.source,
          });
        }
        return {
          data: {
            actionName: 'CANCEL_GOAL',
            deletedGoalId: goalToCancel.id,
            deletedGoalName: goalToCancel.name,
            remainingGoals: activeGoals.length - 1,
          },
          values: {
            success: true,
            goalId: goalToCancel.id,
            goalName: goalToCancel.name,
            remainingGoalsCount: activeGoals.length - 1,
          },
          success: true,
        };
      } else {
        throw new Error('Failed to delete goal');
      }
    } catch (error) {
      logger.error('Error in cancelGoal handler:', error);
      if (callback) {
        await callback({
          text: 'I encountered an error while trying to cancel your task. Please try again.',
          actions: ['CANCEL_GOAL_ERROR'],
          source: message.content.source,
        });
      }
      return {
        data: {
          actionName: 'CANCEL_GOAL',
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
    // Multi-action: Cancel goal then list remaining to show updated goal state
    [
      {
        name: '{{user}}',
        content: {
          text: "Cancel my task to finish taxes and show me what's left",
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: '✅ Cancelled goal: "Finish taxes". Now let me show you your remaining goals.',
          thought:
            'The user wants to remove a goal and see their updated goal list. I need to chain CANCEL_GOAL with LIST_GOALS to remove the unwanted goal and then display the current active goals.',
          actions: ['CANCEL_GOAL', 'LIST_GOALS'],
        },
      },
    ],
    // Multi-action: Cancel goal then create new one to show goal replacement workflow
    [
      {
        name: '{{user}}',
        content: {
          text: 'Remove my exercise goal and add a new one for yoga',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "I've cancelled your exercise goal. Now I'll create a new goal for yoga.",
          thought:
            "The user wants to replace one goal with another. I\'ll chain CANCEL_GOAL with CREATE_GOAL to remove the old exercise goal and create the new yoga goal, ensuring smooth goal management transition.",
          actions: ['CANCEL_GOAL', 'CREATE_GOAL'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'Cancel my task to finish taxes',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'Are you sure you want to cancel this one-off task: "Finish taxes" (Priority 2, due 4/15/2023)? Once cancelled, it will be permanently removed.',
          actions: ['CANCEL_GOAL_CONFIRM'],
        },
      },
      {
        name: '{{user}}',
        content: {
          text: 'Yes, please cancel it',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: '✓ Task cancelled: "Finish taxes" has been removed from your goal list.',
          actions: ['CANCEL_GOAL'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: "I don't want to do 50 pushups anymore, please delete that task",
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'Are you sure you want to cancel this daily task: "Do 50 pushups"? Once cancelled, it will be permanently removed.',
          actions: ['CANCEL_GOAL_CONFIRM'],
        },
      },
      {
        name: '{{user}}',
        content: {
          text: "No, I changed my mind, I'll keep it",
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ve kept your daily task "Do 50 pushups" active. Keep up the good work!',
          actions: ['CANCEL_GOAL_REJECTED'],
        },
      },
    ],
  ] as ActionExample[][],
};

export default cancelGoalAction;
