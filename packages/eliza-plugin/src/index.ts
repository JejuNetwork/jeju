/**
 * Network ElizaOS Plugin
 *
 * Infrastructure for AI agents.
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
// Extended Actions - Alerts
import { postAlertAction } from './actions/alert'
// Extended Actions - Contract Fetching & Analysis
import { analyzeContractAction } from './actions/analyze-contract'
import { auditContractAction } from './actions/audit-contract'
// Extended Actions - Bazaar
import {
  launchTokenAction,
  listNamesForSaleAction,
  listNftsAction,
} from './actions/bazaar'
import { pollBlockscoutAction } from './actions/blockscout'
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
import { fetchContractAction } from './actions/contract'
import { crossChainTransferAction } from './actions/crosschain'
import { addLiquidityAction, swapTokensAction } from './actions/defi'
import { createProposalAction, voteAction } from './actions/governance'
import { registerAgentAction } from './actions/identity'
import { runInferenceAction } from './actions/inference'
import {
  analyzeInfraHealthAction,
  collectNodeStatsAction,
} from './actions/infra'
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
import { probeEndpointsAction } from './actions/probe'
// Extended Actions - Compute Rentals
import {
  getSshAccessAction,
  listModelsAction,
  listMyRentalsAction,
  listProvidersAction,
} from './actions/rentals'
// Extended Actions - Security (Blue Team)
import {
  analyzeTransactionAction,
  checkScamAddressAction,
  scanContractAction,
} from './actions/security'
import { retrieveFileAction, uploadFileAction } from './actions/storage'
// Extended Actions - Storage
import {
  estimateStorageCostAction,
  getStorageStatsAction,
  listPinsAction,
  pinCidAction,
  unpinAction,
} from './actions/storage-extended'
// Extended Actions - Training (DWS/Psyche)
import {
  checkTrainingStatus,
  startTrainingJob,
  submitTrajectory,
} from './actions/training'
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
    rentGpuAction,
    runInferenceAction,
    createTriggerAction,
    listProvidersAction,
    listModelsAction,
    listMyRentalsAction,
    getSshAccessAction,

    uploadFileAction,
    retrieveFileAction,
    pinCidAction,
    listPinsAction,
    unpinAction,
    getStorageStatsAction,
    estimateStorageCostAction,

    swapTokensAction,
    addLiquidityAction,
    listPoolsAction,
    getPoolStatsAction,
    myPositionsAction,

    createProposalAction,
    voteAction,

    registerNameAction,
    resolveNameAction,

    registerAgentAction,

    crossChainTransferAction,
    createIntentAction,
    trackIntentAction,
    listSolversAction,
    listRoutesAction,

    checkBalanceAction,

    launchTokenAction,
    listNftsAction,
    listNamesForSaleAction,

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

    listNodesAction,
    getNodeStatsAction,

    callAgentAction,
    discoverAgentsAction,

    createRepoAction,
    getRepoInfoAction,
    listMyReposAction,
    getManifestAction,
    starRepoAction,
    grantAccessAction,

    createTokenAction,
    createPresaleAction,
    contributePresaleAction,
    listPresalesAction,
    createBondingCurveAction,
    buyFromCurveAction,
    sellToCurveAction,
    listCurvesAction,
    lockLPAction,

    submitTrajectory,
    checkTrainingStatus,
    startTrainingJob,

    // Security actions for Blue Team
    analyzeTransactionAction,
    scanContractAction,
    checkScamAddressAction,
    fetchContractAction,
    analyzeContractAction,
    auditContractAction,
    pollBlockscoutAction,

    // Infrastructure monitoring actions
    collectNodeStatsAction,
    analyzeInfraHealthAction,
    probeEndpointsAction,

    // Alert actions
    postAlertAction,
  ],
}

export default jejuPlugin

// SQLit Database Plugin - decentralized database for ElizaOS agents
export {
  checkMigrationStatus,
  runSQLitMigrations,
  SQLIT_SCHEMA,
  SQLitDatabaseAdapter,
  sqlitDatabasePlugin,
} from './db'

export {
  getJejuService,
  initJejuService,
  JEJU_SERVICE_NAME,
  JejuService,
  type StandaloneConfig,
  StandaloneJejuService,
} from './service'
