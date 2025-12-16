/**
 * Leaderboard API Server
 * 
 * Standalone server for leaderboard APIs.
 * Runs on port 4005 by default.
 */

import { serve } from 'bun';
import { leaderboardApp, initLeaderboardDB, LEADERBOARD_CONFIG } from './leaderboard/index.js';
import { JEJU_CHAIN_ID, IS_TESTNET, getChainName } from './config/networks.js';

const PORT = Number(process.env.LEADERBOARD_PORT) || 4005;

async function main() {
  // Initialize database
  console.log('[Leaderboard] Initializing database...');
  await initLeaderboardDB();

  // Start server
  serve({
    port: PORT,
    fetch: leaderboardApp.fetch,
  });

  console.log(`📊 Leaderboard Server running on http://localhost:${PORT}`);
  console.log(`   Network: ${getChainName(JEJU_CHAIN_ID)} (${IS_TESTNET ? 'testnet' : 'mainnet'})`);
  console.log(`   Database: ${LEADERBOARD_CONFIG.db.databaseId}`);
  console.log(`   Oracle: ${LEADERBOARD_CONFIG.oracle.isEnabled ? 'enabled' : 'disabled'}`);
  console.log(`   API: http://localhost:${PORT}/api`);
  console.log(`   Health: http://localhost:${PORT}/health`);
}

main().catch((err) => {
  console.error('[Leaderboard] Failed to start:', err);
  process.exit(1);
});



