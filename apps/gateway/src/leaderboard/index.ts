/**
 * Leaderboard Module
 *
 * Integrated GitHub reputation tracking, attestations, and leaderboard.
 *
 * @example
 * ```typescript
 * import { leaderboardApp, initLeaderboardDB, LEADERBOARD_CONFIG } from './leaderboard';
 *
 * // Mount in gateway
 * app.route('/leaderboard', leaderboardApp);
 *
 * // Or initialize standalone
 * await initLeaderboardDB();
 * const reputation = await calculateUserReputation('username');
 * ```
 */

// Authentication
export {
  type AuthError,
  type AuthenticatedUser,
  type AuthOutcome,
  type AuthResult,
  authenticateRequest,
  checkRateLimit,
  generateNonce,
  generateVerificationMessage,
  getClientId,
  getCorsHeaders,
  verifyUserOwnership,
  verifyWalletSignature,
} from './auth.js'
// Configuration
export { LEADERBOARD_CONFIG } from './config.js'
// Database
export {
  closeLeaderboardDB,
  exec,
  getLeaderboardDB,
  initLeaderboardDB,
  query,
} from './db.js'

// Reputation
export {
  type AttestationData,
  calculateUserReputation,
  confirmAttestation,
  createAttestation,
  getAttestation,
  getTopContributors,
  type ReputationData,
  storeAttestation,
} from './reputation.js'
export type { LeaderboardApp } from './server.js'
// Server
export { leaderboardApp } from './server.js'
