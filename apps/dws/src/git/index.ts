/**
 * Git Module for DWS
 * Decentralized Git hosting with on-chain registry
 */

// Types
export * from './types';

// Core Git operations
export { GitObjectStore } from './object-store';
export { GitRepoManager, type RepoManagerConfig } from './repo-manager';
export * from './oid-utils';
export {
  PackfileWriter,
  PackfileReader,
  createPackfile,
  extractPackfile,
  parsePktLines,
  createPktLine,
  createPktLines,
  createFlushPkt,
} from './pack';

// Extended features
export { IssuesManager, type IssuesManagerConfig } from './issues';
export { PullRequestsManager, type PRManagerConfig } from './pull-requests';
export { SocialManager, type SocialManagerConfig } from './social';
export { SearchManager, type SearchManagerConfig, type SearchOptions, type RepoSearchOptions, type CodeSearchOptions, type IssueSearchOptions, type UserSearchOptions } from './search';
export { FederationManager, type FederationManagerConfig } from './federation';

// Leaderboard integration
export * from './leaderboard-integration';
