/**
 * Network Wallet Agent - ElizaOS Project Definition
 * 
 * This exports the wallet as an ElizaOS Project that can be started
 * with the ElizaOS server or integrated into other ElizaOS agents.
 */

import type { IAgentRuntime, Project, ProjectAgent } from '@elizaos/core';
import { jejuWalletCharacter } from '../character';
import { jejuWalletPlugin } from '../plugin/eliza-plugin';

/**
 * Initialize the wallet agent with runtime context
 */
const initWalletAgent = async ({ runtime }: { runtime: IAgentRuntime }) => {
  console.log('[JejuWallet] Initializing agent');
  console.log('[JejuWallet] Character:', jejuWalletCharacter.name);
  
  // Set wallet-specific settings from environment
  const walletAddress = process.env.WALLET_ADDRESS || runtime.getSetting('WALLET_ADDRESS');
  if (walletAddress) {
    console.log('[JejuWallet] Wallet address configured:', walletAddress);
  }
};

/**
 * Network Wallet Project Agent
 * 
 * Can be imported and used in other ElizaOS projects:
 * 
 * ```typescript
 * import { walletAgent } from '@jeju/wallet/agent';
 * 
 * const project: Project = {
 *   agents: [walletAgent, ...otherAgents],
 * };
 * ```
 */
export const walletAgent: ProjectAgent = {
  character: jejuWalletCharacter,
  init: async (runtime: IAgentRuntime) => initWalletAgent({ runtime }),
  plugins: [
    jejuWalletPlugin,
    // Future: Add more plugins here
    // evmPlugin,
    // sqlPlugin,
  ],
};

/**
 * Network Wallet Project
 * 
 * Standalone project export for running the wallet agent directly.
 */
export const walletProject: Project = {
  agents: [walletAgent],
};

// Re-export for convenience
export { jejuWalletCharacter } from '../character';
export { jejuWalletPlugin } from '../plugin/eliza-plugin';

export default walletProject;
