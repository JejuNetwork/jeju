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

import type { Plugin } from "@elizaos/core";
import { getNetworkName } from "@jejunetwork/config";

// Core Actions
import { rentGpuAction } from "./actions/compute";
import { runInferenceAction } from "./actions/inference";
import { createTriggerAction } from "./actions/triggers";
import { uploadFileAction, retrieveFileAction } from "./actions/storage";
import { swapTokensAction, addLiquidityAction } from "./actions/defi";
import { createProposalAction, voteAction } from "./actions/governance";
import { registerNameAction, resolveNameAction } from "./actions/names";
import { registerAgentAction } from "./actions/identity";
import { crossChainTransferAction } from "./actions/crosschain";
import { checkBalanceAction } from "./actions/payments";

// Extended Actions - A2A
import { callAgentAction, discoverAgentsAction } from "./actions/a2a";

// Extended Actions - OIF Intents
import {
  createIntentAction,
  trackIntentAction,
  listSolversAction,
  listRoutesAction,
} from "./actions/intents";

// Extended Actions - XLP Pools
import {
  listPoolsAction,
  getPoolStatsAction,
  myPositionsAction,
} from "./actions/pools";

// Extended Actions - Compute Rentals
import {
  listMyRentalsAction,
  getSshAccessAction,
  listProvidersAction,
  listModelsAction,
} from "./actions/rentals";

// Extended Actions - Storage
import {
  pinCidAction,
  listPinsAction,
  getStorageStatsAction,
  unpinAction,
  estimateStorageCostAction,
} from "./actions/storage-extended";

// Extended Actions - Bazaar
import {
  launchTokenAction,
  listNftsAction,
  listNamesForSaleAction,
} from "./actions/bazaar";

// Extended Actions - Moderation
import { reportAgentAction, listModerationCasesAction } from "./actions/moderation";

// Extended Actions - Nodes
import { listNodesAction, getNodeStatsAction } from "./actions/nodes";

// Extended Actions - Games (Babylon/Hyperscape)
import {
  getPlayerInfoAction,
  getGoldBalanceAction,
  transferGoldAction,
  getItemBalanceAction,
  transferItemAction,
  linkAgentAction,
  getGameStatsAction,
} from "./actions/games";

// Extended Actions - Containers (OCI Registry)
import {
  createRepoAction,
  getRepoInfoAction,
  listMyReposAction,
  getManifestAction,
  starRepoAction,
  grantAccessAction,
} from "./actions/containers";

// Extended Actions - Launchpad
import {
  createTokenAction,
  createPresaleAction,
  contributePresaleAction,
  listPresalesAction,
  createBondingCurveAction,
  buyFromCurveAction,
  sellToCurveAction,
  listCurvesAction,
  lockLPAction,
} from "./actions/launchpad";

// Providers
import { jejuWalletProvider } from "./providers/wallet";
import { jejuComputeProvider } from "./providers/compute";
import { jejuDefiProvider } from "./providers/defi";

// Service
import { JejuService } from "./service";

const networkName = getNetworkName().toLowerCase();

export const jejuPlugin: Plugin = {
  name: networkName,
  description: `${getNetworkName()} plugin - full protocol access: compute, storage, DeFi, governance, cross-chain, A2A, MCP`,

  providers: [jejuWalletProvider, jejuComputeProvider, jejuDefiProvider],

  evaluators: [],

  services: [JejuService],

  actions: [
    // === Core Compute ===
    rentGpuAction,
    runInferenceAction,
    createTriggerAction,
    listProvidersAction,
    listModelsAction,
    listMyRentalsAction,
    getSshAccessAction,

    // === Storage ===
    uploadFileAction,
    retrieveFileAction,
    pinCidAction,
    listPinsAction,
    unpinAction,
    getStorageStatsAction,
    estimateStorageCostAction,

    // === DeFi ===
    swapTokensAction,
    addLiquidityAction,
    listPoolsAction,
    getPoolStatsAction,
    myPositionsAction,

    // === Governance ===
    createProposalAction,
    voteAction,

    // === Names (JNS) ===
    registerNameAction,
    resolveNameAction,

    // === Identity ===
    registerAgentAction,

    // === Cross-chain (OIF) ===
    crossChainTransferAction,
    createIntentAction,
    trackIntentAction,
    listSolversAction,
    listRoutesAction,

    // === Payments ===
    checkBalanceAction,

    // === Bazaar ===
    launchTokenAction,
    listNftsAction,
    listNamesForSaleAction,

    // === Moderation ===
    reportAgentAction,
    listModerationCasesAction,

    // === Infrastructure ===
    listNodesAction,
    getNodeStatsAction,

    // === A2A Protocol ===
    callAgentAction,
    discoverAgentsAction,

    // === Games (Babylon/Hyperscape) ===
    getPlayerInfoAction,
    getGoldBalanceAction,
    transferGoldAction,
    getItemBalanceAction,
    transferItemAction,
    linkAgentAction,
    getGameStatsAction,

    // === Containers (OCI Registry) ===
    createRepoAction,
    getRepoInfoAction,
    listMyReposAction,
    getManifestAction,
    starRepoAction,
    grantAccessAction,

    // === Launchpad ===
    createTokenAction,
    createPresaleAction,
    contributePresaleAction,
    listPresalesAction,
    createBondingCurveAction,
    buyFromCurveAction,
    sellToCurveAction,
    listCurvesAction,
    lockLPAction,
  ],
};

export default jejuPlugin;

// Re-export SDK for direct use
export {
  createJejuClient,
  type JejuClient,
  type JejuClientConfig,
} from "@jejunetwork/sdk";

// Re-export service
export { JejuService } from "./service";
