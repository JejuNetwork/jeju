/**
 * Network ElizaOS Plugin
 *
 * Fully decentralized infrastructure for AI agents.
 * Agents only need a funded wallet to access all network services.
 *
 * @example
 * ```ts
 * import { networkPlugin } from '@jejunetwork/eliza-plugin';
 *
 * const agent = new Agent({
 *   plugins: [networkPlugin],
 *   settings: {
 *     NETWORK_PRIVATE_KEY: '0x...',
 *     NETWORK_TYPE: 'testnet',
 *   },
 * });
 * ```
 */

import type { Plugin } from '@elizaos/core';
import { getNetworkName, getNetworkDescription } from '@jejunetwork/config';

// Actions
import { rentGpuAction } from './actions/compute';
import { runInferenceAction } from './actions/inference';
import { createTriggerAction } from './actions/triggers';
import { uploadFileAction, retrieveFileAction } from './actions/storage';
import { swapTokensAction, addLiquidityAction } from './actions/defi';
import { createProposalAction, voteAction } from './actions/governance';
import { registerNameAction, resolveNameAction } from './actions/names';
import { registerAgentAction } from './actions/identity';
import { crossChainTransferAction } from './actions/crosschain';
import { checkBalanceAction } from './actions/payments';

// Providers
import { jejuWalletProvider } from './providers/wallet';
import { jejuComputeProvider } from './providers/compute';
import { jejuDefiProvider } from './providers/defi';

// Service
import { JejuService } from './service';

const networkName = getNetworkName().toLowerCase();

export const jejuPlugin: Plugin = {
  name: networkName,
  description: `${getNetworkName()} plugin - decentralized compute, storage, DeFi, governance, cross-chain`,

  providers: [jejuWalletProvider, jejuComputeProvider, jejuDefiProvider],

  evaluators: [],

  services: [JejuService],

  actions: [
    // Compute
    rentGpuAction,
    runInferenceAction,
    createTriggerAction,

    // Storage
    uploadFileAction,
    retrieveFileAction,

    // DeFi
    swapTokensAction,
    addLiquidityAction,

    // Governance
    createProposalAction,
    voteAction,

    // Names
    registerNameAction,
    resolveNameAction,

    // Identity
    registerAgentAction,

    // Cross-chain
    crossChainTransferAction,

    // Payments
    checkBalanceAction,
  ],
};

export default jejuPlugin;

// Re-export SDK for direct use
export { createJejuClient, type JejuClient, type JejuClientConfig } from '@jejunetwork/sdk';

// Re-export service
export { JejuService } from './service';

