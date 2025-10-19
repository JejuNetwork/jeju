import {
  type Action,
  type ActionExample,
  type ActionResult,
  composePrompt,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  ModelType,
  parseKeyValueXml,
  type State,
  type UUID,
  formatMessages,
} from '@elizaos/core';
import type { TodoMetadata } from '../types';
import type { TodoService } from '../services/todoService';

// Interface for confirmation data stored in state
interface PendingTodoData {
  name: string;
  description?: string;
  taskType: 'daily' | 'one-off' | 'aspirational';
  priority?: 1 | 2 | 3 | 4;
  urgent?: boolean;
  dueDate?: string;
  recurring?: 'daily' | 'weekly' | 'monthly';
  tags?: string[];
  metadata?: TodoMetadata;
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
  pendingTask: PendingTodoData | null,
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
 * The CONFIRM_TODO action handles the confirmation step of todo creation
 */
export const confirmTodoAction: Action = {
  name: 'CONFIRM_TODO',
  similes: ['CONFIRM_TASK', 'APPROVE_TODO', 'APPROVE_TASK', 'TODO_CONFIRM'],
  description:
    'Confirms or cancels pending todo creation after user review. Processes confirmation intent and creates task if approved. Returns created task details or cancellation status. Used after CREATE_TODO_PREVIEW action.',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    // This action is only valid if there's a pending todo in the state
    const pendingTodo = state?.data?.pendingTodo as PendingTodoData | undefined;
    return !!pendingTodo;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      if (!state) {
        if (callback) {
          await callback({
            text: 'Unable to process confirmation without state context.',
            actions: ['CONFIRM_TODO_ERROR'],
            source: message.content.source,
          });
        }
        return {
          success: false,
          data: {
            actionName: 'CONFIRM_TODO',
            error: 'Missing state context',
          },
          values: {
            success: false,
          },
        };
      }

      const pendingTodo = state.data?.pendingTodo as PendingTodoData | undefined;
      if (!pendingTodo) {
        if (callback) {
          await callback({
            text: "I don't have a pending task to confirm. Would you like to create a new task?",
            actions: ['CONFIRM_TODO_NO_PENDING'],
            source: message.content.source,
          });
        }
        return {
          success: false,
          data: {
            actionName: 'CONFIRM_TODO',
            error: 'No pending todo to confirm',
          },
          values: {
            success: false,
            hasPendingTodo: false,
          },
        };
      }

      if (!message.roomId || !message.entityId) {
        if (callback) {
          await callback({
            text: 'I cannot confirm a todo without a room and entity context.',
            actions: ['CONFIRM_TODO_ERROR'],
            source: message.content.source,
          });
        }
        return {
          success: false,
          data: {
            actionName: 'CONFIRM_TODO',
            error: 'Missing room or entity context',
          },
          values: {
            success: false,
          },
        };
      }

      // Extract confirmation intent
      const confirmation = await extractConfirmationIntent(runtime, message, pendingTodo, state);

      if (!confirmation.isConfirmation) {
        // User said something unrelated to the confirmation
        if (callback) {
          await callback({
            text: `I'm still waiting for your confirmation on the task "${pendingTodo.name}". Would you like me to create it?`,
            actions: ['CONFIRM_TODO_WAITING'],
            source: message.content.source,
          });
        }
        return {
          success: false,
          data: {
            actionName: 'CONFIRM_TODO',
            error: 'Message not related to confirmation',
          },
          values: {
            success: false,
            isWaitingForConfirmation: true,
            pendingTaskName: pendingTodo.name,
          },
        };
      }

      if (!confirmation.shouldProceed) {
        // User rejected the task
        // Clear the pending todo from state
        delete state.data.pendingTodo;

        if (callback) {
          await callback({
            text: "Okay, I've cancelled the task creation. Let me know if you'd like to create a different task.",
            actions: ['CONFIRM_TODO_CANCELLED'],
            source: message.content.source,
          });
        }
        return {
          success: true,
          data: {
            actionName: 'CONFIRM_TODO',
            result: 'Task creation cancelled',
            pendingTaskName: pendingTodo.name,
          },
          values: {
            success: true,
            taskCreated: false,
            taskCancelled: true,
          },
        };
      }

      // User confirmed - create the task
      const dataService = runtime.getService('todo') as TodoService;
      if (!dataService) {
        logger.error('[confirmTodo] Todo service not available');
        await callback?.(
          {
            text: 'Sorry, the todo service is not available right now. Please try again later.',
            error: true,
          },
          []
        );
        return {
          success: false,
          data: {
            actionName: 'CONFIRM_TODO',
            error: 'Todo service not available',
          },
          values: {
            error: 'Todo service not available',
          },
        };
      }

      // Check for duplicates one more time
      const existingTodos = await dataService.getTodos({
        entityId: message.entityId,
        roomId: message.roomId,
        isCompleted: false,
      });

      const duplicateTodo = existingTodos.find((t) => t.name.trim() === pendingTodo.name.trim());

      if (duplicateTodo) {
        delete state.data.pendingTodo;
        if (callback) {
          await callback({
            text: `It looks like you already have an active task named "${pendingTodo.name}". I haven't added a duplicate.`,
            actions: ['CONFIRM_TODO_DUPLICATE'],
            source: message.content.source,
          });
        }
        return {
          success: false,
          data: {
            actionName: 'CONFIRM_TODO',
            error: 'Duplicate task found',
            duplicateTaskName: pendingTodo.name,
          },
          values: {
            success: false,
            isDuplicate: true,
          },
        };
      }

      // Create the task
      const room = state.data?.room ?? (await runtime.getRoom(message.roomId));
      const worldId = room?.worldId || message.worldId || runtime.agentId;

      const createdTodoId = await dataService.createTodo({
        agentId: runtime.agentId,
        worldId: worldId as UUID,
        roomId: message.roomId,
        entityId: message.entityId,
        name: pendingTodo.name,
        description: pendingTodo.description || pendingTodo.name,
        type: pendingTodo.taskType,
        priority: pendingTodo.taskType === 'one-off' ? pendingTodo.priority : undefined,
        isUrgent: pendingTodo.taskType === 'one-off' ? pendingTodo.urgent : false,
        dueDate: pendingTodo.dueDate ? new Date(pendingTodo.dueDate) : undefined,
        metadata: pendingTodo.metadata || {},
        tags: pendingTodo.tags || [],
      });

      if (!createdTodoId) {
        throw new Error('Failed to create todo');
      }

      // Clear the pending todo from state
      delete state.data.pendingTodo;

      // Send success message
      let successMessage = '';
      if (pendingTodo.taskType === 'daily') {
        successMessage = `✅ Created daily task: "${pendingTodo.name}". Complete it regularly to build your streak!`;
      } else if (pendingTodo.taskType === 'one-off') {
        const priorityText = `Priority ${pendingTodo.priority || 3}`;
        const urgentText = pendingTodo.urgent ? ', Urgent' : '';
        const dueDateText = pendingTodo.dueDate
          ? `, Due: ${new Date(pendingTodo.dueDate).toLocaleDateString()}`
          : '';
        successMessage = `✅ Created task: "${pendingTodo.name}" (${priorityText}${urgentText}${dueDateText})`;
      } else {
        successMessage = `✅ Created aspirational goal: "${pendingTodo.name}"`;
      }

      if (confirmation.modifications) {
        successMessage += `\n\nNote: I created the task as originally described. The modifications you mentioned ("${confirmation.modifications}") weren't applied. You can use UPDATE_TODO to make changes.`;
      }

      if (callback) {
        await callback({
          text: successMessage,
          actions: ['CONFIRM_TODO_SUCCESS'],
          source: message.content.source,
        });
      }

      return {
        success: true,
        data: {
          actionName: 'CONFIRM_TODO',
          createdTodoId,
          createdTaskName: pendingTodo.name,
          taskType: pendingTodo.taskType,
          priority: pendingTodo.priority,
          urgent: pendingTodo.urgent,
          dueDate: pendingTodo.dueDate,
          hadModifications: !!confirmation.modifications,
        },
        values: {
          success: true,
          taskCreated: true,
          createdTodoId,
          createdTaskName: pendingTodo.name,
        },
      };
    } catch (error) {
      logger.error('Error in confirmTodo handler:', error);
      if (callback) {
        await callback({
          text: 'I encountered an error while confirming your todo. Please try again.',
          actions: ['CONFIRM_TODO_ERROR'],
          source: message.content.source,
        });
      }

      return {
        success: false,
        data: {
          actionName: 'CONFIRM_TODO',
          error: error instanceof Error ? error.message : String(error),
        },
        values: {
          success: false,
        },
      };
    }
  },

  examples: [
    // Multi-action example: CREATE_TODO_PREVIEW followed by CONFIRM_TODO and LIST_TODOS
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Add a todo to finish my taxes by April 15',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll create a one-off todo: 'Finish taxes' with Priority 2, Due April 15.\n\nIs this correct?",
          actions: ['CREATE_TODO_PREVIEW'],
        },
      },
      {
        name: '{{name1}}',
        content: {
          text: 'Yes, that looks good, and show me all my tasks',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll confirm the task creation and show your task list.",
          actions: ['CONFIRM_TODO', 'LIST_TODOS'],
        },
      },
    ],
    // Standard confirmation flow
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Add a todo to finish my taxes by April 15',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll create a one-off todo: 'Finish taxes' with Priority 2, Due April 15.\n\nIs this correct?",
          actions: ['CREATE_TODO_PREVIEW'],
        },
      },
      {
        name: '{{name1}}',
        content: {
          text: 'Yes, that looks good',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "✅ Created task: 'Finish taxes' (Priority 2, Due: 4/15/2024)",
          actions: ['CONFIRM_TODO'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'I want to add a daily task to exercise',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll create a daily todo: 'Exercise'.\n\nIs this correct?",
          actions: ['CREATE_TODO_PREVIEW'],
        },
      },
      {
        name: '{{name1}}',
        content: {
          text: 'Actually, nevermind',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "Okay, I've cancelled the task creation. Let me know if you'd like to create a different task.",
          actions: ['CONFIRM_TODO_CANCELLED'],
        },
      },
    ],
  ] as ActionExample[][],
};

export default confirmTodoAction;
