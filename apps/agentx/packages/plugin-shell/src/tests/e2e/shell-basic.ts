import type { TestSuite, IAgentRuntime, Memory, State } from '@elizaos/core';
import { createUniqueUuid } from '@elizaos/core';
import { ShellService } from '../../service';
import { runShellCommandAction, clearShellHistoryAction } from '../../action';

export class ShellBasicE2ETestSuite implements TestSuite {
  name = 'plugin-shell-basic-e2e';
  description = 'Basic end-to-end tests for shell plugin functionality';

  tests = [
    {
      name: 'Should execute simple echo command',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing simple echo command execution...');

        // Create a test message
        const roomId = createUniqueUuid(runtime, 'test-room');
        const message: Memory = {
          id: createUniqueUuid(runtime, 'test-msg-1'),
          entityId: runtime.agentId,
          content: { text: 'echo "Hello from shell plugin"' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        let callbackCalled = false;
        let callbackResponse: any = null;

        const state: State = { values: {}, data: {}, text: '' };
        await runShellCommandAction.handler(
          runtime,
          message,
          state,
          {},
          async (response) => {
            callbackCalled = true;
            callbackResponse = response;
            return [];
          }
        );

        if (!callbackCalled) {
          throw new Error('Callback was not called');
        }

        if (!callbackResponse.text.includes('Hello from shell plugin')) {
          throw new Error(`Unexpected output: ${callbackResponse.text}`);
        }

        console.log('✓ Echo command executed successfully');
        console.log(`  Output: ${callbackResponse.text}`);
      },
    },

    {
      name: 'Should list files in current directory',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing ls command...');

        const roomId = createUniqueUuid(runtime, 'test-room');
        const message: Memory = {
          id: createUniqueUuid(runtime, 'test-msg-2'),
          entityId: runtime.agentId,
          content: { text: 'ls -la' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        const state: State = { values: {}, data: {}, text: '' };
        let response: any = null;
        await runShellCommandAction.handler(
          runtime,
          message,
          state,
          {},
          async (resp) => {
            response = resp;
            return [];
          }
        );

        if (
          !response ||
          !response.attachments ||
          response.attachments.length === 0
        ) {
          throw new Error('No attachments returned with shell output');
        }

        const attachment = response.attachments[0];
        const outputData = JSON.parse(attachment.text);

        if (outputData.exitCode !== 0) {
          throw new Error(
            `ls command failed with exit code: ${outputData.exitCode}`
          );
        }

        console.log('✓ ls command executed successfully');
        console.log(
          `  Files found: ${outputData.stdout.split('\n').length - 1} items`
        );
      },
    },

    {
      name: 'Should handle command errors gracefully',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing error handling with invalid command...');

        const roomId = createUniqueUuid(runtime, 'test-room');
        const message: Memory = {
          id: createUniqueUuid(runtime, 'test-msg-3'),
          entityId: runtime.agentId,
          content: { text: 'thisisnotavalidcommand123' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        const state: State = { values: {}, data: {}, text: '' };
        let response: any = null;
        await runShellCommandAction.handler(
          runtime,
          message,
          state,
          {},
          async (resp) => {
            response = resp;
            return [];
          }
        );

        if (
          !response ||
          !response.attachments ||
          response.attachments.length === 0
        ) {
          throw new Error('No error information returned');
        }

        const attachment = response.attachments[0];
        const outputData = JSON.parse(attachment.text);

        if (outputData.exitCode === 0) {
          throw new Error('Expected non-zero exit code for invalid command');
        }

        console.log('✓ Error handling works correctly');
        console.log(`  Exit code: ${outputData.exitCode}`);
      },
    },

    {
      name: 'Should extract command from natural language',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing natural language command extraction...');

        const roomId = createUniqueUuid(runtime, 'test-room');
        const message: Memory = {
          id: createUniqueUuid(runtime, 'test-msg-4'),
          entityId: runtime.agentId,
          content: {
            text: 'Can you show me what files are in the current directory?',
          },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        const state: State = { values: {}, data: {}, text: '' };
        let response: any = null;
        await runShellCommandAction.handler(
          runtime,
          message,
          state,
          {},
          async (resp) => {
            response = resp;
            return [];
          }
        );

        if (
          !response ||
          !response.attachments ||
          response.attachments.length === 0
        ) {
          throw new Error('Command extraction failed');
        }

        const attachment = response.attachments[0];
        const outputData = JSON.parse(attachment.text);

        // Check if a listing command was executed (ls, dir, etc.)
        if (
          !outputData.command.includes('ls') &&
          !outputData.command.includes('dir')
        ) {
          throw new Error(
            `Unexpected command extracted: ${outputData.command}`
          );
        }

        console.log('✓ Natural language command extraction successful');
        console.log(`  Extracted command: ${outputData.command}`);
      },
    },

    {
      name: 'Should clear shell history',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing shell history clearing...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        // Execute some commands first
        await shellService.executeCommand('echo test1');
        await shellService.executeCommand('echo test2');

        // Verify history exists
        let history = shellService.getHistory();
        if (history.length < 2) {
          throw new Error('History not properly recorded');
        }

        // Clear history
        const roomId = createUniqueUuid(runtime, 'test-room');
        const message: Memory = {
          id: createUniqueUuid(runtime, 'test-msg-5'),
          entityId: runtime.agentId,
          content: { text: 'clear shell history' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        const state: State = { values: {}, data: {}, text: '' };
        await clearShellHistoryAction.handler(
          runtime,
          message,
          state,
          {},
          async () => {
            return [];
          }
        );

        // Verify history is cleared
        history = shellService.getHistory();
        if (history.length !== 0) {
          throw new Error('History was not cleared');
        }

        console.log('✓ Shell history cleared successfully');
      },
    },
  ];
}

export default new ShellBasicE2ETestSuite();
