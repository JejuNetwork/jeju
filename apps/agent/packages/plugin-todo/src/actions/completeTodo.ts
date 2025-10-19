import {
  type Action,
  type ActionExample,
  composePrompt,
  formatMessages,
  HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  ModelType,
  parseKeyValueXml,
  type State,
} from '@elizaos/core';
import type { TodoData, TodoService } from '../services/todoService';

// Interface for task completion properties
interface TaskCompletion {
  taskId: string;
  taskName: string;
  isFound: boolean;
}

/**
 * Template for extracting task completion information from user message
 */
const extractCompletionTemplate = `
# Task: Extract Task Completion Information

## User Message
{{text}}

## Message History
{{messageHistory}}

## Available Tasks
{{availableTasks}}

## Instructions
Parse the user\'s message to identify which task they\'re marking as completed.\nMatch against the list of available tasks by name or description.\nIf multiple tasks have similar names, choose the closest match.\n\nReturn an XML object with:\n<response>\n  <taskId>ID of the task being completed, or \'null\' if not found</taskId>\n  <taskName>Name of the task being completed, or \'null\' if not found</taskName>\n  <isFound>\'true\' or \'false\' indicating if a matching task was found</isFound>\n</response>\n\n## Example Output Format
<response>\n  <taskId>123e4567-e89b-12d3-a456-426614174000</taskId>\n  <taskName>Finish report</taskName>\n  <isFound>true</isFound>\n</response>\n\nIf no matching task was found:\n<response>\n  <taskId>null</taskId>\n  <taskName>null</taskName>\n  <isFound>false</isFound>\n</response>\n`;

/**
 * Extracts which task the user wants to mark as completed
 */
async function extractTaskCompletion(
  runtime: IAgentRuntime,
  message: Memory,
  availableTasks: TodoData[],
  state: State
): Promise<TaskCompletion> {
  try {
    // Format available tasks for the prompt
    const tasksText = availableTasks
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
      template: extractCompletionTemplate,
    });

    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
      stopSequences: [],
    });

    // Parse XML from the text results
    const parsedResult = parseKeyValueXml(result) as TaskCompletion | null;

    if (!parsedResult || typeof parsedResult.isFound === 'undefined') {
      logger.error('Failed to parse valid task completion information from XML');
      return { taskId: '', taskName: '', isFound: false };
    }

    // Convert string 'true'/'false' to boolean and handle 'null' strings
    const finalResult: TaskCompletion = {
      taskId: parsedResult.taskId === 'null' ? '' : String(parsedResult.taskId || ''),
      taskName: parsedResult.taskName === 'null' ? '' : String(parsedResult.taskName || ''),
      isFound: String(parsedResult.isFound) === 'true',
    };

    return finalResult;
  } catch (error) {
    logger.error('Error extracting task completion information:', error);
    return { taskId: '', taskName: '', isFound: false };
  }
}

/**
 * The COMPLETE_TODO action allows users to mark a task as completed.
 */
