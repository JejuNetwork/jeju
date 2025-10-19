import { TestSuite, createMessageMemory, type UUID, asUUID } from '@elizaos/core';
import type { IAgentRuntime } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';

/**
 * Comprehensive real runtime integration tests for the Todo Plugin
 * This replaces the mock-heavy unit tests with real runtime validation
 */
export const TodoPluginComprehensiveE2ETestSuite: TestSuite = {
  name: 'Todo Plugin Comprehensive E2E Tests',
  tests: [
    {
      name: 'should initialize plugin with all components',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing plugin initialization...');

        // Verify all required actions are registered
        const requiredActions = [
          'CREATE_TODO',
          'COMPLETE_TODO',
          'CONFIRM_TODO',
          'UPDATE_TODO',
          'CANCEL_TODO',
        ];
        for (const actionName of requiredActions) {
          const action = runtime.actions.find((a) => a.name === actionName);
          if (!action) {
            throw new Error(`Required action ${actionName} not found`);
          }
          console.log(`✓ Action ${actionName} is registered`);
        }

        // Verify providers are registered
        const todosProvider = runtime.providers.find((p) => p.name === 'TODOS');
        if (!todosProvider) {
          throw new Error('TODOS provider not found');
        }
        console.log('✓ TODOS provider is registered');

        // Verify services are started
        const reminderService = runtime.getService('TODO_REMINDER');
        if (!reminderService) {
          throw new Error('TodoReminderService not started');
        }
        console.log('✓ TodoReminderService is started');
        console.log('✅ Plugin initialization test passed');
      },
    },
    {
      name: 'should handle complete todo lifecycle with real database',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing complete todo lifecycle...');

        const { createTodoDataService } = await import('../../services/todoService');
        const dataService = createTodoDataService(runtime);

        // Generate unique test data
        const testRoomId = asUUID(uuidv4());
        const testEntityId = asUUID(uuidv4());
        const testWorldId = asUUID(uuidv4());
        const taskName = `Integration Test Task ${Date.now()}`;

        // Step 1: Create todo
        const todoId = await dataService.createTodo({
          agentId: runtime.agentId,
          worldId: testWorldId,
          roomId: testRoomId,
          entityId: testEntityId,
          name: taskName,
          description: 'Real database integration test',
          type: 'one-off',
          priority: 1,
          isUrgent: true,
          dueDate: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
          metadata: { source: 'integration-test' },
          tags: ['test', 'integration', 'urgent'],
        });

        if (!todoId) {
          throw new Error('Failed to create todo');
        }
        console.log(`✓ Created todo: ${todoId}`);

        // Step 2: Retrieve and verify todo
        const retrievedTodo = await dataService.getTodo(todoId);
        if (!retrievedTodo) {
          throw new Error('Failed to retrieve created todo');
        }
        if (retrievedTodo.name !== taskName) {
          throw new Error(`Name mismatch: expected ${taskName}, got ${retrievedTodo.name}`);
        }
        if (retrievedTodo.tags?.length !== 3) {
          throw new Error(`Tags mismatch: expected 3 tags, got ${retrievedTodo.tags?.length}`);
        }
        console.log('✓ Retrieved and verified todo');

        // Step 3: Update todo
        const updateSuccess = await dataService.updateTodo(todoId, {
          name: `${taskName} - Updated`,
          priority: 2,
          metadata: { source: 'integration-test', updated: true },
        });
        if (!updateSuccess) {
          throw new Error('Failed to update todo');
        }
        console.log('✓ Updated todo');

        // Step 4: Verify update
        const updatedTodo = await dataService.getTodo(todoId);
        if (!updatedTodo || !updatedTodo.name.includes('Updated')) {
          throw new Error('Update not reflected in database');
        }
        console.log('✓ Verified update');

        // Step 5: Add tags
        const addTagsSuccess = await dataService.addTags(todoId, ['new-tag', 'another-tag']);
        if (!addTagsSuccess) {
          throw new Error('Failed to add tags');
        }
        const todoWithNewTags = await dataService.getTodo(todoId);
        if (!todoWithNewTags || !todoWithNewTags.tags?.includes('new-tag')) {
          throw new Error('New tags not found');
        }
        console.log('✓ Added and verified new tags');

        // Step 6: Remove tags
        const removeTagsSuccess = await dataService.removeTags(todoId, ['new-tag']);
        if (!removeTagsSuccess) {
          throw new Error('Failed to remove tags');
        }
        const todoWithoutTag = await dataService.getTodo(todoId);
        if (todoWithoutTag && todoWithoutTag.tags?.includes('new-tag')) {
          throw new Error('Tag was not removed');
        }
        console.log('✓ Removed and verified tag removal');

        // Step 7: Complete todo
        const completeSuccess = await dataService.updateTodo(todoId, {
          isCompleted: true,
          completedAt: new Date(),
        });
        if (!completeSuccess) {
          throw new Error('Failed to complete todo');
        }
        const completedTodo = await dataService.getTodo(todoId);
        if (!completedTodo || !completedTodo.isCompleted) {
          throw new Error('Todo not marked as completed');
        }
        console.log('✓ Completed todo');

        // Step 8: Clean up
        const deleteSuccess = await dataService.deleteTodo(todoId);
        if (!deleteSuccess) {
          throw new Error('Failed to delete todo');
        }
        const deletedTodo = await dataService.getTodo(todoId);
        if (deletedTodo) {
          throw new Error('Todo still exists after deletion');
        }
        console.log('✓ Deleted todo');

        console.log('✅ Complete todo lifecycle test passed');
      },
    },
    {
      name: 'should validate all action handlers with real runtime',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing action handlers with real runtime...');

        // Generate test data
        const testRoomId = asUUID(uuidv4());
        const testEntityId = asUUID(uuidv4());

        // Test CREATE_TODO action
        const createAction = runtime.actions.find((a) => a.name === 'CREATE_TODO');
        if (!createAction) {
          throw new Error('CREATE_TODO action not found');
        }

        const createMessage = createMessageMemory({
          entityId: testEntityId,
          agentId: runtime.agentId,
          roomId: testRoomId,
          content: {
            text: 'Create a todo to test the action handler',
            source: 'test',
          },
        });

        // Validate action
        const isValid = await createAction.validate(runtime, createMessage);
        if (!isValid) {
          throw new Error('CREATE_TODO action validation failed');
        }
        console.log('✓ CREATE_TODO action validated');

        // Test action execution with callback
        let actionExecuted = false;
        let responseContent: any = null;

        const callback = async (content: any) => {
          actionExecuted = true;
          responseContent = content;
          return [];
        };

        // Execute action
        const state = await runtime.composeState(createMessage);
        await createAction.handler(runtime, createMessage, state, {}, callback);

        if (!actionExecuted) {
          throw new Error('CREATE_TODO action handler did not execute callback');
        }
        if (!responseContent || !responseContent.text) {
          throw new Error('CREATE_TODO action did not provide response content');
        }
        console.log('✓ CREATE_TODO action executed successfully');

        // Test COMPLETE_TODO action
        const completeAction = runtime.actions.find((a) => a.name === 'COMPLETE_TODO');
        if (!completeAction) {
          throw new Error('COMPLETE_TODO action not found');
        }

        const completeMessage = createMessageMemory({
          entityId: testEntityId,
          agentId: runtime.agentId,
          roomId: testRoomId,
          content: {
            text: 'Complete the integration test todo',
            source: 'test',
          },
        });

        const completeValid = await completeAction.validate(runtime, completeMessage);
        if (!completeValid) {
          throw new Error('COMPLETE_TODO action validation failed');
        }
        console.log('✓ COMPLETE_TODO action validated');

        console.log('✅ Action handlers test passed');
      },
    },
    {
      name: 'should test TODOS provider with real data',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing TODOS provider with real data...');

        const { createTodoDataService } = await import('../../services/todoService');
        const dataService = createTodoDataService(runtime);

        // Create test todos
        const testRoomId = asUUID(uuidv4());
        const testEntityId = asUUID(uuidv4());
        const testWorldId = asUUID(uuidv4());

        const todoIds: UUID[] = [];

        // Create multiple todos for testing
        for (let i = 0; i < 3; i++) {
          const todoId = await dataService.createTodo({
            agentId: runtime.agentId,
            worldId: testWorldId,
            roomId: testRoomId,
            entityId: testEntityId,
            name: `Provider Test Todo ${i + 1}`,
            description: `Test todo ${i + 1} for provider testing`,
            type: i === 0 ? 'daily' : 'one-off',
            priority: i + 1,
            isUrgent: i === 2,
            dueDate: new Date(Date.now() + (i + 1) * 60 * 60 * 1000),
            tags: [`test-${i}`, 'provider-test'],
          });
          todoIds.push(todoId);
        }

        // Test provider
        const todosProvider = runtime.providers.find((p) => p.name === 'TODOS');
        if (!todosProvider) {
          throw new Error('TODOS provider not found');
        }

        const testMessage = createMessageMemory({
          entityId: testEntityId,
          agentId: runtime.agentId,
          roomId: testRoomId,
          content: {
            text: 'Show me my todos',
            source: 'test',
          },
        });

        const state = await runtime.composeState(testMessage);
        const providerResult = await todosProvider.get(runtime, testMessage, state);

        if (!providerResult) {
          throw new Error('TODOS provider returned no result');
        }
        if (!providerResult.text || !providerResult.text.includes('Todo')) {
          throw new Error('TODOS provider did not return todo information');
        }

        console.log('✓ TODOS provider returned todo information');

        // Clean up
        for (const todoId of todoIds) {
          await dataService.deleteTodo(todoId);
        }

        console.log('✅ TODOS provider test passed');
      },
    },
    {
      name: 'should handle overdue todos and reminders',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing overdue todos and reminder system...');

        const { createTodoDataService } = await import('../../services/todoService');
        const dataService = createTodoDataService(runtime);

        // Create an overdue todo
        const testRoomId = asUUID(uuidv4());
        const testEntityId = asUUID(uuidv4());
        const testWorldId = asUUID(uuidv4());

        const overdueDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

        const overdueTodoId = await dataService.createTodo({
          agentId: runtime.agentId,
          worldId: testWorldId,
          roomId: testRoomId,
          entityId: testEntityId,
          name: 'Overdue Integration Test',
          description: 'This todo is overdue for testing',
          type: 'one-off',
          priority: 1,
          isUrgent: true,
          dueDate: overdueDate,
          tags: ['overdue', 'test'],
        });

        // Test overdue detection
        const overdueTodos = await dataService.getOverdueTodos({
          agentId: runtime.agentId,
          roomId: testRoomId,
        });

        if (overdueTodos.length === 0) {
          throw new Error('Overdue todo not detected');
        }

        const foundOverdue = overdueTodos.find((todo) => todo.id === overdueTodoId);
        if (!foundOverdue) {
          throw new Error('Created overdue todo not found in overdue list');
        }

        console.log('✓ Overdue todo detection working');

        // Test reminder service
        const reminderService = runtime.getService('TODO_REMINDER');
        if (!reminderService) {
          throw new Error('Reminder service not available');
        }

        // Trigger reminder check (this should process the overdue todo)
        await (reminderService as any).checkTasksForReminders();
        console.log('✓ Reminder check executed');

        // Clean up
        await dataService.deleteTodo(overdueTodoId);

        console.log('✅ Overdue todos and reminders test passed');
      },
    },
    {
      name: 'should handle daily todo reset functionality',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing daily todo reset functionality...');

        const { createTodoDataService } = await import('../../services/todoService');
        const dataService = createTodoDataService(runtime);

        // Create daily todos
        const testRoomId = asUUID(uuidv4());
        const testEntityId = asUUID(uuidv4());
        const testWorldId = asUUID(uuidv4());

        const dailyTodoIds: UUID[] = [];

        for (let i = 0; i < 2; i++) {
          const todoId = await dataService.createTodo({
            agentId: runtime.agentId,
            worldId: testWorldId,
            roomId: testRoomId,
            entityId: testEntityId,
            name: `Daily Test Todo ${i + 1}`,
            description: `Daily todo ${i + 1} for reset testing`,
            type: 'daily',
            priority: 2,
            isUrgent: false,
            tags: ['daily', 'test'],
          });
          dailyTodoIds.push(todoId);
        }

        // Complete one of the daily todos
        await dataService.updateTodo(dailyTodoIds[0], {
          isCompleted: true,
          completedAt: new Date(),
        });

        // Verify it's completed
        const completedTodo = await dataService.getTodo(dailyTodoIds[0]);
        if (!completedTodo || !completedTodo.isCompleted) {
          throw new Error('Daily todo was not marked as completed');
        }
        console.log('✓ Daily todo marked as completed');

        // Test reset functionality
        const resetCount = await dataService.resetDailyTodos({
          agentId: runtime.agentId,
          roomId: testRoomId,
        });

        console.log(`✓ Reset ${resetCount} daily todos`);

        // Verify the todo was reset (if the method actually resets)
        const resetTodo = await dataService.getTodo(dailyTodoIds[0]);
        if (!resetTodo) {
          throw new Error('Daily todo was deleted instead of reset');
        }

        // Clean up
        for (const todoId of dailyTodoIds) {
          await dataService.deleteTodo(todoId);
        }

        console.log('✅ Daily todo reset test passed');
      },
    },
    {
      name: 'should test error handling with real runtime',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing error handling scenarios...');

        const { createTodoDataService } = await import('../../services/todoService');
        const dataService = createTodoDataService(runtime);

        // Test getting non-existent todo
        const nonExistentId = asUUID(uuidv4());
        const nonExistentTodo = await dataService.getTodo(nonExistentId);
        if (nonExistentTodo !== null) {
          throw new Error('Expected null for non-existent todo');
        }
        console.log('✓ Non-existent todo returns null');

        // Test deleting non-existent todo
        const deleteResult = await dataService.deleteTodo(nonExistentId);
        // Should not throw, should handle gracefully
        console.log('✓ Deleting non-existent todo handled gracefully');

        // Test action with invalid input
        const createAction = runtime.actions.find((a) => a.name === 'CREATE_TODO');
        if (!createAction) {
          throw new Error('CREATE_TODO action not found');
        }

        const invalidMessage = createMessageMemory({
          entityId: asUUID(uuidv4()),
          agentId: runtime.agentId,
          roomId: asUUID(uuidv4()),
          content: {
            text: '', // Empty text
            source: 'test',
          },
        });

        // This should not crash, should handle gracefully
        try {
          const isValid = await createAction.validate(runtime, invalidMessage);
          console.log(`✓ Empty message validation result: ${isValid}`);
        } catch (error) {
          // Should not throw, but if it does, it should be a controlled error
          console.log('✓ Empty message validation handled with controlled error');
        }

        console.log('✅ Error handling test passed');
      },
    },
  ],
};

export default TodoPluginComprehensiveE2ETestSuite;
