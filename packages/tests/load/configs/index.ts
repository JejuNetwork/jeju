/**
 * Load Test Configurations for All Apps
 *
 * Each app has its own configuration with endpoints, thresholds, and network-specific settings.
 */

import type { AppLoadTestConfig } from '../types'
export { testServerConfig } from './test-server'

export const autocratConfig: AppLoadTestConfig = {
  name: 'autocrat',
  description: 'AI Council DAO governance',
  baseUrl: 'http://localhost:8010',
  port: 8010,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.1, expectedStatus: [200] },
    { path: '/', method: 'GET', weight: 0.1, expectedStatus: [200] },
    {
      path: '/api/v1/dao',
      method: 'GET',
      weight: 0.2,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/v1/proposals',
      method: 'GET',
      weight: 0.2,
      expectedStatus: [200],
    },
    {
      path: '/api/v1/agents',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200],
    },
    {
      path: '/api/v1/registry',
      method: 'GET',
      weight: 0.1,
      expectedStatus: [200],
    },
    {
      path: '/api/v1/futarchy/markets',
      method: 'GET',
      weight: 0.1,
      expectedStatus: [200, 404],
    },
    {
      path: '/.well-known/agent-card.json',
      method: 'GET',
      weight: 0.05,
      expectedStatus: [200, 404],
    },
  ],
  thresholds: {
    p50Latency: 100,
    p95Latency: 300,
    p99Latency: 500,
    errorRate: 0.05,
    minRps: 50,
  },
  testnet: { baseUrl: 'https://autocrat.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://autocrat.jejunetwork.org' },
}

export const bazaarConfig: AppLoadTestConfig = {
  name: 'bazaar',
  description: 'DeFi + NFT Marketplace',
  baseUrl: 'http://localhost:3000',
  port: 3000,
  healthEndpoint: '/api/health',
  endpoints: [
    { path: '/api/health', method: 'GET', weight: 0.1, expectedStatus: [200] },
    {
      path: '/api/pools',
      method: 'GET',
      weight: 0.2,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/tokens',
      method: 'GET',
      weight: 0.2,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/markets',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/nfts',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/stats',
      method: 'GET',
      weight: 0.1,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/prices',
      method: 'GET',
      weight: 0.1,
      expectedStatus: [200, 404],
    },
  ],
  thresholds: {
    p50Latency: 150,
    p95Latency: 400,
    p99Latency: 800,
    errorRate: 0.05,
    minRps: 40,
  },
  testnet: { baseUrl: 'https://bazaar.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://bazaar.jejunetwork.org' },
}

export const crucibleConfig: AppLoadTestConfig = {
  name: 'crucible',
  description: 'Agent orchestration platform',
  baseUrl: 'http://localhost:4020',
  port: 4020,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.1, expectedStatus: [200] },
    { path: '/info', method: 'GET', weight: 0.1, expectedStatus: [200] },
    { path: '/metrics', method: 'GET', weight: 0.05, expectedStatus: [200] },
    {
      path: '/api/v1/characters',
      method: 'GET',
      weight: 0.2,
      expectedStatus: [200],
    },
    {
      path: '/api/v1/bots',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200],
    },
    {
      path: '/api/v1/autonomous/status',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200],
    },
    {
      path: '/api/v1/search/agents',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 400],
    },
    {
      path: '/api/v1/chat/characters',
      method: 'GET',
      weight: 0.1,
      expectedStatus: [200],
    },
  ],
  thresholds: {
    p50Latency: 200,
    p95Latency: 500,
    p99Latency: 1000,
    errorRate: 0.05,
    minRps: 30,
  },
  testnet: { baseUrl: 'https://crucible.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://crucible.jejunetwork.org' },
}

export const dwsConfig: AppLoadTestConfig = {
  name: 'dws',
  description: 'Decentralized Web Services',
  baseUrl: 'http://localhost:4030',
  port: 4030,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.15, expectedStatus: [200] },
    { path: '/api/status', method: 'GET', weight: 0.1, expectedStatus: [200] },
    {
      path: '/api/nodes',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/storage/stats',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/compute/status',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/cdn/stats',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/regions',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
  ],
  thresholds: {
    p50Latency: 100,
    p95Latency: 300,
    p99Latency: 600,
    errorRate: 0.05,
    minRps: 50,
  },
  testnet: { baseUrl: 'https://dws.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://dws.jejunetwork.org' },
}

export const gatewayRpcConfig: AppLoadTestConfig = {
  name: 'gateway-rpc',
  description: 'RPC Gateway with stake-based rate limiting',
  baseUrl: 'http://localhost:4004',
  port: 4004,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.15, expectedStatus: [200] },
    { path: '/', method: 'GET', weight: 0.1, expectedStatus: [200] },
    {
      path: '/v1/chains',
      method: 'GET',
      weight: 0.2,
      expectedStatus: [200],
    },
    {
      path: '/v1/keys',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 401],
    },
    {
      path: '/v1/usage',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 401],
    },
    {
      path: '/mcp/resources/list',
      method: 'POST',
      weight: 0.15,
      expectedStatus: [200],
      body: {},
    },
    {
      path: '/mcp/initialize',
      method: 'POST',
      weight: 0.1,
      expectedStatus: [200],
      body: {},
    },
  ],
  thresholds: {
    p50Latency: 50,
    p95Latency: 150,
    p99Latency: 300,
    errorRate: 0.02,
    minRps: 100,
  },
  testnet: { baseUrl: 'https://rpc.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://rpc.jejunetwork.org' },
}

