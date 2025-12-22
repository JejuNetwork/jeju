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

import type { Plugin } from '@elizaos/core'
import { getNetworkName } from '@jejunetwork/config'
// Extended Actions - A2A
import { callAgentAction, discoverAgentsAction } from './actions/a2a'
// Extended Actions - Bazaar
import {
  launchTokenAction,
  listNamesForSaleAction,
  listNftsAction,
} from './actions/bazaar'
// Core Actions
import { rentGpuAction } from './actions/compute'
// Extended Actions - Containers (OCI Registry)
import {
  createRepoAction,
  getManifestAction,
  getRepoInfoAction,
  grantAccessAction,
  listMyReposAction,
  starRepoAction,
} from './actions/containers'
import { crossChainTransferAction } from './actions/crosschain'
import { addLiquidityAction, swapTokensAction } from './actions/defi'
// Extended Actions - Games (Babylon/Hyperscape)
import {
  getGameStatsAction,
  getGoldBalanceAction,
  getItemBalanceAction,
  getPlayerInfoAction,
  linkAgentAction,
  transferGoldAction,
  transferItemAction,
} from './actions/games'
import { createProposalAction, voteAction } from './actions/governance'
import { registerAgentAction } from './actions/identity'
import { runInferenceAction } from './actions/inference'
// Extended Actions - OIF Intents
import {
  createIntentAction,
  listRoutesAction,
  listSolversAction,
  trackIntentAction,
} from './actions/intents'
// Extended Actions - Launchpad
import {
  buyFromCurveAction,
  contributePresaleAction,
  createBondingCurveAction,
  createPresaleAction,
  createTokenAction,
  listCurvesAction,
  listPresalesAction,
  lockLPAction,
  sellToCurveAction,
} from './actions/launchpad'
// Extended Actions - Moderation (basic)
import { reportAgentAction } from './actions/moderation'
// Extended Actions - Moderation (full)
import {
  appealCaseAction,
  checkTrustAction,
  claimEvidenceRewardAction,
  createCaseAction,
  getCaseAction,
  getEvidenceAction,
  getLabelsAction,
  issueLabelAction,
  listCaseEvidenceAction,
  listCasesAction,
  submitEvidenceAction,
  supportEvidenceAction,
} from './actions/moderation-full'
import { registerNameAction, resolveNameAction } from './actions/names'
// Extended Actions - Nodes
import { getNodeStatsAction, listNodesAction } from './actions/nodes'
import { checkBalanceAction } from './actions/payments'
// Extended Actions - XLP Pools
import {
  getPoolStatsAction,
  listPoolsAction,
  myPositionsAction,
} from './actions/pools'
// Extended Actions - Compute Rentals
import {
  getSshAccessAction,
  listModelsAction,
  listMyRentalsAction,
  listProvidersAction,
} from './actions/rentals'
import { retrieveFileAction, uploadFileAction } from './actions/storage'
// Extended Actions - Storage
import {
  estimateStorageCostAction,
  getStorageStatsAction,
  listPinsAction,
  pinCidAction,
  unpinAction,
} from './actions/storage-extended'
import { createTriggerAction } from './actions/triggers'
// Extended Actions - Work (Bounties/Projects)
import {
  approveSubmissionAction,
  claimBountyAction,
  createBountyAction,
  createProjectAction,
  createTaskAction,
  getTasksAction,
  listBountiesAction,
  listGuardiansAction,
  listProjectsAction,
  registerGuardianAction,
  rejectSubmissionAction,
  submitWorkAction,
} from './actions/work'
import { jejuComputeProvider } from './providers/compute'
import { jejuDefiProvider } from './providers/defi'
// Providers
import { jejuWalletProvider } from './providers/wallet'

// Service
import { JejuService } from './service'

const networkName = getNetworkName().toLowerCase()

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
    submitEvidenceAction,
    supportEvidenceAction,
    getEvidenceAction,
    listCaseEvidenceAction,
    claimEvidenceRewardAction,
    createCaseAction,
    getCaseAction,
    listCasesAction, // LIST_MODERATION_CASES
    appealCaseAction,
    issueLabelAction,
    getLabelsAction,
    checkTrustAction,

    // === Work (Bounties/Projects) ===
    createBountyAction,
    listBountiesAction,
    claimBountyAction,
    submitWorkAction,
    approveSubmissionAction,
    rejectSubmissionAction,
    createProjectAction,
    listProjectsAction,
    createTaskAction,
    getTasksAction,
    registerGuardianAction,
    listGuardiansAction,

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
}

export default jejuPlugin

export { JejuService } from './service'
