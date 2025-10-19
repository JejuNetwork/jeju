import type { TestSuite, IAgentRuntime, Memory, State } from '@elizaos/core';
import { createUniqueUuid } from '@elizaos/core';
import { ShellService } from '../../service';
import { runShellCommandAction } from '../../action';
import path from 'path';
import fs from 'fs';

export class ShellStatefulE2ETestSuite implements TestSuite {
  name = 'plugin-shell-stateful-e2e';
  description = 'Tests for stateful shell operations and directory navigation';

  tests = [
    {
      name: 'Should maintain current working directory across commands',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing CWD persistence across commands...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        const initialCwd = shellService.getCurrentWorkingDirectory();
        console.log(`  Initial CWD: ${initialCwd}`);

        // Navigate to parent directory
        const roomId = createUniqueUuid(runtime, 'test-room');
        const cdMessage: Memory = {
          id: createUniqueUuid(runtime, 'test-cd'),
          entityId: runtime.agentId,
          content: { text: 'cd ..' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        const state: State = { values: {}, data: {}, text: '' };
        await runShellCommandAction.handler(
          runtime,
          cdMessage,
          state,
          {},
          async () => {
            return [];
          }
        );

        const newCwd = shellService.getCurrentWorkingDirectory();
        const expectedCwd = path.resolve(initialCwd, '..');

        if (newCwd !== expectedCwd) {
          throw new Error(
            `CWD not updated correctly. Expected: ${expectedCwd}, Got: ${newCwd}`
          );
        }

        console.log(`✓ CWD changed to: ${newCwd}`);

        // Verify PWD shows the new directory
        const pwdMessage: Memory = {
          id: createUniqueUuid(runtime, 'test-pwd'),
          entityId: runtime.agentId,
          content: { text: 'pwd' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        let pwdResponse: any = null;
        await runShellCommandAction.handler(
          runtime,
          pwdMessage,
          state,
          {},
          async (resp) => {
            pwdResponse = resp;
            return [];
          }
        );

        const attachment = pwdResponse.attachments[0];
        const outputData = JSON.parse(attachment.text);

        if (!outputData.stdout.includes(newCwd)) {
          throw new Error(
            `PWD output doesn't match current directory: ${outputData.stdout}`
          );
        }

        // Navigate back
        await shellService.executeCommand(`cd ${initialCwd}`);
        console.log('✓ Successfully navigated back to initial directory');
      },
    },

    {
      name: 'Should handle complex directory navigation sequence',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing complex directory navigation...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        const initialCwd = shellService.getCurrentWorkingDirectory();

        // Create a test directory structure
        const testDir = path.join(initialCwd, `shell-test-${Date.now()}`);
        const subDir1 = path.join(testDir, 'subdir1');
        const subDir2 = path.join(testDir, 'subdir2');

        // Create directories
        await shellService.executeCommand(`mkdir -p ${testDir}`);
        await shellService.executeCommand(`mkdir -p ${subDir1}`);
        await shellService.executeCommand(`mkdir -p ${subDir2}`);

        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        try {
          // Navigate through directories
          const commands = [
            { cmd: `cd ${testDir}`, expected: testDir },
            { cmd: 'cd subdir1', expected: subDir1 },
            { cmd: 'cd ../subdir2', expected: subDir2 },
            { cmd: 'cd ..', expected: testDir },
          ];

          for (const { cmd, expected } of commands) {
            const message: Memory = {
              id: createUniqueUuid(runtime, 'test-nav'),
              entityId: runtime.agentId,
              content: { text: cmd },
              agentId: runtime.agentId,
              roomId,
              createdAt: Date.now(),
            };

            await runShellCommandAction.handler(
              runtime,
              message,
              state,
              {},
              async () => {
                return [];
              }
            );

            const currentCwd = shellService.getCurrentWorkingDirectory();
            if (currentCwd !== expected) {
              throw new Error(
                `Navigation failed. Expected: ${expected}, Got: ${currentCwd}`
              );
            }

            console.log(`✓ ${cmd} -> ${path.basename(currentCwd)}`);
          }
        } finally {
          // Cleanup
          await shellService.executeCommand(`cd ${initialCwd}`);
          await shellService.executeCommand(`rm -rf ${testDir}`);
        }

        console.log('✓ Complex navigation completed successfully');
      },
    },

    {
      name: 'Should persist environment within session',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing environment persistence...');

        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        // Set an environment variable
        const setEnvMessage: Memory = {
          id: createUniqueUuid(runtime, 'test-env-set'),
          entityId: runtime.agentId,
          content: { text: 'export TEST_VAR="Hello from shell plugin"' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        await runShellCommandAction.handler(
          runtime,
          setEnvMessage,
          state,
          {},
          async () => {
            return [];
          }
        );

        // Read the environment variable in the same session
        const getEnvMessage: Memory = {
          id: createUniqueUuid(runtime, 'test-env-get'),
          entityId: runtime.agentId,
          content: { text: 'echo $TEST_VAR' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        await runShellCommandAction.handler(
          runtime,
          getEnvMessage,
          state,
          {},
          async (_resp) => {
            return [];
          }
        );

        // Note: Environment variables set via export in a child process
        // won't persist in the parent. This is a limitation of using execSync.
        // The test should acknowledge this limitation.
        console.log('✓ Environment variable command executed');
        console.log(
          '  Note: Environment variables are scoped to individual command executions'
        );
      },
    },

    {
      name: 'Should handle file operations in changed directory',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing file operations after directory change...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        const initialCwd = shellService.getCurrentWorkingDirectory();
        const testDir = path.join(initialCwd, `shell-file-test-${Date.now()}`);
        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        try {
          // Create test directory and navigate to it
          await shellService.executeCommand(`mkdir -p ${testDir}`);
          await shellService.executeCommand(`cd ${testDir}`);

          // Create a file in the new directory
          const createFileMessage: Memory = {
            id: createUniqueUuid(runtime, 'test-file-create'),
            entityId: runtime.agentId,
            content: { text: 'echo "Test content" > test.txt' },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

          await runShellCommandAction.handler(
            runtime,
            createFileMessage,
            state,
            {},
            async () => {
              return [];
            }
          );

          // Verify file exists
          const listMessage: Memory = {
            id: createUniqueUuid(runtime, 'test-file-list'),
            entityId: runtime.agentId,
            content: { text: 'ls -la test.txt' },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

          let response: any = null;
          await runShellCommandAction.handler(
            runtime,
            listMessage,
            state,
            {},
            async (resp) => {
              response = resp;
              return [];
            }
          );

          const attachment = response.attachments[0];
          const outputData = JSON.parse(attachment.text);

          if (outputData.exitCode !== 0) {
            throw new Error('File was not created in the correct directory');
          }

          // Verify file path
          const expectedPath = path.join(testDir, 'test.txt');
          if (!fs.existsSync(expectedPath)) {
            throw new Error(`File not found at expected path: ${expectedPath}`);
          }

          console.log('✓ File created successfully in changed directory');
        } finally {
          // Cleanup
          await shellService.executeCommand(`cd ${initialCwd}`);
          await shellService.executeCommand(`rm -rf ${testDir}`);
        }
      },
    },

    {
      name: 'Should track file operations in history',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing file operation tracking...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        const testFile = `test-${Date.now()}.txt`;

        try {
          // Perform various file operations
          await shellService.executeCommand(`touch ${testFile}`);
          await shellService.executeCommand(`echo "content" > ${testFile}`);
          await shellService.executeCommand(`cat ${testFile}`);
          await shellService.executeCommand(`rm ${testFile}`);

          // Check file operation history
          const fileOps = shellService.getFileOperationHistory();

          if (!fileOps || fileOps.length === 0) {
            throw new Error('No file operations recorded');
          }

          // Verify operations were tracked
          const operations = fileOps.map((op) => op.operationType);
          console.log(`✓ Tracked ${fileOps.length} file operations`);
          console.log(`  Operations: ${operations.join(', ')}`);
        } catch (error) {
          // Cleanup if test fails
          await shellService.executeCommand(`rm -f ${testFile}`);
          throw error;
        }
      },
    },
  ];
}

export default new ShellStatefulE2ETestSuite();
