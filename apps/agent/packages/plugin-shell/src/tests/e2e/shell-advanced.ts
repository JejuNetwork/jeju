import type { TestSuite, IAgentRuntime, Memory, State } from '@elizaos/core';
import { createUniqueUuid } from '@elizaos/core';
import { ShellService } from '../../service';
import { runShellCommandAction } from '../../action';
import path from 'path';

export class ShellAdvancedE2ETestSuite implements TestSuite {
  name = 'plugin-shell-advanced-e2e';
  description = 'Advanced tests for complex multi-action shell scenarios';

  tests = [
    {
      name: 'Should handle piped commands correctly',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing piped command execution...');

        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        // Test pipe command
        const pipeMessage: Memory = {
          id: createUniqueUuid(runtime, 'test-pipe'),
          entityId: runtime.agentId,
          content: { text: 'echo "line1\nline2\nline3" | grep line2' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        let response: any = null;
        await runShellCommandAction.handler(
          runtime,
          pipeMessage,
          state,
          {},
          async (resp) => {
            response = resp;
            return [];
          }
        );

        const attachment = response.attachments[0];
        const outputData = JSON.parse(attachment.text);

        if (
          !outputData.stdout.includes('line2') ||
          outputData.stdout.includes('line1')
        ) {
          throw new Error(`Pipe command failed. Output: ${outputData.stdout}`);
        }

        console.log('✓ Piped commands work correctly');
        console.log(`  Output: ${outputData.stdout.trim()}`);
      },
    },

    {
      name: 'Should execute compound commands with && and ||',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing compound command execution...');

        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        // Test && (success case)
        const successMessage: Memory = {
          id: createUniqueUuid(runtime, 'test-and-success'),
          entityId: runtime.agentId,
          content: { text: 'echo "first" && echo "second"' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        let response: any = null;
        await runShellCommandAction.handler(
          runtime,
          successMessage,
          state,
          {},
          async (resp) => {
            response = resp;
            return [];
          }
        );

        let attachment = response.attachments[0];
        let outputData = JSON.parse(attachment.text);

        if (
          !outputData.stdout.includes('first') ||
          !outputData.stdout.includes('second')
        ) {
          throw new Error('&& operator failed on success case');
        }

        // Test || (failure case)
        const failMessage: Memory = {
          id: createUniqueUuid(runtime, 'test-or-fail'),
          entityId: runtime.agentId,
          content: { text: 'false || echo "fallback"' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        await runShellCommandAction.handler(
          runtime,
          failMessage,
          state,
          {},
          async (resp) => {
            response = resp;
            return [];
          }
        );

        attachment = response.attachments[0];
        outputData = JSON.parse(attachment.text);

        if (!outputData.stdout.includes('fallback')) {
          throw new Error('|| operator failed on failure case');
        }

        console.log('✓ Compound commands work correctly');
      },
    },

    {
      name: 'Should handle complex multi-step workflow',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing complex multi-step workflow...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        const workDir = path.join(
          shellService.getCurrentWorkingDirectory(),
          `workflow-${Date.now()}`
        );
        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        try {
          // Step 1: Create project structure
          const createStructureMsg: Memory = {
            id: createUniqueUuid(runtime, 'workflow-1'),
            entityId: runtime.agentId,
            content: {
              text: `mkdir -p ${workDir}/{src,test,docs} && cd ${workDir} && echo "# My Project" > README.md`,
            },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

          await runShellCommandAction.handler(
            runtime,
            createStructureMsg,
            state,
            {},
            async () => {
              return [];
            }
          );

          // Verify we're in the new directory
          if (
            !shellService
              .getCurrentWorkingDirectory()
              .includes(path.basename(workDir))
          ) {
            throw new Error('Failed to change to workflow directory');
          }

          // Step 2: Create source files
          const createFilesMsg: Memory = {
            id: createUniqueUuid(runtime, 'workflow-2'),
            entityId: runtime.agentId,
            content: {
              text: 'echo "console.log(\'Hello\');" > src/index.js && echo "export default {};" > src/config.js',
            },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

          await runShellCommandAction.handler(
            runtime,
            createFilesMsg,
            state,
            {},
            async () => {
              return [];
            }
          );

          // Step 3: Create package.json
          const packageJsonContent = {
            name: 'test-project',
            version: '1.0.0',
            main: 'src/index.js',
          };

          const createPackageMsg: Memory = {
            id: createUniqueUuid(runtime, 'workflow-3'),
            entityId: runtime.agentId,
            content: {
              text: `echo '${JSON.stringify(packageJsonContent, null, 2)}' > package.json`,
            },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

          await runShellCommandAction.handler(
            runtime,
            createPackageMsg,
            state,
            {},
            async () => {
              return [];
            }
          );

          // Step 4: List and verify structure
          const verifyMsg: Memory = {
            id: createUniqueUuid(runtime, 'workflow-4'),
            entityId: runtime.agentId,
            content: {
              text: 'find . -type f -name "*.js" -o -name "*.json" -o -name "*.md" | sort',
            },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

          let response: any = null;
          await runShellCommandAction.handler(
            runtime,
            verifyMsg,
            state,
            {},
            async (resp) => {
              response = resp;
              return [];
            }
          );

          const attachment = response.attachments[0];
          const outputData = JSON.parse(attachment.text);

          const expectedFiles = [
            './README.md',
            './package.json',
            './src/config.js',
            './src/index.js',
          ];
          const actualFiles = outputData.stdout.trim().split('\n').sort();

          for (const expectedFile of expectedFiles) {
            if (
              !actualFiles.some((f: any) =>
                f.includes(expectedFile.replace('./', ''))
              )
            ) {
              throw new Error(`Expected file not found: ${expectedFile}`);
            }
          }

          console.log('✓ Complex workflow completed successfully');
          console.log(`  Created ${actualFiles.length} files`);
        } finally {
          // Cleanup
          await shellService.executeCommand(`cd ${path.dirname(workDir)}`);
          await shellService.executeCommand(`rm -rf ${path.basename(workDir)}`);
        }
      },
    },

    {
      name: 'Should handle background processes and job control',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing background process handling...');

        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        // Start a background process
        const bgMessage: Memory = {
          id: createUniqueUuid(runtime, 'test-bg'),
          entityId: runtime.agentId,
          content: { text: 'sleep 2 & echo "Process started in background"' },
          agentId: runtime.agentId,
          roomId,
          createdAt: Date.now(),
        };

        let response: any = null;
        await runShellCommandAction.handler(
          runtime,
          bgMessage,
          state,
          {},
          async (resp) => {
            response = resp;
            return [];
          }
        );

        const attachment = response.attachments[0];
        const outputData = JSON.parse(attachment.text);

        if (!outputData.stdout.includes('Process started in background')) {
          throw new Error('Background process test failed');
        }

        console.log('✓ Background process handling works');
        console.log('  Note: Full job control requires interactive shell');
      },
    },

    {
      name: 'Should handle wildcards and glob patterns correctly',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing wildcard and glob pattern handling...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        const testDir = path.join(
          shellService.getCurrentWorkingDirectory(),
          `glob-test-${Date.now()}`
        );
        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        try {
          // Setup test files
          await shellService.executeCommand(`mkdir -p ${testDir}`);
          await shellService.executeCommand(`cd ${testDir}`);
          await shellService.executeCommand(
            'touch file1.txt file2.txt file3.log test.json'
          );

          // Test wildcard patterns
          const wildcardMsg: Memory = {
            id: createUniqueUuid(runtime, 'test-wildcard'),
            entityId: runtime.agentId,
            content: { text: 'ls *.txt' },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

          let response: any = null;
          await runShellCommandAction.handler(
            runtime,
            wildcardMsg,
            state,
            {},
            async (resp) => {
              response = resp;
              return [];
            }
          );

          const attachment = response.attachments[0];
          const outputData = JSON.parse(attachment.text);

          if (
            !outputData.stdout.includes('file1.txt') ||
            !outputData.stdout.includes('file2.txt') ||
            outputData.stdout.includes('file3.log')
          ) {
            throw new Error('Wildcard pattern matching failed');
          }

          // Test find with quoted wildcards
          const findMsg: Memory = {
            id: createUniqueUuid(runtime, 'test-find'),
            entityId: runtime.agentId,
            content: { text: 'find . -name "*.txt"' },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

          await runShellCommandAction.handler(
            runtime,
            findMsg,
            state,
            {},
            async (resp) => {
              response = resp;
              return [];
            }
          );

          const findAttachment = response.attachments[0];
          const findData = JSON.parse(findAttachment.text);

          if (!findData.command.includes("'*.txt'")) {
            throw new Error('Find command wildcards not properly quoted');
          }

          console.log('✓ Wildcard and glob patterns handled correctly');
        } finally {
          // Cleanup
          await shellService.executeCommand(`cd ${path.dirname(testDir)}`);
          await shellService.executeCommand(`rm -rf ${path.basename(testDir)}`);
        }
      },
    },

    {
      name: 'Should handle script execution with natural language',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing script execution from natural language...');

        const shellService = runtime.getService<ShellService>('SHELL');
        if (!shellService) {
          throw new Error('Shell service not available');
        }

        const scriptDir = path.join(
          shellService.getCurrentWorkingDirectory(),
          `script-test-${Date.now()}`
        );
        const roomId = createUniqueUuid(runtime, 'test-room');
        const state: State = { values: {}, data: {}, text: '' };

        try {
          // Create a test script
          await shellService.executeCommand(`mkdir -p ${scriptDir}`);
          await shellService.executeCommand(`cd ${scriptDir}`);

          const scriptContent = `#!/bin/bash
echo "Script started"
echo "Arguments: $@"
echo "Script completed"`;

          await shellService.executeCommand(
            `echo '${scriptContent}' > test.sh`
          );
          await shellService.executeCommand('chmod +x test.sh');

          // Request script execution using natural language
          const nlMessage: Memory = {
            id: createUniqueUuid(runtime, 'test-nl-script'),
            entityId: runtime.agentId,
            content: {
              text: 'Can you run the test.sh script with arguments "hello world"?',
            },
            agentId: runtime.agentId,
            roomId,
            createdAt: Date.now(),
          };

          let response: any = null;
          await runShellCommandAction.handler(
            runtime,
            nlMessage,
            state,
            {},
            async (resp) => {
              response = resp;
              return [];
            }
          );

          const attachment = response.attachments[0];
          const outputData = JSON.parse(attachment.text);

          if (
            !outputData.stdout.includes('Script started') ||
            !outputData.stdout.includes('Script completed')
          ) {
            console.log('Command extracted:', outputData.command);
            console.log('Output:', outputData.stdout);
            throw new Error('Script execution from natural language failed');
          }

          console.log('✓ Natural language script execution works');
          console.log(`  Extracted command: ${outputData.command}`);
        } finally {
          // Cleanup
          await shellService.executeCommand(`cd ${path.dirname(scriptDir)}`);
          await shellService.executeCommand(
            `rm -rf ${path.basename(scriptDir)}`
          );
        }
      },
    },
  ];
}

export default new ShellAdvancedE2ETestSuite();
