// The terminal provider should provide the terminal history for the current active terminal session
// Get the current state from the service and format as text
import {
  type IAgentRuntime,
  type Memory,
  type Provider,
  type State,
  addHeader,
  logger,
} from '@elizaos/core';
import { type ShellService } from './service'; // Import ShellService

const MAX_INDIVIDUAL_OUTPUT_LENGTH = 8000; // Max length before truncating
const TRUNCATE_SEGMENT_LENGTH = 4000; // Length of head/tail segments

export const shellProvider: Provider = {
  name: 'SHELL_HISTORY',
  description:
    'Provides the recent shell command history and current working directory. Assumes ShellService manages overall history length and summarization.',
  position: 99, // Position it appropriately
  get: async (runtime: IAgentRuntime, _message: Memory, _state: State) => {
    const shellService = runtime.getService<ShellService>('SHELL');

    if (!shellService) {
      logger.warn('[shellProvider] ShellService not found.');
      return {
        values: {
          shellHistory: 'Shell service is not available.',
          currentWorkingDirectory: 'N/A',
        },
        text: addHeader('# Shell Status', 'Shell service is not available.'),
        data: { history: [], cwd: 'N/A' },
      };
    }

    // Assuming ShellService.getHistory() returns all relevant (potentially summarized by service) history
    // And that ShellService itself handles the 100k char limit and summarization (e.g. keeping last 3 turns).
    const history = shellService.getHistory();
    const cwd = shellService.getCurrentWorkingDirectory();

    let historyText = 'No commands in history.';
    if (history.length > 0) {
      historyText = history
        .map((entry) => {
          let entryStr = `[${new Date(entry.timestamp).toISOString()}] ${entry.cwd}> ${entry.command}`;

          if (entry.output) {
            if (entry.output.length > MAX_INDIVIDUAL_OUTPUT_LENGTH) {
              entryStr += `\n  Output: ${entry.output.substring(0, TRUNCATE_SEGMENT_LENGTH)}\n  ... [TRUNCATED] ...\n  ${entry.output.substring(entry.output.length - TRUNCATE_SEGMENT_LENGTH)}`;
            } else {
              entryStr += `\n  Output: ${entry.output}`;
            }
          }

          if (entry.error) {
            if (entry.error.length > MAX_INDIVIDUAL_OUTPUT_LENGTH) {
              entryStr += `\n  Error: ${entry.error.substring(0, TRUNCATE_SEGMENT_LENGTH)}\n  ... [TRUNCATED] ...\n  ${entry.error.substring(entry.error.length - TRUNCATE_SEGMENT_LENGTH)}`;
            } else {
              entryStr += `\n  Error: ${entry.error}`;
            }
          }
          entryStr += `\n  Exit Code: ${entry.exitCode}`;
          return entryStr;
        })
        .join('\n\n');
    }

    const text = `Current Directory: ${cwd}\n\n${addHeader('# Shell History', historyText)}`; // Removed "(Last 5)"

    return {
      values: {
        shellHistory: historyText, // This text can be very long.
        currentWorkingDirectory: cwd,
      },
      text, // This text is passed to the LLM, ensure it's appropriately sized or summarized by ShellService.
      data: {
        // Raw data, not truncated for display here, but source output/error might be huge.
        history,
        cwd,
      },
    };
  },
};