export const completeTodoAction: Action = {
  name: 'COMPLETE_TODO',
  similes: ['FINISH_TODO', 'DONE_TODO', 'MARK_TODO_DONE', 'TODO_COMPLETE'],
  description:
    'Mark a todo item as completed, including tasks done in the real world. Works with task name or ID. Can be chained with LIST_TODOS to show remaining tasks.',

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options: any,
    callback: HandlerCallback | undefined
  ) => {
    logger.info('[completeTodo] Handler invoked', { messageContent: message.content.text });

    const dataService = runtime.getService('todo') as TodoService;
    if (!dataService) {
      logger.error('[completeTodo] Todo service not available');
      if (callback) {
        await callback({
          text: 'Sorry, the todo service is not available right now. Please try again later.',
          error: true,
          source: message.content.source,
        });
      }
      return {
        success: false,
        values: {
          error: 'Todo service not available',
        },
      };
    }

    try {
      // Get available tasks
      const availableTasks = await dataService.getTodos({
        entityId: message.entityId,
        roomId: message.roomId,
        isCompleted: false,
      });

      if (availableTasks.length === 0) {
        if (callback) {
          await callback({
            text: "You don't have any incomplete tasks to mark as done. Would you like to create a new task?",
            actions: ['COMPLETE_TODO_NO_TASKS'],
            source: message.content.source,
          });
        }
        return {
          success: false,
          data: {
            actionName: 'COMPLETE_TODO',
            error: 'No incomplete tasks found',
          },
          values: {
            success: false,
            hasActiveTasks: false,
          },
        };
      }

      // Extract which task the user wants to complete
      const taskCompletion = options?.taskId
        ? { taskId: options.taskId, taskName: options.taskName, isFound: true }
        : await extractTaskCompletion(runtime, message, availableTasks, state!);

      if (!taskCompletion.isFound) {
        if (callback) {
          await callback({
            text: `I couldn't determine which task you're marking as completed. Could you be more specific? Here are your current tasks:\n\n${availableTasks
              .map((task) => `- ${task.name}`)
              .join('\n')}`,
            actions: ['COMPLETE_TODO_NOT_FOUND'],
            source: message.content.source,
          });
        }
        return {
          success: false,
          data: {
            actionName: 'COMPLETE_TODO',
            error: 'Could not identify which task to complete',
          },
          values: {
            success: false,
            availableTaskCount: availableTasks.length,
          },
        };
      }

      // Find the task in the available tasks
      const task = availableTasks.find((t) => t.id === taskCompletion.taskId);

      if (!task) {
        if (callback) {
          await callback({
            text: `I couldn't find a task matching "${taskCompletion.taskName}". Please try again with the exact task name.`,
            actions: ['COMPLETE_TODO_NOT_FOUND'],
            source: message.content.source,
          });
        }
        return {
          success: false,
          data: {
            actionName: 'COMPLETE_TODO',
            error: `Task not found: ${taskCompletion.taskName}`,
            searchedTaskId: taskCompletion.taskId,
          },
          values: {
            success: false,
          },
        };
      }

      // Mark the task as completed
      await dataService.updateTodo(task.id, {
        isCompleted: true,
        completedAt: new Date(),
        metadata: {
          ...task.metadata,
          completedAt: new Date().toISOString(),
        },
      });

      // Generate response text based on task type
      let responseText = '';

      if (task.type === 'daily') {
        responseText = `✅ Daily task completed: "${task.name}"`;
      } else if (task.type === 'one-off') {
        const completedOnTime = task.dueDate ? new Date() <= task.dueDate : true;
        const timeStatus = completedOnTime ? 'on time' : 'late';
        const priority = task.priority || 4;

        responseText = `✅ Task completed: "${task.name}" (Priority ${priority}, ${timeStatus})`;
      } else if (task.type === 'aspirational') {
        responseText = `🌟 Congratulations on achieving your aspirational goal: "${task.name}"!\n\nThis is a significant accomplishment.`;
      } else {
        responseText = `✅ Marked "${task.name}" as completed.`;
      }

      if (callback) {
        await callback({
          text: responseText,
          actions: ['COMPLETE_TODO'],
          source: message.content.source,
        });
      }

      return {
        success: true,
        data: {
          actionName: 'COMPLETE_TODO',
          taskId: task.id,
          taskName: task.name,
          taskType: task.type,
          completedAt: new Date().toISOString(),
        },
        values: {
          success: true,
          taskId: task.id,
          taskName: task.name,
          taskType: task.type,
        },
      };
    } catch (error) {
      logger.error('Error in completeTodo handler:', error);
      if (callback) {
        await callback({
          text: 'I encountered an error while completing your task. Please try again.',
          actions: ['COMPLETE_TODO_ERROR'],
          source: message.content.source,
        });
      }
      return {
        success: false,
        data: {
          actionName: 'COMPLETE_TODO',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        values: {
          success: false,
        },
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'I completed my taxes',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '✅ Task completed: "Finish taxes" (Priority 2, on time)',
          actions: ['COMPLETE_TODO'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'I did my 50 pushups today',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '✅ Daily task completed: "Do 50 pushups"',
          actions: ['COMPLETE_TODO'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'I read three books this month',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '🌟 Congratulations on achieving your aspirational goal: "Read more books"!\n\nThis is a significant accomplishment.',
          actions: ['COMPLETE_TODO'],
        },
      },
    ],
  ] as ActionExample[][],
};

export default completeTodoAction;
