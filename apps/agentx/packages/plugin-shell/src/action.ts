// run shell command
import {
  type Action, // Added Action import
  type ActionResult,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  logger,
  ModelType,
  parseKeyValueXml, // Replace parseJSONObjectFromText with parseKeyValueXml
  composePromptFromState, // Add composePromptFromState
  createUniqueUuid, // Added createUniqueUuid
  type Media, // Added Media type
  ContentType, // Added ContentType import
} from '@elizaos/core';
import { type ShellService } from './service'; // Import ShellService

// XML template for command extraction
const commandExtractionTemplate = `You are an AI assistant that extracts shell commands from user messages.
The user might ask to run a command in natural language.
Your task is to identify the exact shell command to be executed.
For example:
User: "Can you list the files in the current directory?"
Command: "ls -la"
User: "Show me the running processes."
Command: "ps aux"
User: "Change directory to /tmp and then list files."
Command: "cd /tmp && ls -la"
User: "Run the script build.sh"
Command: "./build.sh"

{{providers}}

Extract the command to run.
Return ONLY the command as an XML object with a "command" key, like this:
<response>
  <command>your_extracted_command_here_or_null_if_none</command>
</response>
If no specific command can be confidently extracted, return null for the command value within the <command> tag.`;

// Helper function to extract command from natural language
async function extractCommandFromMessage(
  runtime: IAgentRuntime,
  message: Memory
): Promise<string | null> {
  const messageText = message.content.text;
  if (!messageText) {
    logger.warn('[extractCommandFromMessage] Message text is empty.');
    return null;
  }

  // LLM extraction logic remains here
  try {
    const state = await runtime.composeState(message, []);
    const prompt = composePromptFromState({
      state,
      template: commandExtractionTemplate,
    });

    const resultXml = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
    });

    if (!resultXml) {
      logger.warn('[extractCommandFromMessage] Model returned no result.');
      return null;
    }

    const parsedResult = parseKeyValueXml(resultXml);

    if (
      parsedResult &&
      parsedResult.command &&
      parsedResult.command !== 'null'
    ) {
      return parsedResult.command;
    }
    logger.info(
      '[extractCommandFromMessage] No command could be extracted or command was explicitly null.'
    );
    return null;
  } catch (error) {
    logger.error(
      '[extractCommandFromMessage] Error extracting command:',
      error
    );
    return null;
  }
}

