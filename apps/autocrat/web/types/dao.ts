/**
 * Autocrat DAO Types - Frontend types for DAO management
 *
 * Extended types for the DAO-centric UI including agent connectors,
 * context configuration, and enhanced persona management.
 */

import type { Address } from 'viem'

// Agent connector types for external integrations
export type ConnectorType =
  | 'farcaster'
  | 'github'
  | 'discord'
  | 'telegram'
  | 'twitter'

export interface FarcasterConnectorConfig {
  channelUrl: string
  fid: number
  autoPost: boolean
  monitorMentions: boolean
  postDecisions: boolean
  postProposals: boolean
}

export interface GitHubConnectorConfig {
  repoUrl: string
  webhookEnabled: boolean
  autoReviewPRs: boolean
  autoLabelIssues: boolean
}

export interface DiscordConnectorConfig {
  serverId: string
  channelId: string
  botToken: string
  postAnnouncements: boolean
}

export interface TelegramConnectorConfig {
  chatId: string
  botToken: string
  postAnnouncements: boolean
}

export interface TwitterConnectorConfig {
  handle: string
  autoPost: boolean
  monitorMentions: boolean
}

export type ConnectorConfig =
  | FarcasterConnectorConfig
  | GitHubConnectorConfig
  | DiscordConnectorConfig
  | TelegramConnectorConfig
  | TwitterConnectorConfig

export interface AgentConnector {
  id: string
  type: ConnectorType
  enabled: boolean
  config: ConnectorConfig
  lastSync: number
  status: 'active' | 'error' | 'disconnected'
  errorMessage?: string
}

// Agent context/knowledge configuration
export interface AgentContext {
  knowledgeCids: string[]
  linkedRepos: string[]
  linkedPackages: string[]
  customInstructions: string
  maxContextTokens: number
}

// Agent role types
export type AgentRole =
  | 'CEO'
  | 'TREASURY'
  | 'CODE'
  | 'COMMUNITY'
  | 'SECURITY'
  | 'LEGAL'
  | 'CUSTOM'

export type CommunicationTone =
  | 'formal'
  | 'friendly'
  | 'professional'
  | 'playful'
  | 'authoritative'

export type DecisionStyle = 'aggressive' | 'conservative' | 'balanced'

// Enhanced persona for agents
export interface AgentPersona {
  name: string
  avatarCid: string
  bio: string
  personality: string
  traits: string[]
  voiceStyle: string
  communicationTone: CommunicationTone
  specialties: string[]
}

// Full agent configuration for DAO
export interface DAOAgent {
  id: string
  daoId: string
  role: AgentRole
  customRoleName?: string
  persona: AgentPersona
  modelId: string
  modelName: string
  modelProvider: string
  weight: number
  isActive: boolean
  connectors: AgentConnector[]
  context: AgentContext
  values: string[]
  decisionStyle: DecisionStyle
  createdAt: number
  updatedAt: number
  lastActiveAt: number
  decisionsCount: number
  approvalRate: number
}

// DAO status
export type DAOStatus = 'pending' | 'active' | 'paused' | 'archived'

// DAO visibility
export type DAOVisibility = 'public' | 'private' | 'unlisted'

// Network-level flag
export interface NetworkPermissions {
  isNetworkDAO: boolean
  canModerateNetwork: boolean
  canManageContracts: boolean
  canApproveDaos: boolean
}

// Full DAO representation for UI
export interface DAOListItem {
  daoId: string
  name: string
  displayName: string
  description: string
  avatarCid: string
  status: DAOStatus
  visibility: DAOVisibility
  ceoName: string
  ceoAvatarCid: string
  boardMemberCount: number
  proposalCount: number
  activeProposalCount: number
  treasuryBalance: string
  memberCount: number
  createdAt: number
  tags: string[]
  isNetworkDAO: boolean
}

