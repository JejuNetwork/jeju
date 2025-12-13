/**
 * Jeju Shared Package
 * Common hooks, components, APIs, and utilities used across all Jeju apps
 */

// Hooks
export { 
  useBanStatus, 
  getBanTypeLabel, 
  getBanTypeColor,
  BanType,
  type BanStatus,
  type BanCheckConfig 
} from './hooks/useBanStatus';

// Components
export { 
  BanBanner, 
  BanIndicator, 
  BanOverlay 
} from './components/BanBanner';

// Moderation API
export {
  ModerationAPI,
  createModerationAPI,
  BAN_TYPES,
  CASE_STATUS,
  REPUTATION_TIERS,
  REPORT_TYPES,
  SEVERITY_LEVELS,
  LABELS,
  type ModerationConfig,
  type BanStatus as ModerationBanStatus,
  type ModeratorProfile,
  type ModerationCase,
  type Report,
  type AgentLabels,
  type ModerationStats,
  type TransactionRequest,
} from './api/moderation';

// Health Check Middleware
export {
  healthMiddleware,
  healthChecks,
} from './health-middleware';
