import {
  type Action,
  type ActionExample,
  type ActionResult,
  createUniqueUuid,
  formatMessages,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  ModelType,
  parseKeyValueXml,
  type State,
  type UUID,
} from '@elizaos/core';
import type { TodoMetadata } from '../types';
import type { TodoService } from '../services/todoService';

// Interface for parsed task data
interface TodoTaskInput {
  name: string;
  description?: string;
  taskType: 'daily' | 'one-off' | 'aspirational';
  priority?: 1 | 2 | 3 | 4; // 1=highest, 4=lowest priority
  urgent?: boolean;
  dueDate?: string; // ISO date string for one-off tasks
  recurring?: 'daily' | 'weekly' | 'monthly'; // For recurring tasks
}

/**
 * Template for extracting todo information from the user's message.
 */
const extractTodoTemplate = (text: string, messageHistory: string) => `
# Task: Extract Todo Information

## User Message
${text}

## Message History
${messageHistory}

## Instructions
Parse the user\'s message (within the context of the message history) to extract information for creating a new todo/task. Don\'t write a program or any code, just generate and return the XML object.
Identify whether this is a daily recurring task, a one-off task with a due date, or an aspirational goal.

**IMPORTANT:** If the user message appears to be a simple confirmation (e.g., \"yes\", \"confirm\", \"ok\", \"looks good\", \"do it\"), and NOT a description of a new task, return an empty response like <response></response> or a response with a clear indication like <is_confirmation>true</is_confirmation> instead of trying to extract task details.

Return an XML object with these fields:
<response>
  <name>A concise name for the task</name>
  <description>Optional detailed description</description>
  <taskType>One of "daily", "one-off", "aspirational"</taskType>
  <priority>For one-off tasks, a number from 1-4 (1=highest, 4=lowest), default to 3 if not specified</priority>
  <urgent>For one-off tasks, 'true' or 'false' indicating if urgent, default 'false'</urgent>
  <dueDate>For one-off tasks with due dates, ISO date string (YYYY-MM-DD)</dueDate>
  <recurring>For daily tasks, frequency ("daily", "weekly", "monthly"), default to "daily"</recurring>
</response>

Use only the information provided by the user. Do not invent details.
If task type is unspecified, assume it's a one-off task.
If priority is unspecified, use 3 (medium priority).
Do not write code. Just return the XML object.

## Example Output Format
<response>
  <name>Finish my taxes</name>
  <description>Get all the documents together and file online</description>
  <taskType>one-off</taskType>
  <priority>2</priority>
  <urgent>false</urgent>
  <dueDate>2024-04-15</dueDate>
</response>
`;

/**
 * Extracts todo information from the user's message.
 */
async function extractTodoInfo(
  runtime: IAgentRuntime,
  message: Memory,
  state: State
): Promise<TodoTaskInput | null> {
  try {
    const messageHistory = formatMessages({
      messages: state.data.messages || [],
      entities: state.data.entities || [],
    });

    const prompt = extractTodoTemplate(message.content.text || '', messageHistory);

    const result = await runtime.useModel(ModelType.TEXT_LARGE, {
      prompt,
      stopSequences: [],
    });

    logger.debug('Extract todo result:', result);

    // Parse XML from the text results
    const parsedResult = parseKeyValueXml(result) as TodoTaskInput | null;

    logger.debug('Parsed XML Todo:', parsedResult);

    // Validate the parsed todo
    // First, check for explicit confirmation flag or intentionally empty response
    if (
      parsedResult &&
      (('is_confirmation' in parsedResult && parsedResult.is_confirmation === 'true') ||
        Object.keys(parsedResult).length === 0)
    ) {
      logger.info('Extraction skipped, likely a confirmation message or empty response.');
      return null;
    }

    // Now check if essential fields are missing for a *real* task
    if (!parsedResult || !parsedResult.name || !parsedResult.taskType) {
      logger.error('Failed to extract valid todo information from XML (missing name or type)');
      return null;
    }

    // Convert specific fields from string if necessary and apply defaults
    const finalTodo: TodoTaskInput = {
      ...parsedResult,
      name: String(parsedResult.name),
      taskType: parsedResult.taskType as 'daily' | 'one-off' | 'aspirational',
    };

    if (finalTodo.taskType === 'one-off') {
      finalTodo.priority = parsedResult.priority
        ? (parseInt(String(parsedResult.priority), 10) as 1 | 2 | 3 | 4)
        : 3;
      finalTodo.urgent = parsedResult.urgent
        ? parsedResult.urgent === true || parsedResult.urgent === 'true'
        : false;
      finalTodo.dueDate =
        parsedResult.dueDate === 'null' ? undefined : String(parsedResult.dueDate || '');
    } else if (finalTodo.taskType === 'daily') {
      finalTodo.recurring = (parsedResult.recurring || 'daily') as 'daily' | 'weekly' | 'monthly';
    }

    return finalTodo;
  } catch (error) {
    logger.error('Error extracting todo information:', error);
    return null;
  }
}

