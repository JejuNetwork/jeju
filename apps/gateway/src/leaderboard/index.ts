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

// Configuration
export { LEADERBOARD_CONFIG } from './config.js';

// Database
export { 
  getLeaderboardDB, 
  initLeaderboardDB, 
  closeLeaderboardDB,
  query,
  exec,
} from './db.js';

// Authentication
export {
  authenticateRequest,
  verifyUserOwnership,
  checkRateLimit,
  getClientId,
  generateVerificationMessage,
  generateNonce,
  verifyWalletSignature,
  getCorsHeaders,
  type AuthenticatedUser,
  type AuthResult,
  type AuthError,
  type AuthOutcome,
} from './auth.js';

// Reputation
export {
  calculateUserReputation,
  createAttestation,
  storeAttestation,
  getAttestation,
  confirmAttestation,
  getTopContributors,
  type ReputationData,
  type AttestationData,
} from './reputation.js';

// Server
export { leaderboardApp } from './server.js';