export const gatewayA2aConfig: AppLoadTestConfig = {
  name: 'gateway-a2a',
  description: 'Gateway A2A Server',
  baseUrl: 'http://localhost:4002',
  port: 4002,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.15, expectedStatus: [200] },
    {
      path: '/.well-known/agent-card.json',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200],
    },
    { path: '/api/agents', method: 'GET', weight: 0.2, expectedStatus: [200] },
    { path: '/api/stats', method: 'GET', weight: 0.15, expectedStatus: [200] },
    {
      path: '/api/faucet',
      method: 'GET',
      weight: 0.1,
      expectedStatus: [200, 404],
    },
    {
      path: '/mcp/resources/list',
      method: 'POST',
      weight: 0.15,
      expectedStatus: [200],
      body: {},
    },
    {
      path: '/a2a',
      method: 'POST',
      weight: 0.1,
      expectedStatus: [200, 400],
      body: { jsonrpc: '2.0', method: 'agent/card', id: 1 },
    },
  ],
  thresholds: {
    p50Latency: 100,
    p95Latency: 300,
    p99Latency: 500,
    errorRate: 0.05,
    minRps: 50,
  },
  testnet: { baseUrl: 'https://a2a.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://a2a.jejunetwork.org' },
}

export const gatewayX402Config: AppLoadTestConfig = {
  name: 'gateway-x402',
  description: 'X402 Payment Facilitator',
  baseUrl: 'http://localhost:4003',
  port: 4003,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.3, expectedStatus: [200] },
    { path: '/', method: 'GET', weight: 0.2, expectedStatus: [200] },
    {
      path: '/api/config',
      method: 'GET',
      weight: 0.2,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/nonces',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 401],
    },
    {
      path: '/api/stats',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
  ],
  thresholds: {
    p50Latency: 50,
    p95Latency: 150,
    p99Latency: 300,
    errorRate: 0.02,
    minRps: 80,
  },
  testnet: { baseUrl: 'https://x402.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://x402.jejunetwork.org' },
}

export const gatewayLeaderboardConfig: AppLoadTestConfig = {
  name: 'gateway-leaderboard',
  description: 'Leaderboard API',
  baseUrl: 'http://localhost:4005',
  port: 4005,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.2, expectedStatus: [200] },
    { path: '/api', method: 'GET', weight: 0.2, expectedStatus: [200] },
    {
      path: '/api/leaderboard',
      method: 'GET',
      weight: 0.25,
      expectedStatus: [200],
    },
    {
      path: '/api/stats',
      method: 'GET',
      weight: 0.2,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/agents',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
  ],
  thresholds: {
    p50Latency: 100,
    p95Latency: 300,
    p99Latency: 500,
    errorRate: 0.03,
    minRps: 60,
  },
  testnet: { baseUrl: 'https://leaderboard.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://leaderboard.jejunetwork.org' },
}

export const indexerConfig: AppLoadTestConfig = {
  name: 'indexer',
  description: 'Blockchain indexer with GraphQL',
  baseUrl: 'http://localhost:4352',
  port: 4352,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.15, expectedStatus: [200] },
    {
      path: '/api/stats',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/search?q=agent',
      method: 'GET',
      weight: 0.2,
      expectedStatus: [200],
    },
    {
      path: '/api/agents?limit=50',
      method: 'GET',
      weight: 0.2,
      expectedStatus: [200],
    },
    {
      path: '/api/tags',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
    {
      path: '/api/transactions?limit=20',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200, 404],
    },
  ],
  thresholds: {
    p50Latency: 100,
    p95Latency: 300,
    p99Latency: 500,
    errorRate: 0.03,
    minRps: 80,
  },
  testnet: { baseUrl: 'https://indexer.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://indexer.jejunetwork.org' },
}

export const factoryConfig: AppLoadTestConfig = {
  name: 'factory',
  description: 'Developer coordination hub',
  baseUrl: 'http://localhost:4009',
  port: 4009,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.15, expectedStatus: [200] },
    {
      path: '/api/bounties',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200],
    },
    { path: '/api/jobs', method: 'GET', weight: 0.15, expectedStatus: [200] },
    {
      path: '/api/packages',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200],
    },
    { path: '/api/models', method: 'GET', weight: 0.1, expectedStatus: [200] },
    { path: '/api/feed', method: 'GET', weight: 0.1, expectedStatus: [200] },
    {
      path: '/api/projects',
      method: 'GET',
      weight: 0.1,
      expectedStatus: [200],
    },
    { path: '/api/agents', method: 'GET', weight: 0.1, expectedStatus: [200] },
  ],
  thresholds: {
    p50Latency: 100,
    p95Latency: 300,
    p99Latency: 500,
    errorRate: 0.05,
    minRps: 50,
  },
  testnet: { baseUrl: 'https://factory.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://factory.jejunetwork.org' },
}