/**
 * The CREATE_TODO action allows the agent to create a new todo item.
 */
export const createTodoAction: Action = {
  name: 'CREATE_TODO',
  similes: ['ADD_TODO', 'NEW_TASK', 'ADD_TASK', 'CREATE_TASK'],
  description:
    'Creates a new todo item from user description. Supports daily recurring tasks, one-off tasks with priorities and due dates, and aspirational goals. Returns created todo details including ID, name, and type. Can be chained with LIST_TODOS to show updated list.',

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    // No validation needed if we create directly - let handler decide
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    stateFromTrigger: State | undefined,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    let todo: TodoTaskInput | null = null;

    // Ensure state has the required State properties
    const state: State = stateFromTrigger || {
      values: {},
      data: {},
      text: '',
    };

    try {
      // Step 1: Check if this is part of a confirmation flow
      const pendingTask = (state as any)?.pendingTask as TodoTaskInput | undefined;
      const isWaitingConfirmation = (state as any)?.isWaitingTodoConfirmation;

      // Get the data service early for all operations
      const dataService = runtime.getService('todo') as TodoService;
      if (!dataService) {
        logger.error('[createTodo] Todo service not available');
        const errorResponse = `Sorry, the todo service is not available right now. Please try again later.`;
        await callback?.(
          {
            text: errorResponse,
            error: true,
          },
          []
        );
        return {
          success: false,
          data: {
            actionName: 'CREATE_TODO',
            error: 'Todo service not available',
          },
          values: {
            error: 'Todo service not available',
          },
        };
      }

      if (isWaitingConfirmation && pendingTask) {
        logger.info('[createTodo] Using pending task from confirmation flow', {
          pendingTask,
        });
        todo = pendingTask;
      } else {
        // Step 2: Extract task info from current message
        const composedState =
          state || (await runtime.composeState(message, ['TODOS', 'RECENT_MESSAGES']));
        todo = await extractTodoInfo(runtime, message, composedState);
        if (!todo) {
          const errorResponse = `I couldn't understand the task details. Please describe what you'd like to add to your todo list.

Examples:
• "Add a daily task to exercise for 30 minutes"
• "Create a high priority task to finish the report by Friday"
• "Add an aspirational goal to learn Spanish"`;

          await callback?.(
            {
              text: errorResponse,
              error: true,
            },
            []
          );
          return {
            success: false,
            data: {
              actionName: 'CREATE_TODO',
              error: 'Could not extract task details',
            },
            values: {
              error: 'Could not extract task details',
            },
          };
        }
      }

      // Step 3: No need to get the data service again, we already have it

      // Step 4: Duplicate Check
      const existingTodos = await dataService.getTodos({
        entityId: message.entityId,
        roomId: message.roomId,
        isCompleted: false,
      });

      const duplicateTodo = existingTodos.find((t) => todo && t.name.trim() === todo.name.trim());

      if (duplicateTodo) {
        logger.warn(
          `[createTodoAction] Duplicate task found for name "${todo.name}". ID: ${duplicateTodo.id}`
        );
        if (callback) {
          await callback({
            text: `It looks like you already have an active task named "${todo.name}". I haven't added a duplicate.`,
            actions: ['CREATE_TODO_DUPLICATE'],
            source: message.content.source,
          });
        }
        return {
          success: false,
          data: {
            actionName: 'CREATE_TODO',
            error: 'Duplicate task found',
            duplicateId: duplicateTodo.id,
          },
          values: {
            success: false,
            isDuplicate: true,
          },
        };
      }

      // Step 5: Create the task using the data service
      const tags = ['TODO'];
      if (todo.taskType === 'daily') {
        tags.push('daily');
        if (todo.recurring) {
          tags.push(`recurring-${todo.recurring}`);
        }
      } else if (todo.taskType === 'one-off') {
        tags.push('one-off');
        if (todo.priority) {
          tags.push(`priority-${todo.priority}`);
        }
        if (todo.urgent) {
          tags.push('urgent');
        }
      } else if (todo.taskType === 'aspirational') {
        tags.push('aspirational');
      }

      const metadata: TodoMetadata = {
        createdAt: new Date().toISOString(),
      };
      if (todo.description) {
        metadata.description = todo.description;
      }
      if (todo.dueDate) {
        metadata.dueDate = todo.dueDate;
      }

      const room = (state as any)?.data?.room ?? (await runtime.getRoom(message.roomId));
      const worldId =
        room?.worldId || message.worldId || createUniqueUuid(runtime, message.entityId);

      logger.debug('[createTodoAction] Creating task with:', {
        name: todo.name,
        type: todo.taskType,
        tags,
        metadata,
        roomId: message.roomId,
        worldId,
        entityId: message.entityId,
        source: message.content.source,
      });

      const createdTodoId = await dataService.createTodo({
        agentId: runtime.agentId,
        worldId: worldId as UUID,
        roomId: message.roomId,
        entityId: message.entityId,
        name: todo.name,
        description: todo.description || todo.name,
        type: todo.taskType,
        priority: todo.taskType === 'one-off' ? todo.priority : undefined,
        isUrgent: todo.taskType === 'one-off' ? todo.urgent : false,
        dueDate: todo.dueDate ? new Date(todo.dueDate) : undefined,
        metadata,
        tags,
      });

      if (!createdTodoId) {
        throw new Error('Failed to create todo, dataService.createTodo returned null/undefined');
      }

      // Step 6: Send success message
      let successMessage = '';
      if (todo.taskType === 'daily') {
        successMessage = `✅ Added new daily task: "${todo.name}". This task will reset each day.`;
      } else if (todo.taskType === 'one-off') {
        const priorityText = `Priority ${todo.priority || 'default'}`;
        const urgentText = todo.urgent ? ', Urgent' : '';
        const dueDateText = todo.dueDate
          ? `, Due: ${new Date(todo.dueDate).toLocaleDateString()}`
          : '';
        successMessage = `✅ Added new one-off task: "${todo.name}" (${priorityText}${urgentText}${dueDateText})`;
      } else {
        successMessage = `✅ Added new aspirational goal: "${todo.name}"`;
      }

      if (callback) {
        await callback({
          text: successMessage,
          actions: ['CREATE_TODO_SUCCESS'],
          source: message.content.source,
        });
      }

      return {
        success: true,
        data: {
          actionName: 'CREATE_TODO',
          todoId: createdTodoId,
          todoName: todo.name,
          todoType: todo.taskType,
          priority: todo.taskType === 'one-off' ? todo.priority : undefined,
          urgent: todo.taskType === 'one-off' ? todo.urgent : undefined,
          dueDate: todo.dueDate,
        },
        values: {
          success: true,
          createdTodoId,
          todoName: todo.name,
          todoType: todo.taskType,
        },
      };
    } catch (error) {
      logger.error('Error in createTodo handler:', error);
      if (callback) {
        await callback({
          text: 'I encountered an error while creating your todo. Please try again.',
          actions: ['CREATE_TODO_FAILED'],
          source: message.content.source,
        });
      }

      return {
        success: false,
        data: {
          actionName: 'CREATE_TODO',
          error: error instanceof Error ? error.message : String(error),
        },
        values: {
          success: false,
        },
      };
    }
  },

  examples: [
    // Multi-action example: CREATE_TODO followed by LIST_TODOS
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Add a todo to finish my taxes by April 15 and then show me all my todos',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll create a one-off todo for your taxes and then show your todo list.",
          actions: ['CREATE_TODO', 'LIST_TODOS'],
        },
      },
    ],
    // Single action with confirmation
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
          actions: ['CONFIRM_TODO_REQUESTED'],
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
          text: "✅ Added new one-off task: 'Finish taxes' (Priority 2, Due: 4/15/2023)",
          actions: ['CREATE_TODO'],
        },
      },
    ],
    // Multi-action example: CREATE_TODO then COMPLETE_TODO
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Add a quick task to email John and mark it as done right away',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll create the task and then mark it as completed.",
          actions: ['CREATE_TODO', 'COMPLETE_TODO'],
        },
      },
    ],
    // Daily task example
    [
      {
        name: '{{name1}}',
        content: {
          text: 'I want to add a daily task to do 50 pushups',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll create a daily todo: 'Do 50 pushups'.\n\nIs this correct?",
          actions: ['CONFIRM_TODO_REQUESTED'],
        },
      },
      {
        name: '{{name1}}',
        content: {
          text: 'Yes, please add it',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "✅ Added new daily task: 'Do 50 pushups'. This task will reset each day.",
          actions: ['CREATE_TODO'],
        },
      },
    ],
    // Multi-action example: CREATE_TODO with urgent priority then GET_ACTIVE_TODOS
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Add an urgent task to fix the production bug and show me my urgent tasks',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll create an urgent task and then show your active urgent tasks.",
          actions: ['CREATE_TODO', 'GET_ACTIVE_TODOS'],
        },
      },
    ],
    // Aspirational goal example
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Please add an aspirational goal to read more books',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll create an aspirational goal: 'Read more books'.\n\nIs this correct?",
          actions: ['CONFIRM_TODO_REQUESTED'],
        },
      },
      {
        name: '{{name1}}',
        content: {
          text: 'Yes',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "✅ Added new aspirational goal: 'Read more books'",
          actions: ['CREATE_TODO'],
        },
      },
    ],
  ] as ActionExample[][],
};

export default createTodoAction;
