/**
 * Bazaar API Server Entry Point
 * 
 * Standalone API server for development.
 * This is used by `jeju dev` to start just the API server.
 */

import { CORE_PORTS, getCoreAppUrl, getCurrentNetwork, getEnvVar, getIndexerGraphqlUrl, getL2RpcUrl, getLocalhostHost, getSQLitBlockProducerUrl } from '@jejunetwork/config'
import { createBazaarApp } from './worker'
import { config, configureBazaar } from './config'
import { getSqlitPrivateKey } from '../lib/secrets'

// Initialize config - secrets retrieved through secrets module
configureBazaar({
  bazaarApiUrl: getEnvVar('BAZAAR_API_URL'),
  farcasterHubUrl: getEnvVar('FARCASTER_HUB_URL'),
  sqlitDatabaseId: getEnvVar('SQLIT_DATABASE_ID'),
  // SQLit private key retrieved through secrets module (not raw env var)
  sqlitPrivateKey: getSqlitPrivateKey(),
})

const PORT = CORE_PORTS.BAZAAR_API.get()

const app = createBazaarApp({
  NETWORK: getCurrentNetwork(),
  TEE_MODE: 'simulated',
  TEE_PLATFORM: 'local',
  TEE_REGION: 'local',
  RPC_URL: getL2RpcUrl(),
  DWS_URL: getCoreAppUrl('DWS_API'),
  GATEWAY_URL: getCoreAppUrl('NODE_EXPLORER_API'),
  INDEXER_URL: getIndexerGraphqlUrl(),
  SQLIT_NODES: getSQLitBlockProducerUrl(),
  SQLIT_DATABASE_ID: config.sqlitDatabaseId,
  SQLIT_PRIVATE_KEY: config.sqlitPrivateKey || '',
})

const host = getLocalhostHost()
app.listen({
  port: PORT,
  hostname: host,
}, () => {
  console.log(`[Bazaar] API server running at http://${host}:${PORT}`)
})

