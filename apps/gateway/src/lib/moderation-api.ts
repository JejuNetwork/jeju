import { 
  createModerationAPI, 
  type ModerationConfig,
  type ModerationBanStatus as BanStatus,
  type ModeratorProfile,
  type ModerationCase,
  type Report,
  type AgentLabels,
  type ModerationStats,
  type TransactionRequest,
} from '@jeju/shared';
import { baseSepolia } from 'viem/chains';
import { getRpcUrl } from '../config/networks.js';
import { 
  BAN_MANAGER_ADDRESS, 
  MODERATION_MARKETPLACE_ADDRESS, 
  REPORTING_SYSTEM_ADDRESS, 
  REPUTATION_LABEL_MANAGER_ADDRESS 
} from '../config/contracts.js';

export type { BanStatus, ModeratorProfile, ModerationCase, Report, AgentLabels, ModerationStats, TransactionRequest };

// Gateway configuration from centralized config
const config: ModerationConfig = {
  chain: baseSepolia,
  rpcUrl: getRpcUrl(84532), // Base Sepolia for moderation contracts
  banManagerAddress: BAN_MANAGER_ADDRESS,
  moderationMarketplaceAddress: MODERATION_MARKETPLACE_ADDRESS,
  reportingSystemAddress: REPORTING_SYSTEM_ADDRESS,
  reputationLabelManagerAddress: REPUTATION_LABEL_MANAGER_ADDRESS,
};

// Create singleton API instance
const moderationAPI = createModerationAPI(config);

// Export API methods as standalone functions
export const checkBanStatus = moderationAPI.checkBanStatus.bind(moderationAPI);
export const getModeratorProfile = moderationAPI.getModeratorProfile.bind(moderationAPI);
export const getModerationCases = moderationAPI.getModerationCases.bind(moderationAPI);
export const getModerationCase = moderationAPI.getModerationCase.bind(moderationAPI);
export const getReports = moderationAPI.getReports.bind(moderationAPI);
export const getAgentLabels = moderationAPI.getAgentLabels.bind(moderationAPI);
export const getModerationStats = moderationAPI.getModerationStats.bind(moderationAPI);

// Transaction preparation
export const prepareStakeTransaction = moderationAPI.prepareStake.bind(moderationAPI);
export const prepareReportTransaction = moderationAPI.prepareReport.bind(moderationAPI);
export const prepareVoteTransaction = moderationAPI.prepareVote.bind(moderationAPI);
export const prepareChallengeTransaction = moderationAPI.prepareChallenge.bind(moderationAPI);
export const prepareAppealTransaction = moderationAPI.prepareAppeal.bind(moderationAPI);
