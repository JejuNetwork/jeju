/**
 * Git Module for DWS
 * Decentralized Git hosting with on-chain registry
 */

export { FederationManager, type FederationManagerConfig } from './federation'
// Extended features
export { IssuesManager, type IssuesManagerConfig } from './issues'
// Leaderboard integration
export * from './leaderboard-integration'
// Core Git operations
export { GitObjectStore } from './object-store'
export * from './oid-utils'
export {
  createFlushPkt,
  createPackfile,
  createPktLine,
  createPktLines,
  extractPackfile,
  PackfileReader,
  PackfileWriter,
  parsePktLines,
} from './pack'
export { type PRManagerConfig, PullRequestsManager } from './pull-requests'
export { GitRepoManager, type RepoManagerConfig } from './repo-manager'
export {
  type CodeSearchOptions,
  type IssueSearchOptions,
  type RepoSearchOptions,
  SearchManager,
  type SearchManagerConfig,
  type SearchOptions,
  type UserSearchOptions,
} from './search'
export { SocialManager, type SocialManagerConfig } from './social'
// Types
export * from './types'
