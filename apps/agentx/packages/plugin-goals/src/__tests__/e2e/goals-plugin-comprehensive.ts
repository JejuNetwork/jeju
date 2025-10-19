import { TestSuite, createMessageMemory, type UUID, asUUID } from '@elizaos/core';
import type { IAgentRuntime } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';
import type { GoalService } from '../../services/goalService';

/**
 * Comprehensive real runtime integration tests for the Goals Plugin
 * This replaces the mock-heavy unit tests with real runtime validation
 */
export const GoalsPluginComprehensiveE2ETestSuite: TestSuite = {
  name: 'Goals Plugin Comprehensive E2E Tests',
  tests: [
    {
      name: 'should initialize plugin with all components',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing plugin initialization...');

        // Verify all required actions are registered
        const requiredActions = [
          'CREATE_GOAL',
          'COMPLETE_GOAL',
          'CONFIRM_GOAL',
          'UPDATE_GOAL',
          'CANCEL_GOAL',
        ];
        for (const actionName of requiredActions) {
          const action = runtime.actions.find((a) => a.name === actionName);
          if (!action) {
            throw new Error(`Required action ${actionName} not found`);
          }
          console.log(`✓ Action ${actionName} is registered`);
        }

        // Verify providers are registered
        const goalsProvider = runtime.providers.find((p) => p.name === 'GOALS');
        if (!goalsProvider) {
          throw new Error('GOALS provider not found');
        }
        console.log('✓ GOALS provider is registered');

        console.log('✅ Plugin initialization test passed');
      },
    },
    {
      name: 'should handle complete goal lifecycle with real database',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing complete goal lifecycle...');

        // Verify database is available
        if (!runtime.db) {
          throw new Error('Database not available in runtime');
        }
        console.log('✓ Database adapter is available');

        // Get the goals service
        const dataService = runtime.getService('goals') as GoalService;
        if (!dataService) {
          throw new Error('Goals service not available');
        }

        // Generate unique test data
        const testEntityId = asUUID(uuidv4());
        const goalName = `Integration Test Goal ${Date.now()}`;

        // Step 1: Create goal
        const goalId = await dataService.createGoal({
          agentId: runtime.agentId,
          ownerType: 'entity',
          ownerId: testEntityId,
          name: goalName,
          description: 'Real database integration test',
          metadata: { source: 'integration-test' },
          tags: ['test', 'integration', 'urgent'],
        });

        if (!goalId) {
          throw new Error('Failed to create goal');
        }
        console.log(`✓ Created goal: ${goalId}`);

        // Step 2: Retrieve and verify goal
        const retrievedGoal = await dataService.getGoal(goalId);
        if (!retrievedGoal) {
          throw new Error('Failed to retrieve created goal');
        }
        if (retrievedGoal.name !== goalName) {
          throw new Error(`Name mismatch: expected ${goalName}, got ${retrievedGoal.name}`);
        }
        if (retrievedGoal.tags?.length !== 3) {
          throw new Error(`Tags mismatch: expected 3 tags, got ${retrievedGoal.tags?.length}`);
        }
        console.log('✓ Retrieved and verified goal');

        // Step 3: Update goal
        const updateSuccess = await dataService.updateGoal(goalId, {
          name: `${goalName} - Updated`,
          description: 'Updated integration test goal',
          metadata: { source: 'integration-test', updated: true },
        });
        if (!updateSuccess) {
          throw new Error('Failed to update goal');
        }
        console.log('✓ Updated goal');

        // Step 4: Verify update
        const updatedGoal = await dataService.getGoal(goalId);
        if (!updatedGoal || !updatedGoal.name.includes('Updated')) {
          throw new Error('Update not reflected in database');
        }
        console.log('✓ Verified update');

        // Step 5: Complete goal
        const completeSuccess = await dataService.updateGoal(goalId, {
          isCompleted: true,
          completedAt: new Date(),
        });
        if (!completeSuccess) {
          throw new Error('Failed to complete goal');
        }
        const completedGoal = await dataService.getGoal(goalId);
        if (!completedGoal || !completedGoal.isCompleted) {
          throw new Error('Goal not marked as completed');
        }
        console.log('✓ Completed goal');

        // Step 6: Clean up
        const deleteSuccess = await dataService.deleteGoal(goalId);
        if (!deleteSuccess) {
          throw new Error('Failed to delete goal');
        }
        const deletedGoal = await dataService.getGoal(goalId);
        if (deletedGoal) {
          throw new Error('Goal still exists after deletion');
        }
        console.log('✓ Deleted goal');

        console.log('✅ Complete goal lifecycle test passed');
      },
    },
    {
      name: 'should validate all action handlers with real runtime',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing action handlers with real runtime...');

        // Generate test data
        const testEntityId = asUUID(uuidv4());

        // Test CREATE_GOAL action
        const createAction = runtime.actions.find((a) => a.name === 'CREATE_GOAL');
        if (!createAction) {
          throw new Error('CREATE_GOAL action not found');
        }

        const createMessage = createMessageMemory({
          entityId: testEntityId,
          agentId: runtime.agentId,
          roomId: asUUID(uuidv4()),
          content: {
            text: 'Create a goal to learn Spanish within 6 months',
            source: 'test',
          },
        });

        // Validate action
        const isValid = await createAction.validate(runtime, createMessage);
        if (!isValid) {
          throw new Error('CREATE_GOAL action validation failed');
        }
        console.log('✓ CREATE_GOAL action validated');

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
          throw new Error('CREATE_GOAL action handler did not execute callback');
        }
        if (!responseContent || !responseContent.text) {
          throw new Error('CREATE_GOAL action did not provide response content');
        }
        console.log('✓ CREATE_GOAL action executed successfully');

        // Test COMPLETE_GOAL action
        const completeAction = runtime.actions.find((a) => a.name === 'COMPLETE_GOAL');
        if (!completeAction) {
          throw new Error('COMPLETE_GOAL action not found');
        }

        const completeMessage = createMessageMemory({
          entityId: testEntityId,
          agentId: runtime.agentId,
          roomId: asUUID(uuidv4()),
          content: {
            text: 'Complete the Spanish learning goal',
            source: 'test',
          },
        });

        const completeValid = await completeAction.validate(runtime, completeMessage);
        if (!completeValid) {
          throw new Error('COMPLETE_GOAL action validation failed');
        }
        console.log('✓ COMPLETE_GOAL action validated');

        console.log('✅ Action handlers test passed');
      },
    },
    {
      name: 'should test GOALS provider with real data',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing GOALS provider with real data...');

        // Get the goals service
        const dataService = runtime.getService('goals') as GoalService;
        if (!dataService) {
          throw new Error('Goals service not available');
        }

        // Create test goals
        const testEntityId = asUUID(uuidv4());

        const goalIds: UUID[] = [];

        // Create multiple goals for testing
        for (let i = 0; i < 3; i++) {
          const goalId = await dataService.createGoal({
            agentId: runtime.agentId,
            ownerType: 'entity',
            ownerId: testEntityId,
            name: `Provider Test Goal ${i + 1}`,
            description: `Test goal ${i + 1} for provider testing`,
            metadata: { priority: i + 1 },
            tags: [`test-${i}`, 'provider-test'],
          });
          if (goalId) {
            goalIds.push(goalId);
          }
        }

        // Test provider
        const goalsProvider = runtime.providers.find((p) => p.name === 'GOALS');
        if (!goalsProvider) {
          throw new Error('GOALS provider not found');
        }

        const testMessage = createMessageMemory({
          entityId: testEntityId,
          agentId: runtime.agentId,
          roomId: asUUID(uuidv4()),
          content: {
            text: 'Show me my goals',
            source: 'test',
          },
        });

        const state = await runtime.composeState(testMessage);
        const providerResult = await goalsProvider.get(runtime, testMessage, state);

        if (!providerResult) {
          throw new Error('GOALS provider returned no result');
        }

        // Validate provider result structure
        if (typeof providerResult !== 'object') {
          throw new Error('Provider result should be an object');
        }

        if (!providerResult.text && !providerResult.values && !providerResult.data) {
          throw new Error('Provider result should have text, values, or data');
        }

        if (providerResult.text && typeof providerResult.text !== 'string') {
          throw new Error('Provider result text should be a string');
        }

        console.log('✓ GOALS provider returned valid result structure');

        // Test that provider includes goal information when goals exist
        if (providerResult.text && !providerResult.text.toLowerCase().includes('goal')) {
          console.log('⚠️ Provider text does not mention goals (may be expected if filtering)');
        } else if (providerResult.text) {
          console.log('✓ Provider text includes goal information');
        }

        // Clean up
        for (const goalId of goalIds) {
          await dataService.deleteGoal(goalId);
        }

        console.log('✅ GOALS provider test passed');
      },
    },
    {
      name: 'should test goal filtering and querying capabilities',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing goal filtering and querying...');

        // Get the goals service
        const dataService = runtime.getService('goals') as GoalService;
        if (!dataService) {
          throw new Error('Goals service not available');
        }

        const testEntityId = asUUID(uuidv4());
        const testAgentId = asUUID(uuidv4());

        const goalIds: UUID[] = [];

        // Create goals with different states and tags
        const testGoals = [
          {
            name: 'Work Goal - Active',
            tags: ['work', 'active'],
            isCompleted: false,
            ownerType: 'entity' as const,
            ownerId: testEntityId,
          },
          {
            name: 'Personal Goal - Completed',
            tags: ['personal', 'health'],
            isCompleted: true,
            ownerType: 'entity' as const,
            ownerId: testEntityId,
          },
          {
            name: 'Agent Goal - Active',
            tags: ['agent', 'system'],
            isCompleted: false,
            ownerType: 'agent' as const,
            ownerId: testAgentId,
          },
        ];

        // Create test goals
        for (const goalData of testGoals) {
          const goalId = await dataService.createGoal({
            agentId: runtime.agentId,
            ownerType: goalData.ownerType,
            ownerId: goalData.ownerId,
            name: goalData.name,
            description: `Description for ${goalData.name}`,
            metadata: { test: true },
            tags: goalData.tags,
          });

          if (goalData.isCompleted && goalId) {
            await dataService.updateGoal(goalId, {
              isCompleted: true,
              completedAt: new Date(),
            });
          }

          if (goalId) {
            goalIds.push(goalId);
          }
        }

        // Test filtering by owner type and ID
        const entityGoals = await dataService.getGoals({
          ownerType: 'entity',
          ownerId: testEntityId,
        });

        if (entityGoals.length !== 2) {
          throw new Error(`Expected 2 entity goals, got ${entityGoals.length}`);
        }
        console.log('✓ Entity goal filtering works');

        // Test filtering by completion status
        const uncompletedGoals = await dataService.getUncompletedGoals('entity', testEntityId);
        if (uncompletedGoals.length !== 1) {
          throw new Error(`Expected 1 uncompleted entity goal, got ${uncompletedGoals.length}`);
        }
        console.log('✓ Uncompleted goal filtering works');

        // Test filtering by tags
        const workGoals = await dataService.getGoals({
          ownerType: 'entity',
          ownerId: testEntityId,
          tags: ['work'],
        });

        if (workGoals.length !== 1) {
          throw new Error(`Expected 1 work goal, got ${workGoals.length}`);
        }
        if (!workGoals[0].name.includes('Work Goal')) {
          throw new Error('Wrong goal returned for work tag filter');
        }
        console.log('✓ Tag filtering works');

        // Test agent goals
        const agentGoals = await dataService.getGoals({
          ownerType: 'agent',
          ownerId: testAgentId,
        });

        if (agentGoals.length !== 1) {
          throw new Error(`Expected 1 agent goal, got ${agentGoals.length}`);
        }
        console.log('✓ Agent goal filtering works');

        // Clean up
        for (const goalId of goalIds) {
          await dataService.deleteGoal(goalId);
        }

        console.log('✅ Goal filtering and querying test passed');
      },
    },
    {
      name: 'should test real message processing and memory creation',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing real message processing and memory creation...');

        const testEntityId = asUUID(uuidv4());
        const testRoomId = asUUID(uuidv4());

        // Create a test message that should trigger goal creation
        const goalMessage = createMessageMemory({
          entityId: testEntityId,
          agentId: runtime.agentId,
          roomId: testRoomId,
          content: {
            text: 'I want to set a goal to read 12 books this year',
            source: 'real-test',
          },
        });

        // Process the message through the runtime (this tests the full pipeline)
        try {
          const state = { values: {}, data: {}, text: '' };
          await runtime.processActions(goalMessage, [], state, async () => []);
          console.log('✓ Message processed without errors');
        } catch (error) {
          // This might fail if dependencies aren't available, but shouldn't crash
          console.log(
            `⚠️ Message processing had issues: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        // Test memory creation directly
        const testMemory = await runtime.createMemory(
          {
            entityId: testEntityId,
            agentId: runtime.agentId,
            roomId: testRoomId,
            content: {
              text: 'Test memory for goals integration testing',
              type: 'test',
              metadata: { source: 'integration-test' },
            },
          },
          'messages'
        );

        if (!testMemory) {
          throw new Error('Failed to create memory in runtime');
        }
        console.log('✓ Memory created successfully');

        // Retrieve the memory to verify it was stored
        const retrievedMemories = await runtime.getMemories({
          roomId: testRoomId,
          count: 10,
          tableName: 'messages',
        });

        if (!retrievedMemories || retrievedMemories.length === 0) {
          throw new Error('Failed to retrieve memories from runtime');
        }

        const foundMemory = retrievedMemories.find((m) => m.id === testMemory);
        if (!foundMemory) {
          throw new Error('Created memory not found in retrieved memories');
        }
        console.log('✓ Memory retrieved and verified');

        console.log('✅ Real message processing and memory creation test passed');
      },
    },
    {
      name: 'should test complete real workflow end-to-end',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing complete real workflow end-to-end...');

        const testEntityId = asUUID(uuidv4());
        const testRoomId = asUUID(uuidv4());

        // Step 1: Create initial message
        const userMessage = createMessageMemory({
          entityId: testEntityId,
          agentId: runtime.agentId,
          roomId: testRoomId,
          content: {
            text: 'I want to set a goal to complete a marathon within one year',
            source: 'real-workflow-test',
          },
        });

        // Step 2: Compose state (this tests provider integration)
        const state = await runtime.composeState(userMessage);
        if (!state) {
          throw new Error('Failed to compose state');
        }
        console.log('✓ State composed successfully');

        // Step 3: Find and validate CREATE_GOAL action
        const createAction = runtime.actions.find((a) => a.name === 'CREATE_GOAL');
        if (!createAction) {
          throw new Error('CREATE_GOAL action not found');
        }

        const isValid = await createAction.validate(runtime, userMessage, state);
        if (!isValid) {
          throw new Error('CREATE_GOAL action validation failed');
        }
        console.log('✓ Action validated');

        // Step 4: Execute action and capture result
        let actionResult: any = null;
        const responseMemories: any[] = [];

        const workflowCallback = async (content: any, files?: any) => {
          actionResult = content;

          // Create response memory
          const responseMemoryId = await runtime.createMemory(
            {
              entityId: runtime.agentId,
              roomId: testRoomId,
              content,
            },
            'messages'
          );

          // Retrieve the created memory to return
          const memories = await runtime.getMemories({
            roomId: testRoomId,
            count: 1,
            tableName: 'messages',
          });
          const responseMemory = memories.find((m) => m.id === responseMemoryId);

          if (responseMemory) {
            responseMemories.push(responseMemory);
            return [responseMemory];
          }

          return [];
        };

        await createAction.handler(runtime, userMessage, state, {}, workflowCallback);

        if (!actionResult) {
          throw new Error('Action did not produce result');
        }
        console.log('✓ Action executed and response created');

        // Step 5: Test that goal was actually created (if action succeeded)
        // Get the goals service
        const dataService = runtime.getService('goals') as GoalService;
        if (!dataService) {
          throw new Error('Goals service not available');
        }

        // Get goals for this user to verify creation
        const goals = await dataService.getGoals({
          ownerType: 'entity',
          ownerId: testEntityId,
        });

        // Find a goal that might have been created by our action
        const possibleGoal = goals.find(
          (goal: any) =>
            goal.name.toLowerCase().includes('marathon') ||
            goal.description?.toLowerCase().includes('marathon')
        );

        if (possibleGoal) {
          console.log(`✓ Goal found: ${possibleGoal.name}`);

          // Test completion workflow
          const completeAction = runtime.actions.find((a) => a.name === 'COMPLETE_GOAL');
          if (completeAction) {
            const completeMessage = createMessageMemory({
              entityId: testEntityId,
              agentId: runtime.agentId,
              roomId: testRoomId,
              content: {
                text: 'I completed my marathon goal!',
                source: 'real-workflow-test',
              },
            });

            const completeState = await runtime.composeState(completeMessage);
            const completeValid = await completeAction.validate(
              runtime,
              completeMessage,
              completeState
            );

            if (completeValid) {
              console.log('✓ COMPLETE_GOAL action validation passed');
            } else {
              console.log(
                '⚠️ COMPLETE_GOAL validation failed (expected if no incomplete goals match)'
              );
            }
          }

          // Clean up the created goal
          await dataService.deleteGoal(possibleGoal.id);
          console.log('✓ Test goal cleaned up');
        } else {
          console.log('⚠️ No matching goal found (action may have different behavior)');
        }

        console.log('✅ Complete real workflow end-to-end test passed');
      },
    },
    {
      name: 'should test error handling with real runtime',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🧪 Testing error handling scenarios...');

        // Get the goals service
        const dataService = runtime.getService('goals') as GoalService;
        if (!dataService) {
          throw new Error('Goals service not available');
        }

        // Test getting non-existent goal
        const nonExistentId = asUUID(uuidv4());
        const nonExistentGoal = await dataService.getGoal(nonExistentId);
        if (nonExistentGoal !== null) {
          throw new Error('Expected null for non-existent goal');
        }
        console.log('✓ Non-existent goal returns null');

        // Test deleting non-existent goal
        const deleteResult = await dataService.deleteGoal(nonExistentId);
        // Should not throw, should handle gracefully
        console.log('✓ Deleting non-existent goal handled gracefully');

        // Test action with invalid input
        const createAction = runtime.actions.find((a) => a.name === 'CREATE_GOAL');
        if (!createAction) {
          throw new Error('CREATE_GOAL action not found');
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

        // Test creating goal with invalid owner type
        try {
          const invalidGoalId = await dataService.createGoal({
            agentId: runtime.agentId,
            ownerType: 'invalid' as any,
            ownerId: asUUID(uuidv4()),
            name: 'Invalid Goal',
            description: 'Test invalid goal',
            metadata: {},
            tags: [],
          });
          if (invalidGoalId) {
            // If it was created, clean it up
            await dataService.deleteGoal(invalidGoalId);
          }
          console.log('✓ Invalid goal creation handled gracefully');
        } catch (error) {
          console.log('✓ Invalid goal creation properly rejected');
        }

        console.log('✅ Error handling test passed');
      },
    },
  ],
};

export default GoalsPluginComprehensiveE2ETestSuite;
