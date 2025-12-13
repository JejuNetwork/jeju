/**
 * Council Agents Module
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
  councilStatusProvider,
  treasuryProvider,
  // Renamed exports to avoid conflicts
  activeProposalsProvider as ceoActiveProposalsProvider,
  proposalDetailProvider as ceoProposalDetailProvider,
} from './ceo-providers';

// Council providers
export {
  councilProviders,
  serviceDiscoveryProvider,
  otherCouncilVotesProvider,
  ceoStatusProvider,
  mcpToolsProvider,
  a2aSkillsProvider,
  governanceStatsProvider,
  researchReportsProvider,
  activeProposalsProvider as councilActiveProposalsProvider,
  proposalDetailProvider as councilProposalDetailProvider,
} from './council-providers';

// Plugins
export { ceoPlugin } from './ceo-plugin';
export { councilPlugin } from './council-plugin';