// New helper function to quote arguments for shell commands like find and grep
function quoteShellArgs(command: string): string {
  if (!command) {
    return '';
  }

  const commandParts = command.split(' ');
  const commandName = commandParts[0];

  if (commandName !== 'find' && commandName !== 'grep') {
    return command; // Only apply special quoting for find and grep
  }

  return commandParts
    .map((part, index) => {
      if (index === 0) {
        return part;
      } // Don't quote the command itself
      if (part.startsWith('-')) {
        return part;
      } // Don't quote options

      // Check if part contains wildcards and is not already quoted
      const hasWildcard = ['*', '?', '[', ']'].some((char) =>
        part.includes(char)
      );
      const isQuoted =
        (part.startsWith("'") && part.endsWith("'")) ||
        (part.startsWith('"') && part.endsWith('"'));

      if (hasWildcard && !isQuoted) {
        // Escape single quotes within the part, then wrap the whole part in single quotes
        const escapedPart = part.replace(/'/g, "'\\''"); // Replaces ' with '\''
        return `'${escapedPart}'`;
      }
      return part;
    })
    .join(' ');
}

// Helper function to save execution record to message feed
async function saveExecutionRecord(
  runtime: IAgentRuntime,
  messageContext: Memory, // To get roomId, worldId
  thought: string,
  text: string,
  actions?: string[],
  attachments?: Media[] // Added attachments parameter
): Promise<void> {
  const memory: Memory = {
    id: createUniqueUuid(runtime, `shell-record-${Date.now()}`), // Ensure unique ID for these records
    content: {
      text,
      thought,
      actions: actions || ['RUN_SHELL_COMMAND_OUTCOME'],
      attachments, // Include attachments
    },
    entityId: createUniqueUuid(runtime, runtime.agentId), // This should likely be runtime.agentId if it's the agent's own record
    agentId: runtime.agentId,
    roomId: messageContext.roomId,
    worldId: messageContext.worldId,
    createdAt: Date.now(), // Add createdAt
  };
  await runtime.createMemory(memory, 'messages');
}

export const runShellCommandAction: Action = {
  name: 'RUN_SHELL_COMMAND',
  similes: ['EXECUTE_SHELL_COMMAND', 'TERMINAL_COMMAND', 'RUN_COMMAND'],
  description:
    'Executes a shell command on the host system and returns its output, error, and exit code. Handles `cd` to change current working directory for the session. Returns command details for chaining with other shell actions like CLEAR_SHELL_HISTORY.',
  validate: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State
  ): Promise<boolean> => {
    // Check if shell capability is enabled in runtime settings
    const shellEnabled =
      runtime.getSetting('ENABLE_SHELL') === 'true' ||
      runtime.getSetting('SHELL_ENABLED') === 'true';

    if (!shellEnabled) {
      logger.debug(
        '[runShellCommandAction] Shell capability disabled in settings.'
      );
      return false;
    }

    const shellService = runtime.getService<ShellService>('SHELL');
    if (!shellService) {
      logger.warn(
        '[runShellCommandAction] ShellService not available during validation.'
      );
      return false;
    }
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    options?: { command?: string },
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    const shellService = runtime.getService<ShellService>('SHELL');

    if (!shellService) {
      const thought = 'ShellService is not available. Cannot execute command.';
      const text = 'I am currently unable to run shell commands.';
      // No direct shell output to attach here, so save a simple record
      await saveExecutionRecord(runtime, message, thought, text);
      if (callback) {
        await callback({ thought, text });
      }
      return {
        data: {
          actionName: 'RUN_SHELL_COMMAND',
          error: 'ShellService not available',
        },
        values: {
          success: false,
          error: 'ShellService not available',
        },
        success: false,
      };
    }

    let commandToRun = options?.command;

    if (!commandToRun) {
      if (message.content.text) {
        const directCommand = message.content.text.trim();
        const commonShellCommands = [
          'ls',
          'cd',
          'pwd',
          'grep',
          'find',
          'cat',
          'echo',
          'mkdir',
          'rm',
          'mv',
          'cp',
          'chmod',
          'chown',
          'ssh',
          'scp',
          'git',
          'docker',
          'npm',
          'npx',
          'bun',
          'node',
          'python',
          'perl',
          'ruby',
          'bash',
          'zsh',
          'sh',
          // Windows commands
          'dir',
          'type',
          'copy',
          'move',
          'del',
          'erase',
          'md',
          'rd',
          'rmdir',
          'xcopy',
          'powershell',
          'cmd',
          'ipconfig',
          'ping',
          'tracert',
          'nslookup',
        ];
        const firstWord = directCommand.split(' ')[0];

        if (
          commonShellCommands.includes(firstWord) ||
          directCommand.startsWith('./') ||
          directCommand.startsWith('/') ||
          /^[a-zA-Z]:\\/.test(directCommand) // Windows absolute paths like C:\
        ) {
          commandToRun = directCommand;
        } else {
          commandToRun =
            (await extractCommandFromMessage(runtime, message)) ?? undefined;
        }
      } else if (
        Array.isArray(message.content.actions) &&
        message.content.actions.length > 1
      ) {
        commandToRun = message.content.actions[1];
      }
    }

    // Apply quoting for wildcards using the new helper function
    if (commandToRun) {
      commandToRun = quoteShellArgs(commandToRun);
    }

    if (!commandToRun) {
      const thought =
        'No command was provided or could be extracted from the message.';
      const text = 'What command would you like me to run?';
      await saveExecutionRecord(runtime, message, thought, text);
      if (callback) {
        await callback({ thought, text });
      }
      return {
        data: {
          actionName: 'RUN_SHELL_COMMAND',
          error: 'No command provided',
        },
        values: {
          success: false,
          error: 'No command provided',
        },
        success: false,
      };
    }

    logger.info(`[runShellCommandAction] Extracted command: ${commandToRun}`);

    try {
      const { output, error, exitCode, cwd } =
        await shellService.executeCommand(commandToRun);

      // 1. Package raw output as an attachment
      const attachmentId = createUniqueUuid(
        runtime,
        `shell-output-${Date.now()}`
      );
      const rawOutputData = {
        command: commandToRun, // Use the potentially quoted command
        exitCode,
        cwd,
        stdout: output,
        stderr: error,
      };

      const shellOutputAttachment: Media = {
        id: attachmentId,
        title: `Shell Output: ${commandToRun.substring(0, 50)}${commandToRun.length > 50 ? '...' : ''}`,
        contentType: ContentType.DOCUMENT, // Changed to ContentType.DOCUMENT
        text: JSON.stringify(rawOutputData, null, 2),
        source: 'shell-command-action',
        url: `elizaos://attachment/shell-output/${attachmentId}`, // More specific placeholder URL
      };

      // 2. Generate summary/reflection with LLM
      const summaryPromptTemplate = `The following shell command was executed:
Command: {{command}}
CWD: {{cwd}}
Exit Code: {{exitCode}}
{{#if stdout}}
STDOUT:
\`\`\`
{{stdout}}
\`\`\`
{{/if}}
{{#if stderr}}
STDERR:
\`\`\`
{{stderr}}
\`\`\`
{{/if}}

# Instructions:
Based on the command and its output:
1. Briefly summarize what happened or what was learned in the "text" field (max 2-3 sentences).
2. Provide your internal "thought" process for this summary.
3. If the command was successful and produced useful output, or if it failed in an informative way, mention that the full details are in an attachment. If the command was trivial (e.g., a simple 'cd' with no error) or the output was empty and uninformative, you don't need to mention the attachment.

Respond using XML format:
<response>
  <thought>Your internal thought process.</thought>
  <text>Your summary of the command outcome.</text>
</response>`;

      const summaryState = {
        command: commandToRun, // Use the potentially quoted command
        cwd,
        exitCode,
        stdout: output.substring(0, 300000), // Cap stdout for the prompt
        stderr: error?.substring(0, 300000), // Cap stderr for the prompt
      };

      const llmPrompt = composePromptFromState({
        state: { values: summaryState, data: {}, text: '' }, // Adapt to how composePromptFromState expects state
        template: summaryPromptTemplate,
      });

      const llmResponseXml = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: llmPrompt,
      });
      const parsedLlmResponse = parseKeyValueXml(llmResponseXml);

      const summaryThought =
        parsedLlmResponse?.thought ||
        `Analyzed output of command: ${commandToRun}`;
      let summaryText =
        parsedLlmResponse?.text || `Command "${commandToRun}" executed.`;

      // Conditionally mention the attachment
      const wasInformative =
        (output && output.trim() !== '') || (error && error.trim() !== '');
      if (wasInformative) {
        summaryText += ' (Full output stored as an attachment.)';
      }

      // 3. Create the main reflection/summary message
      await saveExecutionRecord(
        runtime,
        message,
        summaryThought,
        summaryText,
        ['RUN_SHELL_COMMAND_OUTCOME'], // Or a more specific action if needed
        [shellOutputAttachment] // Attach the shell output
      );

      // 4. Callback with the summary
      if (callback) {
        await callback({
          thought: summaryThought,
          text: summaryText,
          attachments: [shellOutputAttachment], // Also include in callback if frontend can use it
        });
      }

      return {
        data: {
          actionName: 'RUN_SHELL_COMMAND',
          command: commandToRun,
          exitCode,
          cwd,
          stdout: output,
          stderr: error,
          attachmentId,
        },
        values: {
          success: exitCode === 0,
          command: commandToRun,
          exitCode,
          cwd,
          outputLength: output?.length || 0,
          errorLength: error?.length || 0,
        },
        success: exitCode === 0,
      };
    } catch (e: any) {
      logger.error(
        '[runShellCommandAction] Error executing command or processing output:',
        e
      );
      const thought =
        'An unexpected error occurred while trying to execute or summarize the shell command.';
      const text = `Error during shell command execution: ${e.message}`;
      await saveExecutionRecord(runtime, message, thought, text);
      if (callback) {
        await callback({ thought, text });
      }
      return {
        data: {
          actionName: 'RUN_SHELL_COMMAND',
          error: e.message,
          command: message.content?.text || '',
        },
        values: {
          success: false,
          error: e.message,
        },
        success: false,
      };
    }
  },
  examples: [
    // Multi-action: Run command then clear history
    [
      {
        name: 'user',
        content: {
          text: 'Run a diagnostic command then clear the history for security',
        },
      },
      {
        name: 'agent',
        content: {
          text: "I'll run the diagnostic command and then clear the shell history for security.",
          actions: ['RUN_SHELL_COMMAND', 'CLEAR_SHELL_HISTORY'],
        },
      },
    ],
    // Multi-action: Check processes then kill autonomous
    [
      {
        name: 'user',
        content: {
          text: 'Show running processes and if autonomous is running, kill it',
        },
      },
      {
        name: 'agent',
        content: {
          text: "I'll check the running processes.",
          actions: ['RUN_SHELL_COMMAND'],
        },
      },
    ],
    [
      { name: 'user', content: { text: 'list files' } },
      {
        name: 'agent',
        content: {
          actions: ['RUN_SHELL_COMMAND_OUTCOME'], // This action is now the result of the summary
          thought:
            'The user wanted to list files. I ran `ls -la` and summarized the output.',
          text: 'Listed files in /Users/user/project. (Full output stored as an attachment.)',
          // attachments: [ { id: '...', title: 'Shell Output: ls -la', ...} ] // Example of what might be here
        },
      },
    ],
    [
      { name: 'user', content: { text: 'show me running processes' } },
      {
        name: 'agent',
        content: {
          actions: ['RUN_SHELL_COMMAND'],
        },
      },
    ],
    [
      { name: 'user', content: { text: 'cd to /tmp then list files' } },
      {
        name: 'agent',
        content: {
          actions: ['RUN_SHELL_COMMAND'],
        },
      },
    ],
  ],
};

