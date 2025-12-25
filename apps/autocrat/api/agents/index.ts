/**
 * Autocrat Agents Module
 *
 * ElizaOS-powered AI agents for DAO governance.
 */

export { autocratPlugin } from './autocrat-plugin'
// Autocrat providers
export {
  a2aSkillsProvider,
  activeProposalsProvider as autocratActiveProposalsProvider,
  autocratProviders,
  ceoStatusProvider,
  governanceStatsProvider,
  mcpToolsProvider,
  otherAutocratVotesProvider,
  proposalDetailProvider as autocratProposalDetailProvider,
  researchReportsProvider,
  serviceDiscoveryProvider,
} from './autocrat-providers'
// Plugins
export { ceoPlugin } from './ceo-plugin'
// CEO providers (prefixed exports to avoid conflicts)
export {
  // Renamed exports to avoid conflicts
  activeProposalsProvider as ceoActiveProposalsProvider,
  autocratStatusProvider,
  ceoProviders,
  governanceDashboardProvider,
  historicalDecisionsProvider,
  mcpResourcesProvider,
  proposalDetailProvider as ceoProposalDetailProvider,
  treasuryProvider,
} from './ceo-providers'
export * from './runtime'
export * from './templates'
