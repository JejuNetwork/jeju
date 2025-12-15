/**
 * Autocrat Agents Module
 * 
 * ElizaOS-powered AI agents for DAO governance.
 */

export * from './templates';
export * from './runtime';

// CEO providers (prefixed exports to avoid conflicts)
export { 
  ceoProviders,
  governanceDashboardProvider,
  historicalDecisionsProvider,
  mcpResourcesProvider,
  autocratStatusProvider,
  treasuryProvider,
  // Renamed exports to avoid conflicts
  activeProposalsProvider as ceoActiveProposalsProvider,
  proposalDetailProvider as ceoProposalDetailProvider,
} from './ceo-providers';

// Autocrat providers
export {
  autocratProviders,
  serviceDiscoveryProvider,
  otherAutocratVotesProvider,
  ceoStatusProvider,
  mcpToolsProvider,
  a2aSkillsProvider,
  governanceStatsProvider,
  researchReportsProvider,
  activeProposalsProvider as autocratActiveProposalsProvider,
  proposalDetailProvider as autocratProposalDetailProvider,
} from './autocrat-providers';

// Plugins
export { ceoPlugin } from './ceo-plugin';
export { autocratPlugin } from './autocrat-plugin';
