import {
  describe,
  it,
  expect,
  beforeEach,
  mock,
  afterEach,
  beforeAll,
} from 'bun:test';
import {
  type IAgentRuntime,
  type Memory,
  type State,
  ModelType,
  ContentType,
  createMockRuntime as createTypedMockRuntime,
  asUUID,
  createMockMemory,
  createMockState,
} from '@elizaos/core';
import { createMockRuntime } from './test-utils';
import { ShellService } from '../service';
import { shellProvider } from '../provider';
import { runShellCommandAction, clearShellHistoryAction } from '../action';
import * as child_process from 'child_process';

// Simplified TestSuite implementation for local use
class TestSuite {
  constructor(
    private name: string,
    private config: any
  ) {}

  addTest(test: any) {
    it(test.name, async () => {
      const context = this.config.beforeEach ? this.config.beforeEach() : {};
      await test.fn(context);
    });
  }

  run() {
    // No-op, bun:test handles execution
  }
}

const createUnitTest = (config: {
  name: string;
  fn: (context?: any) => Promise<void> | void;
}) => config;

// Note: Complex module mocking removed for bun:test compatibility

describe('ShellService', () => {
  const shellServiceSuite = new TestSuite('ShellService', {
    beforeEach: () => {
      // Use type-safe mock runtime
      const mockRuntime = createTypedMockRuntime({
        agentId: asUUID('00000000-0000-0000-0000-000000000001'),
        getService: mock(),
        composeState: mock(),
        useModel: mock(),
      }) as IAgentRuntime;

      const shellService = new ShellService(mockRuntime);

      // Reset mocks
      mock.restore();

      return { shellService, mockRuntime };
    },
  });

  shellServiceSuite.addTest(
    createUnitTest({
      name: 'should initialize with the correct CWD',
      fn: ({ shellService }) => {
        expect(shellService.getCurrentWorkingDirectory()).toBe(process.cwd());
      },
    })
  );

  shellServiceSuite.addTest(
    createUnitTest({
      name: 'should execute a simple command successfully',
      fn: async ({ shellService }) => {
        // Test with actual command since it's working
        const result = await shellService.executeCommand('echo hello');

        expect(result.exitCode).toBe(0);
        expect(result.output).toContain('hello');
        expect(result.error).toBeUndefined();
        expect(result.cwd).toBe(process.cwd());
      },
    })
  );

  shellServiceSuite.addTest(
    createUnitTest({
      name: 'should handle a failing command and capture stderr',
      fn: async ({ shellService }) => {
        // Test with actual failing command
        const result = await shellService.executeCommand(
          'ls /nonexistent-directory-for-testing'
        );

        expect(result.exitCode).toBe(1); // Actual exit code on macOS/Unix
        expect(result.error).toBeDefined();
        expect(result.error).toContain('No such file or directory');
      },
    })
  );

  shellServiceSuite.run();

  // Filesystem operations test suite
  const filesystemOperationsSuite = new TestSuite('Filesystem Operations', {
    beforeEach: () => {
      const mockRuntime = createTypedMockRuntime({
        agentId: asUUID('00000000-0000-0000-0000-000000000001'),
        getService: mock(),
        composeState: mock(),
        useModel: mock(),
      }) as IAgentRuntime;
      const shellService = new ShellService(mockRuntime);
      mock.restore();
      return { shellService, mockRuntime };
    },
  });

  filesystemOperationsSuite.addTest(
    createUnitTest({
      name: 'should change the current working directory with cd',
      fn: async ({ shellService }) => {
        const mockExecSync = mock(child_process.execSync);
        mockExecSync.mockReturnValue('' as any);

        const initialCwd = shellService.getCurrentWorkingDirectory();
        const parentDir = require('path').resolve(initialCwd, '..');

        const result = await shellService.executeCommand('cd ..');

        expect(result.exitCode).toBe(0);
        expect(shellService.getCurrentWorkingDirectory()).toBe(parentDir);
        expect(result.output).toContain('Changed directory to');

        // Change back to the original directory
        await shellService.executeCommand(`cd ${initialCwd}`);
        expect(shellService.getCurrentWorkingDirectory()).toBe(initialCwd);
      },
    })
  );

  filesystemOperationsSuite.addTest(
    createUnitTest({
      name: 'should handle invalid cd command',
      fn: async ({ shellService }) => {
        const mockExecSync = mock(child_process.execSync);
        const error = new Error('Command failed') as any;
        error.message = 'ENOENT: no such file or directory';
        error.status = 1;
        mockExecSync.mockImplementation(() => {
          throw error;
        });

        const initialCwd = shellService.getCurrentWorkingDirectory();
        const result = await shellService.executeCommand(
          'cd /nonexistent-directory-for-testing'
        );

        expect(result.exitCode).toBe(1);
        expect(result.error).toContain('Error changing directory');
        expect(shellService.getCurrentWorkingDirectory()).toBe(initialCwd);
      },
    })
  );

  filesystemOperationsSuite.addTest(
    createUnitTest({
      name: 'should record command history',
      fn: async ({ shellService }) => {
        const mockExecSync = mock(child_process.execSync);
        mockExecSync.mockReturnValueOnce('test1' as any);
        mockExecSync.mockReturnValueOnce('test2' as any);

        await shellService.executeCommand('echo test1');
        await shellService.executeCommand('echo test2');

        const history = shellService.getHistory(2);
        expect(history.length).toBe(2);
        expect(history[0].command).toBe('echo test1');
        expect(history[0].output).toBe('test1');
        expect(history[1].command).toBe('echo test2');
        expect(history[1].output).toBe('test2');
      },
    })
  );

  filesystemOperationsSuite.addTest(
    createUnitTest({
      name: 'should limit history to maxHistoryLength',
      fn: async ({ shellService }) => {
        const mockExecSync = mock(child_process.execSync);

        // Execute more than maxHistoryLength commands
        for (let i = 0; i < 110; i++) {
          mockExecSync.mockReturnValueOnce(`output${i}` as any);
          await shellService.executeCommand(`echo test${i}`);
        }

        const history = shellService.getHistory(200); // Request more than max
        expect(history.length).toBe(100); // Should be capped at maxHistoryLength
      },
    })
  );

  filesystemOperationsSuite.addTest(
    createUnitTest({
      name: 'should clear command history',
      fn: async ({ shellService }) => {
        const mockExecSync = mock(child_process.execSync);
        mockExecSync.mockReturnValue('test1' as any);

        await shellService.executeCommand('echo test1');
        shellService.clearHistory();
        const history = shellService.getHistory();
        expect(history.length).toBe(0);
      },
    })
  );

  filesystemOperationsSuite.addTest(
    createUnitTest({
      name: 'should track file operations',
      fn: async ({ shellService }) => {
        const mockExecSync = mock(child_process.execSync);
        mockExecSync.mockReturnValue('' as any);

        // Execute file operation commands
        await shellService.executeCommand('touch testfile.txt');
        await shellService.executeCommand('cat testfile.txt');
        await shellService.executeCommand('rm testfile.txt');

        const fileOps = shellService.getFileOperationHistory();
        expect(fileOps.length).toBeGreaterThan(0);

        const operations = fileOps.map((op: any) => op.operationType);
        expect(operations).toContain('write');
        expect(operations).toContain('read');
        expect(operations).toContain('delete');
      },
    })
  );

  filesystemOperationsSuite.addTest(
    createUnitTest({
      name: 'should handle complex file operations',
      fn: async ({ shellService }) => {
        // Create test files first
        await shellService.executeCommand('touch source.txt');
        await shellService.executeCommand('touch file1.txt');

        await shellService.executeCommand('mv source.txt dest.txt');
        await shellService.executeCommand('cp file1.txt file2.txt');

        const fileOps = shellService.getFileOperationHistory();
        const moveOp = fileOps.find((op: any) => op.operationType === 'move');
        const copyOp = fileOps.find((op: any) => op.operationType === 'copy');

        expect(moveOp).toBeDefined();
        expect(moveOp?.secondaryTarget).toBeDefined();
        expect(copyOp).toBeDefined();
        expect(copyOp?.secondaryTarget).toBeDefined();

        // Clean up
        await shellService.executeCommand('rm -f dest.txt file1.txt file2.txt');
      },
    })
  );

  filesystemOperationsSuite.run();
});

