import { 
  ModerationAPI,
  type ModerationConfig,
  type BanStatus,
  type ModeratorProfile,
  type ModerationCase,
  type Report,
  type AgentLabels,
  type ModerationStats,
  type TransactionRequest,
} from '../../../packages/shared/src/api/moderation';
import { type Address } from 'viem';
import { jeju } from '../config/chains';
import { RPC_URL, CONTRACTS } from '../config';

export type { BanStatus, ModeratorProfile, ModerationCase, Report, AgentLabels, ModerationStats, TransactionRequest };

// Bazaar-specific configuration from centralized config
const config: ModerationConfig = {
  chain: jeju,
  rpcUrl: RPC_URL,
  banManagerAddress: CONTRACTS.banManager || undefined,
  moderationMarketplaceAddress: CONTRACTS.moderationMarketplace || undefined,
  reportingSystemAddress: CONTRACTS.reportingSystem || undefined,
  reputationLabelManagerAddress: CONTRACTS.reputationLabelManager || undefined,
};

// Create singleton API instance
const moderationAPI = new ModerationAPI(config);

// Export API methods as standalone functions for backward compatibility
export const checkBanStatus = moderationAPI.checkBanStatus.bind(moderationAPI);
export const getModeratorStats = moderationAPI.getModeratorProfile.bind(moderationAPI);
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
