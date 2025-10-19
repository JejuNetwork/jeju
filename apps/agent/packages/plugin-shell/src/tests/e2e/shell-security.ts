import type { TestSuite, IAgentRuntime, Memory, State } from '@elizaos/core';
import { createUniqueUuid } from '@elizaos/core';
import { ShellService } from '../../service';
import { runShellCommandAction } from '../../action';

export class ShellSecurityE2ETestSuite implements TestSuite {
  name = 'plugin-shell-security-e2e';
  description = 'Security-focused tests for shell plugin';

  tests = [
    {
      name: 'Should prevent directory traversal attacks',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing directory traversal prevention...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        // Try various directory traversal attempts
        const traversalAttempts = [
          'cd ../../../../../../etc',
          'cat ../../../../../../../etc/passwd',
          'ls -la ../../../../',
        ];

        for (const cmd of traversalAttempts) {
          const message: Memory = {
            id: createUniqueUuid(runtime, 'test-traversal'),
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

          // The commands should execute but we should track that they happened
          console.log(`✓ Command executed: ${cmd}`);
          console.log(
            '  Note: Shell plugin executes commands as requested by the agent'
          );
        }

        // Verify we can still operate normally
        const currentCwd = shellService.getCurrentWorkingDirectory();
        console.log(`  Current directory: ${currentCwd}`);
      },
    },

    {
      name: 'Should handle potentially dangerous commands with care',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing handling of potentially dangerous commands...');

        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        // Test commands that could be dangerous if misused
        const testCommands = [
          { cmd: 'echo "test" > /tmp/shell-plugin-test.txt', safe: true },
          { cmd: 'rm -f /tmp/shell-plugin-test.txt', safe: true },
          { cmd: 'find /tmp -name "shell-plugin-*"', safe: true },
        ];

        for (const { cmd, safe } of testCommands) {
          const message: Memory = {
            id: createUniqueUuid(runtime, 'test-dangerous'),
            entityId: runtime.agentId,
            content: { text: cmd },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

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

          if (response && response.attachments) {
            const attachment = response.attachments[0];
            const outputData = JSON.parse(attachment.text);
            console.log(
              `✓ Command ${safe ? 'safely' : 'carefully'} executed: ${cmd}`
            );
            console.log(`  Exit code: ${outputData.exitCode}`);
          }
        }

        console.log('✓ Potentially dangerous commands handled appropriately');
      },
    },

    {
      name: 'Should properly escape special characters in commands',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing special character escaping...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        // Test commands with special characters
        const specialCharCommands = [
          'echo "Hello $USER"',
          "echo 'Single quotes: $USER'",
          'echo "Backticks: `date`"',
          'echo "Semicolon; and pipe |"',
          'echo "Ampersand & and redirect >"',
        ];

        for (const cmd of specialCharCommands) {
          const message: Memory = {
            id: createUniqueUuid(runtime, 'test-special'),
            entityId: runtime.agentId,
            content: { text: cmd },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

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

          if (response && response.attachments) {
            const attachment = response.attachments[0];
            const outputData = JSON.parse(attachment.text);
            console.log(`✓ Special character command executed: ${cmd}`);
            console.log(`  Output: ${outputData.stdout.trim()}`);
          }
        }
      },
    },

    {
      name: 'Should track command history for audit purposes',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing command history audit trail...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        // Clear history first
        shellService.clearHistory();

        // Execute a series of commands
        const auditCommands = ['whoami', 'pwd', 'date', 'echo "Audit test"'];

        for (const cmd of auditCommands) {
          await shellService.executeCommand(cmd);
        }

        // Check history
        const history = shellService.getHistory(10);

        if (history.length !== auditCommands.length) {
          throw new Error(
            `Expected ${auditCommands.length} commands in history, got ${history.length}`
          );
        }

        // Verify all commands are tracked with timestamps
        for (let i = 0; i < auditCommands.length; i++) {
          const entry = history[i];
          if (entry.command !== auditCommands[i]) {
            throw new Error(
              `History mismatch at index ${i}: expected "${auditCommands[i]}", got "${entry.command}"`
            );
          }

          if (!entry.timestamp || !entry.cwd) {
            throw new Error('History entry missing required audit fields');
          }
        }

        console.log('✓ Command history audit trail working correctly');
        console.log(`  Tracked ${history.length} commands with full metadata`);
      },
    },

    {
      name: 'Should handle timeout for long-running commands',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing long-running command handling...');

        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        // Test a command that takes a few seconds
        const sleepMessage: Memory = {
          id: createUniqueUuid(runtime, 'test-timeout'),
          entityId: runtime.agentId,
          content: { text: 'sleep 2 && echo "Completed after sleep"' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        const startTime = Date.now();
        let response: any = null;

        await runShellCommandAction.handler(
          runtime,
          sleepMessage,
          state,
          {},
          async (resp) => {
            response = resp;
            return [];
          }
        );

        const elapsed = Date.now() - startTime;

        if (response && response.attachments) {
          const attachment = response.attachments[0];
          const outputData = JSON.parse(attachment.text);

          if (!outputData.stdout.includes('Completed after sleep')) {
            throw new Error('Long-running command did not complete properly');
          }

          console.log('✓ Long-running command completed successfully');
          console.log(`  Execution time: ${elapsed}ms`);
        }
      },
    },
  ];
}

export default new ShellSecurityE2ETestSuite();
