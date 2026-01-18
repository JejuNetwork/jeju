/**
 * Bazaar API Server (Local Development Entry Point)
 *
 * This file is the entry point for running the Bazaar API in local development.
 * It imports the app from worker.ts but doesn't trigger Bun's auto-serve.
 *
 * For workerd/DWS deployment, use worker.ts directly.
 */

import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getEnvVar,
  getIndexerGraphqlUrl,
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { getSqlitPrivateKey } from '../lib/secrets'
import { config, configureBazaar } from './config'
import { createBazaarApp } from './worker'

// Initialize config - secrets retrieved through secrets module
configureBazaar({
  bazaarApiUrl: getEnvVar('BAZAAR_API_URL'),
  farcasterHubUrl: getEnvVar('FARCASTER_HUB_URL'),
  sqlitDatabaseId: getEnvVar('SQLIT_DATABASE_ID'),
  // SQLit private key retrieved through secrets module (not raw env var)
  sqlitPrivateKey: getSqlitPrivateKey(),
})

const PORT = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : CORE_PORTS.BAZAAR_API.get()

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
app.listen(PORT, () => {
  console.log(`Bazaar API Server running at http://${host}:${PORT}`)
})
