import { serve } from 'bun'
import { getChainName, IS_TESTNET, JEJU_CHAIN_ID } from '../lib/config/networks'
import {
  initLeaderboardDB,
  LEADERBOARD_CONFIG,
  leaderboardApp,
} from './leaderboard/index'

const PORT = Number(process.env.LEADERBOARD_PORT) || 4005

async function main() {
  // Initialize database
  console.log('[Leaderboard] Initializing database...')
  await initLeaderboardDB()

  // Start server
  serve({
    port: PORT,
    fetch: leaderboardApp.fetch,
  })

  console.log(`📊 Leaderboard Server running on http://localhost:${PORT}`)
  console.log(
    `   Network: ${getChainName(JEJU_CHAIN_ID)} (${IS_TESTNET ? 'testnet' : 'mainnet'})`,
  )
  console.log(`   Database: ${LEADERBOARD_CONFIG.db.databaseId}`)
  console.log(
    `   Oracle: ${LEADERBOARD_CONFIG.oracle.isEnabled ? 'enabled' : 'disabled'}`,
  )
  console.log(`   API: http://localhost:${PORT}/api`)
  console.log(`   Health: http://localhost:${PORT}/health`)
}

main().catch((err) => {
  console.error('[Leaderboard] Failed to start:', err)
  process.exit(1)
})