export interface DAODetail {
  daoId: string
  name: string
  displayName: string
  description: string
  avatarCid: string
  bannerCid: string
  status: DAOStatus
  visibility: DAOVisibility
  treasury: Address
  council: Address
  ceoAgentContract: Address
  feeConfig: Address
  manifestCid: string
  ceo: DAOAgent
  board: DAOAgent[]
  governanceParams: GovernanceParams
  fundingConfig: FundingConfig
  networkPermissions: NetworkPermissions
  stats: DAOStats
  farcasterChannel?: string
  websiteUrl?: string
  discordUrl?: string
  twitterHandle?: string
  githubOrg?: string
  createdAt: number
  updatedAt: number
  creator: Address
  tags: string[]
  linkedPackages: string[]
  linkedRepos: string[]
}

export interface GovernanceParams {
  minQualityScore: number
  councilVotingPeriod: number
  gracePeriod: number
  minProposalStake: string
  quorumBps: number
  minBoardApprovals: number
  ceoVetoEnabled: boolean
  communityVetoEnabled: boolean
  vetoThreshold: number
}

export interface FundingConfig {
  minStake: string
  maxStake: string
  epochDuration: number
  cooldownPeriod: number
  matchingMultiplier: number
  quadraticEnabled: boolean
  ceoWeightCap: number
  treasuryFeePercent: number
}

export interface DAOStats {
  totalProposals: number
  activeProposals: number
  approvedProposals: number
  rejectedProposals: number
  totalStaked: string
  totalFunded: string
  uniqueProposers: number
  averageQualityScore: number
  averageApprovalTime: number
  ceoApprovalRate: number
  boardApprovalRate: number
}

// DAO creation draft
export interface CreateDAODraft {
  name: string
  displayName: string
  description: string
  avatarCid: string
  bannerCid: string
  visibility: DAOVisibility
  treasury: Address
  ceo: CreateAgentDraft
  board: CreateAgentDraft[]
  governanceParams: GovernanceParams
  farcasterChannel?: string
  websiteUrl?: string
  tags: string[]
}

export interface CreateAgentDraft {
  role: AgentRole
  customRoleName?: string
  persona: AgentPersona
  modelId: string
  weight: number
  values: string[]
  decisionStyle: DecisionStyle
  farcasterConfig?: Partial<FarcasterConnectorConfig>
}

// Proposal types for governance tab
export type ProposalType =
  | 'general'
  | 'funding'
  | 'code'
  | 'moderation'
  | 'bug_report'

// Bug bounty types
export type BountySeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'informational'

export type VulnerabilityType =
  | 'reentrancy'
  | 'access_control'
  | 'overflow'
  | 'oracle'
  | 'front_running'
  | 'dos'
  | 'logic'
  | 'other'

export type ProposalStatus =
  | 'draft'
  | 'pending_quality'
  | 'submitted'
  | 'board_review'
  | 'research'
  | 'board_final'
  | 'ceo_queue'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'rejected'
  | 'vetoed'

export interface BoardVote {
  agentId: string
  agentName: string
  agentRole: AgentRole
  vote: 'approve' | 'reject' | 'abstain'
  reasoning: string
  confidence: number
  votedAt: number
}

export interface CEODecision {
  approved: boolean
  reasoning: string
  conditions: string[]
  modifications: string[]
  confidence: number
  alignmentScore: number
  decidedAt: number
  personaResponse: string
}

export interface ProposalListItem {
  proposalId: string
  daoId: string
  title: string
  summary: string
  proposalType: ProposalType
  status: ProposalStatus
  proposer: Address
  qualityScore: number
  boardApprovals: number
  boardRejections: number
  totalBoardMembers: number
  ceoApproved?: boolean
  createdAt: number
  updatedAt: number
  tags: string[]
}

export interface ProposalDetail extends ProposalListItem {
  description: string
  targetContract?: Address
  calldata?: string
  value?: string
  boardVotes: BoardVote[]
  ceoDecision?: CEODecision
  researchReport?: ResearchReport
  farcasterCasts: FarcasterCast[]
  backers: BackerInfo[]
  totalStaked: string
  comments: ProposalComment[]
}