describe('ShellProvider', () => {
  const shellProviderSuite = new TestSuite('ShellProvider', {
    beforeEach: () => {
      const mockShellService = {
        getHistory: mock().mockReturnValue([
          {
            command: 'ls -la',
            output: 'total 64\ndrwxr-xr-x  10 user  staff   320 Dec  5 10:00 .',
            exitCode: 0,
            timestamp: Date.now() - 60000,
            cwd: '/home/user',
          },
          {
            command: 'echo test',
            output: 'test',
            error: '',
            exitCode: 0,
            timestamp: Date.now() - 30000,
            cwd: '/home/user',
          },
        ]),
        getCurrentWorkingDirectory: mock().mockReturnValue('/home/user'),
      } as unknown as ShellService;

      const mockRuntime = createMockRuntime({
        getService: mock().mockReturnValue(mockShellService),
      }) as any;

      const mockMemory = {
        id: '00000000-0000-0000-0000-000000000001',
        entityId: '00000000-0000-0000-0000-000000000002',
        content: { text: 'test' },
        agentId: '00000000-0000-0000-0000-000000000003',
        roomId: '00000000-0000-0000-0000-000000000004',
        createdAt: Date.now(),
      } as Memory;

      const mockState = {
        values: {},
        data: {},
        text: '',
      } as State;

      return { mockRuntime, mockShellService, mockMemory, mockState };
    },
  });

  shellProviderSuite.addTest(
    createUnitTest({
      name: 'should provide shell history and current directory',
      fn: async ({ mockRuntime, mockMemory, mockState }) => {
        const result = await shellProvider.get(
          mockRuntime,
          mockMemory,
          mockState
        );

        expect(result).toBeDefined();
        expect(result!.values).toBeDefined();
        expect(result!.data).toBeDefined();
        expect(result!.values!.currentWorkingDirectory).toBe('/home/user');
        expect(result!.values!.shellHistory).toContain('ls -la');
        expect(result!.values!.shellHistory).toContain('echo test');
        expect(result!.text).toContain('Current Directory: /home/user');
        expect(result!.data!.history).toHaveLength(2);
        expect(result!.data!.cwd).toBe('/home/user');
      },
    })
  );

  shellProviderSuite.addTest(
    createUnitTest({
      name: 'should handle missing shell service',
      fn: async ({ mockMemory, mockState }) => {
        const mockRuntime = createMockRuntime({
          getService: mock().mockReturnValue(null),
        }) as any;

        const result = await shellProvider.get(
          mockRuntime,
          mockMemory,
          mockState
        );

        expect(result).toBeDefined();
        expect(result!.values).toBeDefined();
        expect(result!.values!.shellHistory).toBe(
          'Shell service is not available.'
        );
        expect(result!.values!.currentWorkingDirectory).toBe('N/A');
        expect(result!.text).toContain('Shell service is not available.');
      },
    })
  );

  shellProviderSuite.addTest(
    createUnitTest({
      name: 'should truncate very long output',
      fn: async ({ mockMemory, mockState }) => {
        const longOutput = 'x'.repeat(10000);
        const mockShellService = {
          getHistory: mock().mockReturnValue([
            {
              command: 'cat largefile',
              output: longOutput,
              exitCode: 0,
              timestamp: Date.now(),
              cwd: '/home/user',
            },
          ]),
          getCurrentWorkingDirectory: mock().mockReturnValue('/home/user'),
        } as unknown as ShellService;

        const mockRuntime = createMockRuntime({
          getService: mock().mockReturnValue(mockShellService),
        }) as any;

        const result = await shellProvider.get(
          mockRuntime,
          mockMemory,
          mockState
        );

        expect(result).toBeDefined();
        expect(result!.values).toBeDefined();
        expect(result!.values!.shellHistory).toContain('[TRUNCATED]');
        expect(result!.values!.shellHistory.length).toBeLessThan(
          longOutput.length
        );
      },
    })
  );

  shellProviderSuite.run();
});