export const clearShellHistoryAction: Action = {
  name: 'CLEAR_SHELL_HISTORY',
  similes: ['RESET_SHELL', 'CLEAR_TERMINAL'],
  description:
    'Clears the recorded history of shell commands for the current session. Often used after running sensitive commands or as part of security cleanup workflows.',
  validate: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State
  ): Promise<boolean> => {
    // Check if shell capability is enabled in runtime settings
    const shellEnabled =
      runtime.getSetting('ENABLE_SHELL') === 'true' ||
      runtime.getSetting('SHELL_ENABLED') === 'true';

    if (!shellEnabled) {
      logger.debug(
        '[clearShellHistoryAction] Shell capability disabled in settings.'
      );
      return false;
    }

    const shellService = runtime.getService<ShellService>('SHELL');
    return !!shellService;
  },
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    const shellService = runtime.getService<ShellService>('SHELL');
    if (!shellService) {
      if (callback) {
        await callback({
          thought: 'ShellService is not available. Cannot clear history.',
          text: 'I am currently unable to clear shell history.',
        });
      }
      return {
        data: {
          actionName: 'CLEAR_SHELL_HISTORY',
          error: 'ShellService not available',
        },
        values: {
          success: false,
          error: 'ShellService not available',
        },
        success: false,
      };
    }

    try {
      shellService.clearHistory();
      if (callback) {
        await callback({
          thought: 'Shell history has been cleared successfully.',
          text: 'Shell command history has been cleared.',
        });
      }
      return {
        data: {
          actionName: 'CLEAR_SHELL_HISTORY',
          historyCleared: true,
        },
        values: {
          success: true,
          cleared: true,
        },
        success: true,
      };
    } catch (e: any) {
      logger.error('[clearShellHistoryAction] Error clearing history:', e);
      if (callback) {
        await callback({
          thought:
            'An unexpected error occurred while trying to clear shell history.',
          text: `Error clearing shell history: ${e.message}`,
        });
      }
      return {
        data: {
          actionName: 'CLEAR_SHELL_HISTORY',
          error: e.message,
        },
        values: {
          success: false,
          error: e.message,
        },
        success: false,
      };
    }
  },
  examples: [
    // Multi-action: Run sensitive command then clear
    [
      {
        name: 'user',
        content: { text: 'Check environment variables then clear history' },
      },
      {
        name: 'agent',
        content: {
          text: "I'll check the environment variables and then clear the history to protect sensitive data.",
          actions: ['RUN_SHELL_COMMAND', 'CLEAR_SHELL_HISTORY'],
        },
      },
    ],
    [
      { name: 'user', content: { text: 'clear my shell history' } },
      {
        name: 'agent',
        content: {
          actions: ['CLEAR_SHELL_HISTORY'],
          thought:
            'The user wants to clear the shell history. I will call the clearHistory method.',
          text: 'Shell command history has been cleared.',
        },
      },
    ],
  ],
};
