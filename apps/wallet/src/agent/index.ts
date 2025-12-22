/**
 * Network Wallet Agent - ElizaOS Project Definition
 *
 * This exports the wallet as an ElizaOS Project that can be started
 * with the ElizaOS server or integrated into other ElizaOS agents.
 */

import type { IAgentRuntime, Project, ProjectAgent } from '@elizaos/core'
import { jejuWalletCharacter } from '../character'
import { jejuWalletPlugin } from '../plugin/eliza-plugin'

/**
 * Initialize the wallet agent with runtime context
 */
const initWalletAgent = async ({ runtime }: { runtime: IAgentRuntime }) => {
  // Set wallet-specific settings from environment
  const envWalletAddress = process.env.WALLET_ADDRESS
  const settingWalletAddress = runtime.getSetting('WALLET_ADDRESS')

  // Use environment variable first, then runtime setting (only if it's a string)
  const walletAddress =
    envWalletAddress ||
    (typeof settingWalletAddress === 'string' ? settingWalletAddress : null)

  if (walletAddress) {
    runtime.setSetting('WALLET_ADDRESS', walletAddress)
  }
}

/**
 * Network Wallet Project Agent
 *
 * Can be imported and used in other ElizaOS projects:
 *
 * ```typescript
 * import { walletAgent } from '@jejunetwork/wallet';
 *
 * const project: Project = {
 *   agents: [walletAgent, ...otherAgents],
 * };
 * ```
 */
export const walletAgent: ProjectAgent = {
  character: jejuWalletCharacter,
  init: async (runtime: IAgentRuntime) => initWalletAgent({ runtime }),
  plugins: [jejuWalletPlugin],
}

/**
 * Network Wallet Project
 *
 * Standalone project export for running the wallet agent directly.
 */
export const walletProject: Project = {
  agents: [walletAgent],
}

export default walletProject