describe('Shell Actions', () => {
  const shellActionsSuite = new TestSuite('Shell Actions', {
    beforeEach: () => {
      const mockShellService = {
        executeCommand: mock().mockResolvedValue({
          output: 'command output',
          error: '',
          exitCode: 0,
          cwd: '/home/user',
        }),
        clearHistory: mock(),
        getHistory: mock().mockReturnValue([]),
        getCurrentWorkingDirectory: mock().mockReturnValue('/home/user'),
      } as unknown as ShellService;

      const mockRuntime = createMockRuntime({
        agentId: '00000000-0000-0000-0000-000000000001' as any,
        getService: mock().mockReturnValue(mockShellService),
        getSetting: mock().mockImplementation((key: string) => {
          if (key === 'ENABLE_SHELL' || key === 'SHELL_ENABLED') {
            return 'true';
          }
          return null;
        }),
        createMemory: mock(),
        composeState: mock().mockResolvedValue({
          values: {},
          data: {},
          text: 'test state',
        }),
        useModel: mock().mockResolvedValue(
          '<response><command>ls -la</command></response>'
        ),
      }) as any;

      const mockMemory = {
        id: '00000000-0000-0000-0000-000000000005',
        entityId: '00000000-0000-0000-0000-000000000006',
        content: { text: 'list files' },
        agentId: '00000000-0000-0000-0000-000000000007',
        roomId: '00000000-0000-0000-0000-000000000008',
        worldId: '00000000-0000-0000-0000-000000000009',
        createdAt: Date.now(),
      } as Memory;

      const mockState = {
        values: {},
        data: {},
        text: '',
      } as State;

      const mockCallback = mock();

      return {
        mockRuntime,
        mockShellService,
        mockMemory,
        mockState,
        mockCallback,
      };
    },
  });

  shellActionsSuite.addTest(
    createUnitTest({
      name: 'runShellCommandAction should validate when shell service is available',
      fn: async ({ mockRuntime, mockMemory, mockState }) => {
        const isValid = await runShellCommandAction.validate(
          mockRuntime,
          mockMemory,
          mockState
        );
        expect(isValid).toBe(true);
      },
    })
  );

  shellActionsSuite.addTest(
    createUnitTest({
      name: 'runShellCommandAction should not validate when shell service is unavailable',
      fn: async ({ mockMemory, mockState }) => {
        const mockRuntime = createMockRuntime({
          getService: mock().mockReturnValue(null),
        }) as any;
        const isValid = await runShellCommandAction.validate(
          mockRuntime,
          mockMemory,
          mockState
        );
        expect(isValid).toBe(false);
      },
    })
  );

  shellActionsSuite.addTest(
    createUnitTest({
      name: 'runShellCommandAction should execute command from options',
      fn: async ({
        mockRuntime,
        mockMemory,
        mockState,
        mockCallback,
        mockShellService,
      }) => {
        const result = await runShellCommandAction.handler(
          mockRuntime,
          mockMemory,
          mockState,
          { command: 'pwd' },
          mockCallback
        );

        expect(mockShellService.executeCommand).toHaveBeenCalledWith('pwd');
        expect(mockCallback).toHaveBeenCalledWith(
          expect.objectContaining({
            thought: expect.stringContaining('Analyzed output'),
            text: expect.any(String),
            attachments: expect.arrayContaining([
              expect.objectContaining({
                contentType: ContentType.DOCUMENT,
                text: expect.stringContaining('"command": "pwd"'),
              }),
            ]),
          })
        );
        expect(result).toBeDefined();
        expect((result as any).values.success).toBe(true);
        expect((result as any).data.command).toBe('pwd');
      },
    })
  );

  shellActionsSuite.addTest(
    createUnitTest({
      name: 'runShellCommandAction should extract command from natural language',
      fn: async ({
        mockRuntime,
        mockMemory,
        mockState,
        mockCallback,
        mockShellService,
      }) => {
        const result = await runShellCommandAction.handler(
          mockRuntime,
          mockMemory,
          mockState,
          {},
          mockCallback
        );

        expect(mockRuntime.useModel).toHaveBeenCalledWith(
          ModelType.TEXT_SMALL,
          expect.objectContaining({
            prompt: expect.stringContaining('extract'),
          })
        );
        expect(mockShellService.executeCommand).toHaveBeenCalledWith('ls -la');
        expect(result).toBeDefined();
        expect((result as any).values.success).toBe(true);
        expect((result as any).data.command).toBe('ls -la');
      },
    })
  );

  shellActionsSuite.addTest(
    createUnitTest({
      name: 'runShellCommandAction should handle direct shell commands',
      fn: async ({
        mockRuntime,
        mockMemory,
        mockState,
        mockCallback,
        mockShellService,
      }) => {
        mockMemory.content.text = 'ls -la';

        const result = await runShellCommandAction.handler(
          mockRuntime,
          mockMemory,
          mockState,
          {},
          mockCallback
        );

        expect(mockShellService.executeCommand).toHaveBeenCalledWith('ls -la');
        expect(result).toBeDefined();
        expect((result as any).values.success).toBe(true);
      },
    })
  );

  shellActionsSuite.addTest(
    createUnitTest({
      name: 'runShellCommandAction should quote wildcards for find and grep commands',
      fn: async ({
        mockRuntime,
        mockMemory,
        mockState,
        mockCallback,
        mockShellService,
      }) => {
        mockMemory.content.text = 'find . -name *.txt';

        const result = await runShellCommandAction.handler(
          mockRuntime,
          mockMemory,
          mockState,
          {},
          mockCallback
        );

        expect(mockShellService.executeCommand).toHaveBeenCalledWith(
          "find . -name '*.txt'"
        );
        expect(result).toBeDefined();
        expect((result as any).values.success).toBe(true);
      },
    })
  );

  shellActionsSuite.addTest(
    createUnitTest({
      name: 'runShellCommandAction should handle command execution errors',
      fn: async ({ mockMemory, mockState, mockCallback }) => {
        // This test intentionally causes an error to verify that the
        // action's error handling works correctly. The `ERROR` log that
        // may appear in the console is expected for this test case.
        const mockShellService = {
          executeCommand: mock().mockRejectedValue(new Error('Command failed')),
          clearHistory: mock(),
          getHistory: mock().mockReturnValue([]),
          getCurrentWorkingDirectory: mock().mockReturnValue('/home/user'),
        } as unknown as ShellService;

        const mockRuntime = createMockRuntime({
          agentId: '00000000-0000-0000-0000-000000000001' as any,
          getService: mock().mockReturnValue(mockShellService),
          createMemory: mock(),
          composeState: mock().mockResolvedValue({
            values: {},
            data: {},
            text: 'test state',
          }),
          useModel: mock().mockResolvedValue(
            '<response><command>ls -la</command></response>'
          ),
        }) as any;

        const result = await runShellCommandAction.handler(
          mockRuntime,
          mockMemory,
          mockState,
          { command: 'bad-command' },
          mockCallback
        );

        expect(mockCallback).toHaveBeenCalledWith(
          expect.objectContaining({
            thought: expect.stringContaining('unexpected error'),
            text: expect.stringContaining(
              'Error during shell command execution'
            ),
          })
        );
        expect(result).toBeDefined();
        expect((result as any).values.success).toBe(false);
        expect((result as any).values.error).toContain('Command failed');
      },
    })
  );
  shellActionsSuite.addTest(
    createUnitTest({
      name: 'clearShellHistoryAction should clear shell history',
      fn: async ({
        mockRuntime,
        mockMemory,
        mockState,
        mockCallback,
        mockShellService,
      }) => {
        const result = await clearShellHistoryAction.handler(
          mockRuntime,
          mockMemory,
          mockState,
          {},
          mockCallback
        );

        expect(mockShellService.clearHistory).toHaveBeenCalled();
        expect(mockCallback).toHaveBeenCalledWith(
          expect.objectContaining({
            thought: 'Shell history has been cleared successfully.',
            text: 'Shell command history has been cleared.',
          })
        );
        expect(result).toBeDefined();
        expect((result as any).values.success).toBe(true);
        expect((result as any).values.cleared).toBe(true);
      },
    })
  );

  shellActionsSuite.addTest(
    createUnitTest({
      name: 'clearShellHistoryAction should handle missing shell service',
      fn: async ({ mockMemory, mockState, mockCallback }) => {
        const mockRuntime = createMockRuntime({
          getService: mock().mockReturnValue(null),
        }) as any;

        const result = await clearShellHistoryAction.handler(
          mockRuntime,
          mockMemory,
          mockState,
          {},
          mockCallback
        );

        expect(mockCallback).toHaveBeenCalledWith(
          expect.objectContaining({
            thought: 'ShellService is not available. Cannot clear history.',
            text: 'I am currently unable to clear shell history.',
          })
        );
        expect(result).toBeDefined();
        expect((result as any).values.success).toBe(false);
        expect((result as any).values.error).toBe('ShellService not available');
      },
    })
  );

  shellActionsSuite.run();
});