export const monitoringConfig: AppLoadTestConfig = {
  name: 'monitoring',
  description: 'Network monitoring dashboard',
  baseUrl: 'http://localhost:5173',
  port: 5173,
  healthEndpoint: '/',
  endpoints: [
    { path: '/', method: 'GET', weight: 0.3, expectedStatus: [200] },
  ],
  thresholds: {
    p50Latency: 100,
    p95Latency: 300,
    p99Latency: 500,
    errorRate: 0.05,
    minRps: 30,
  },
}

export const monitoringA2aConfig: AppLoadTestConfig = {
  name: 'monitoring-a2a',
  description: 'Monitoring A2A server with Prometheus integration',
  baseUrl: 'http://localhost:9091',
  port: 9091,
  healthEndpoint: '/.well-known/agent-card.json',
  endpoints: [
    {
      path: '/.well-known/agent-card.json',
      method: 'GET',
      weight: 0.3,
      expectedStatus: [200],
    },
    {
      path: '/api/a2a',
      method: 'POST',
      weight: 0.7,
      expectedStatus: [200],
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'test',
            parts: [{ kind: 'data', data: { skillId: 'get-targets' } }],
          },
        },
      },
    },
  ],
  thresholds: {
    p50Latency: 200,
    p95Latency: 500,
    p99Latency: 1000,
    errorRate: 0.05,
    minRps: 30,
  },
}

export const ottoConfig: AppLoadTestConfig = {
  name: 'otto',
  description: 'Trading agent',
  baseUrl: 'http://localhost:4025',
  port: 4025,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.2, expectedStatus: [200] },
    { path: '/status', method: 'GET', weight: 0.2, expectedStatus: [200] },
    { path: '/api/chains', method: 'GET', weight: 0.2, expectedStatus: [200] },
    { path: '/api/info', method: 'GET', weight: 0.2, expectedStatus: [200] },
    { path: '/miniapp', method: 'GET', weight: 0.2, expectedStatus: [200] },
  ],
  thresholds: {
    p50Latency: 100,
    p95Latency: 300,
    p99Latency: 500,
    errorRate: 0.05,
    minRps: 40,
  },
  testnet: { baseUrl: 'https://otto.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://otto.jejunetwork.org' },
}

export const walletConfig: AppLoadTestConfig = {
  name: 'wallet',
  description: 'Multi-platform wallet',
  baseUrl: 'http://localhost:4015',
  port: 4015,
  healthEndpoint: '/',
  endpoints: [
    { path: '/', method: 'GET', weight: 1.0, expectedStatus: [200] },
  ],
  thresholds: {
    p50Latency: 100,
    p95Latency: 300,
    p99Latency: 500,
    errorRate: 0.05,
    minRps: 50,
  },
  testnet: { baseUrl: 'https://wallet.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://wallet.jejunetwork.org' },
}

export const documentationConfig: AppLoadTestConfig = {
  name: 'documentation',
  description: 'Documentation site',
  baseUrl: 'http://localhost:4004',
  port: 4004,
  healthEndpoint: '/',
  endpoints: [
    { path: '/', method: 'GET', weight: 0.4, expectedStatus: [200] },
    { path: '/docs', method: 'GET', weight: 0.3, expectedStatus: [200, 404] },
    { path: '/api', method: 'GET', weight: 0.3, expectedStatus: [200, 404] },
  ],
  thresholds: {
    p50Latency: 100,
    p95Latency: 300,
    p99Latency: 500,
    errorRate: 0.05,
    minRps: 50,
  },
  testnet: { baseUrl: 'https://docs.testnet.jejunetwork.org' },
  mainnet: { baseUrl: 'https://docs.jejunetwork.org' },
}

// Import test server config
import { testServerConfig } from './test-server'

// All configs for easy iteration
export const ALL_CONFIGS: AppLoadTestConfig[] = [
  autocratConfig,
  bazaarConfig,
  crucibleConfig,
  dwsConfig,
  gatewayRpcConfig,
  gatewayA2aConfig,
  gatewayX402Config,
  gatewayLeaderboardConfig,
  indexerConfig,
  factoryConfig,
  monitoringConfig,
  monitoringA2aConfig,
  ottoConfig,
  walletConfig,
  documentationConfig,
  testServerConfig,
]

// API-focused configs (apps with meaningful API endpoints)
export const API_CONFIGS: AppLoadTestConfig[] = [
  autocratConfig,
  bazaarConfig,
  crucibleConfig,
  dwsConfig,
  gatewayRpcConfig,
  gatewayA2aConfig,
  gatewayX402Config,
  gatewayLeaderboardConfig,
  indexerConfig,
  factoryConfig,
  monitoringA2aConfig,
  ottoConfig,
]

export function getConfigByName(name: string): AppLoadTestConfig | undefined {
  return ALL_CONFIGS.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  )
}