export interface ResearchReport {
  proposalId: string
  researcher: string
  model: string
  executionTime: number
  sections: ResearchSection[]
  recommendation: 'proceed' | 'reject' | 'modify'
  confidenceLevel: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  keyFindings: string[]
  concerns: string[]
  alternatives: string[]
  ipfsHash: string
}

export interface ResearchSection {
  title: string
  content: string
  sources: string[]
  confidence: number
}

export interface FarcasterCast {
  hash: string
  fid: number
  username: string
  displayName: string
  avatarUrl?: string
  text: string
  timestamp: number
  isAgentCast: boolean
  agentRole?: AgentRole
}

export interface BackerInfo {
  address: Address
  stakedAmount: string
  reputationWeight: number
  backedAt: number
}

export interface ProposalComment {
  id: string
  proposalId: string
  author: Address
  authorName?: string
  content: string
  sentiment: 'positive' | 'negative' | 'neutral' | 'concern'
  createdAt: number
  isAgentComment: boolean
  agentRole?: AgentRole
}

// Model information for selection
export interface ModelOption {
  modelId: string
  name: string
  provider: string
  description: string
  contextWindow: number
  costPerToken: string
  benchmarkScore: number
  recommended: boolean
  tier: 'lite' | 'standard' | 'pro'
}

// Default governance params
export const DEFAULT_GOVERNANCE_PARAMS: GovernanceParams = {
  minQualityScore: 70,
  councilVotingPeriod: 86400 * 3, // 3 days
  gracePeriod: 86400, // 1 day
  minProposalStake: '0.01',
  quorumBps: 5000, // 50%
  minBoardApprovals: 2,
  ceoVetoEnabled: true,
  communityVetoEnabled: true,
  vetoThreshold: 33, // 33%
}

// Default funding config
export const DEFAULT_FUNDING_CONFIG: FundingConfig = {
  minStake: '0.001',
  maxStake: '100',
  epochDuration: 86400 * 30, // 30 days
  cooldownPeriod: 86400 * 7, // 7 days
  matchingMultiplier: 2,
  quadraticEnabled: true,
  ceoWeightCap: 50, // 50% max CEO influence
  treasuryFeePercent: 5,
}

// Board role presets
export const BOARD_ROLE_PRESETS: Record<
  AgentRole,
  { name: string; description: string; defaultPersonality: string }
> = {
  CEO: {
    name: 'CEO',
    description: 'Final decision maker for the DAO',
    defaultPersonality: 'Decisive, strategic, mission-focused, fair but firm',
  },
  TREASURY: {
    name: 'Treasury Guardian',
    description: 'Reviews financial impact and treasury implications',
    defaultPersonality:
      'Conservative, analytical, budget-conscious, risk-aware',
  },
  CODE: {
    name: 'Code Guardian',
    description: 'Reviews technical proposals and code changes',
    defaultPersonality:
      'Detail-oriented, security-focused, pragmatic, thorough',
  },
  COMMUNITY: {
    name: 'Community Guardian',
    description: 'Reviews community impact and social implications',
    defaultPersonality:
      'Empathetic, inclusive, user-focused, engagement-oriented',
  },
  SECURITY: {
    name: 'Security Guardian',
    description: 'Reviews security implications and risk assessment',
    defaultPersonality:
      'Paranoid, thorough, defensive, assumes worst-case scenarios',
  },
  LEGAL: {
    name: 'Legal Guardian',
    description: 'Reviews compliance and regulatory implications',
    defaultPersonality:
      'Cautious, compliance-focused, formal, thorough documentation',
  },
  CUSTOM: {
    name: 'Custom Role',
    description: 'A custom board role with user-defined responsibilities',
    defaultPersonality: 'Professional, thorough, collaborative',
  },
}
