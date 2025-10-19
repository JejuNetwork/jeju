import { type Plugin } from '@elizaos/core';
import { runShellCommandAction, clearShellHistoryAction } from './action';
import { shellProvider } from './provider';
import { ShellService } from './service';
import './types'; // Ensure module augmentation is loaded

export const shellPlugin: Plugin = {
  name: 'plugin-shell',
  description:
    'Provides shell access to the agent, allowing it to run commands and view history.',
  actions: [runShellCommandAction, clearShellHistoryAction],
  providers: [shellProvider],
  services: [ShellService],
};

export default shellPlugin;
