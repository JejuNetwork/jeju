import type { Address } from 'viem'
import {
  type AgentLabels,
  type BanStatus,
  ModerationAPI,
  type ModerationCase,
  type ModerationConfig,
  type ModerationStats,
  type ModeratorProfile,
  type Report,
  type TransactionRequest,
} from '../../../packages/shared/src/api/moderation'
import { CONTRACTS, RPC_URL } from '../config'
import { jeju } from '../config/chains'

export type {
  BanStatus,
  ModeratorProfile,
  ModerationCase,
  Report,
  AgentLabels,
  ModerationStats,
  TransactionRequest,
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

/** Convert zero address to undefined for optional contract addresses */
function toOptionalAddress(addr: Address): Address | undefined {
  return addr === ZERO_ADDRESS ? undefined : addr
}

// Bazaar-specific configuration from centralized config
const config: ModerationConfig = {
  chain: jeju,
  rpcUrl: RPC_URL,
  banManagerAddress: toOptionalAddress(CONTRACTS.banManager),
  moderationMarketplaceAddress: toOptionalAddress(
    CONTRACTS.moderationMarketplace,
  ),
  reportingSystemAddress: toOptionalAddress(CONTRACTS.reportingSystem),
  reputationLabelManagerAddress: toOptionalAddress(
    CONTRACTS.reputationLabelManager,
  ),
}

const moderationAPI = new ModerationAPI(config)

export const checkBanStatus = moderationAPI.checkBanStatus.bind(moderationAPI)
export const getModeratorStats =
  moderationAPI.getModeratorProfile.bind(moderationAPI)
export const getModerationCases =
  moderationAPI.getModerationCases.bind(moderationAPI)
export const getModerationCase =
  moderationAPI.getModerationCase.bind(moderationAPI)
export const getReports = moderationAPI.getReports.bind(moderationAPI)
export const getAgentLabels = moderationAPI.getAgentLabels.bind(moderationAPI)
export const getModerationStats =
  moderationAPI.getModerationStats.bind(moderationAPI)

// Transaction preparation
export const prepareStakeTransaction =
  moderationAPI.prepareStake.bind(moderationAPI)
export const prepareReportTransaction =
  moderationAPI.prepareReport.bind(moderationAPI)
export const prepareVoteTransaction =
  moderationAPI.prepareVote.bind(moderationAPI)
export const prepareChallengeTransaction =
  moderationAPI.prepareChallenge.bind(moderationAPI)
