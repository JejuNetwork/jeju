import { createAppConfig, getEnvNumber, getEnvVar, isProductionEnv } from '@jejunetwork/config'

export interface GatewayConfig {
  // Server
  port: number
  gatewayApiPort: number
  isProduction: boolean
  corsOrigins: string[]

  // URLs
  prometheusUrl: string
  oifAggregatorUrl: string

  // A2A / Monitoring
  a2aPort: number

  // RPC / Oracle
  operatorPrivateKey?: string
  workerPrivateKey?: string
  feedRegistryAddress?: string
  reportVerifierAddress?: string
  committeeManagerAddress?: string
  feeRouterAddress?: string
  networkConnectorAddress?: string
  pollIntervalMs: number
  heartbeatIntervalMs: number
  metricsPort: number

  // x402 Facilitator
  facilitatorPort: number
  host: string
  facilitatorPrivateKey?: string
  facilitatorAddress?: string
  usdcAddress?: string
  protocolFeeBps: number
  feeRecipientAddress?: string
  maxPaymentAge: number
  minPaymentAmount: bigint
  facilitatorUrl: string
  kmsEnabled: boolean
  kmsSecretId?: string
  facilitatorServiceAddress?: string
  vaultEncryptionSecret?: string

  // Leaderboard
  leaderboardCqlDatabaseId: string
  leaderboardDebug: boolean
  attestationOraclePrivateKey?: string
  leaderboardDomain: string
  githubToken?: string
  leaderboardRepositories: string
  dwsApiUrl: string
  leaderboardDataDir: string
  openrouterApiKey?: string
  leaderboardLlmModel: string

  // Faucet
  faucetPrivateKey?: string

  // JNS Gateway
  gatewayUrl?: string
  wsPort: number
  devMode: boolean
  devHost: string
  ipfsGatewayUrl?: string
  jnsRegistryAddress?: string
  jnsResolverAddress?: string
  jnsGatewayPort: number
}

const { config, configure: setGatewayConfig } = createAppConfig<GatewayConfig>({
  // Server
  port: getEnvNumber('PORT') ?? 4013,
  gatewayApiPort: getEnvNumber('GATEWAY_API_PORT') ?? 4013,
  isProduction: isProductionEnv(),
  corsOrigins: (getEnvVar('CORS_ORIGINS') ?? '').split(',').filter(Boolean),

  // URLs
  prometheusUrl: getEnvVar('PROMETHEUS_URL') ?? 'http://localhost:9090',
  oifAggregatorUrl: getEnvVar('OIF_AGGREGATOR_URL') ?? 'http://localhost:4010',

  // A2A / Monitoring
  a2aPort: getEnvNumber('A2A_PORT') ?? 9091,

  // RPC / Oracle
  operatorPrivateKey: getEnvVar('OPERATOR_PRIVATE_KEY'),
  workerPrivateKey: getEnvVar('WORKER_PRIVATE_KEY'),
  feedRegistryAddress: getEnvVar('FEED_REGISTRY_ADDRESS'),
  reportVerifierAddress: getEnvVar('REPORT_VERIFIER_ADDRESS'),
  committeeManagerAddress: getEnvVar('COMMITTEE_MANAGER_ADDRESS'),
  feeRouterAddress: getEnvVar('FEE_ROUTER_ADDRESS'),
  networkConnectorAddress: getEnvVar('NETWORK_CONNECTOR_ADDRESS'),
  pollIntervalMs: getEnvNumber('POLL_INTERVAL_MS') ?? 60000,
  heartbeatIntervalMs: getEnvNumber('HEARTBEAT_INTERVAL_MS') ?? 300000,
  metricsPort: getEnvNumber('METRICS_PORT') ?? 9090,

  // x402 Facilitator
  facilitatorPort: getEnvNumber('FACILITATOR_PORT') ?? getEnvNumber('PORT') ?? 3402,
  host: getEnvVar('HOST') ?? '0.0.0.0',
  facilitatorPrivateKey: getEnvVar('FACILITATOR_PRIVATE_KEY'),
  facilitatorAddress: getEnvVar('X402_FACILITATOR_ADDRESS'),
  usdcAddress: getEnvVar('JEJU_USDC_ADDRESS'),
  protocolFeeBps: getEnvNumber('PROTOCOL_FEE_BPS') ?? 50,
  feeRecipientAddress: getEnvVar('FEE_RECIPIENT_ADDRESS'),
  maxPaymentAge: getEnvNumber('MAX_PAYMENT_AGE') ?? 300,
  minPaymentAmount: BigInt(getEnvNumber('MIN_PAYMENT_AMOUNT') ?? 1),
  facilitatorUrl: getEnvVar('FACILITATOR_URL') ?? `http://localhost:${getEnvNumber('FACILITATOR_PORT') ?? getEnvNumber('PORT') ?? 3402}`,
  kmsEnabled: getEnvVar('KMS_ENABLED') === 'true' || getEnvVar('VAULT_ENCRYPTION_SECRET') !== undefined,
  kmsSecretId: getEnvVar('FACILITATOR_KMS_SECRET_ID'),
  facilitatorServiceAddress: getEnvVar('FACILITATOR_SERVICE_ADDRESS'),
  vaultEncryptionSecret: getEnvVar('VAULT_ENCRYPTION_SECRET'),

  // Leaderboard
  leaderboardCqlDatabaseId: getEnvVar('LEADERBOARD_EQLite_DATABASE_ID') ?? 'leaderboard',
  leaderboardDebug: !isProductionEnv(),
  attestationOraclePrivateKey: getEnvVar('ATTESTATION_ORACLE_PRIVATE_KEY'),
  leaderboardDomain: getEnvVar('LEADERBOARD_DOMAIN') ?? 'leaderboard.jejunetwork.org',
  githubToken: getEnvVar('GITHUB_TOKEN'),
  leaderboardRepositories: getEnvVar('LEADERBOARD_REPOSITORIES') ?? 'jejunetwork/jeju',
  dwsApiUrl: getEnvVar('DWS_API_URL') ?? 'http://localhost:4030',
  leaderboardDataDir: getEnvVar('LEADERBOARD_DATA_DIR') ?? './data/leaderboard',
  openrouterApiKey: getEnvVar('OPENROUTER_API_KEY'),
  leaderboardLlmModel: getEnvVar('LEADERBOARD_LLM_MODEL') ?? 'anthropic/claude-sonnet-4-5',

  // Faucet
  faucetPrivateKey: getEnvVar('FAUCET_PRIVATE_KEY'),

  // JNS Gateway
  gatewayUrl: getEnvVar('GATEWAY_URL'),
  wsPort: getEnvNumber('WS_PORT') ?? 4004,
  devMode: getEnvVar('DEV_MODE') === 'true' || !isProductionEnv() || getEnvVar('JEJU_DEV') === 'true' || getEnvVar('JNS_DEV_PROXY') === 'true',
  devHost: getEnvVar('DEV_HOST') ?? 'localhost',
  ipfsGatewayUrl: getEnvVar('IPFS_GATEWAY_URL'),
  jnsRegistryAddress: getEnvVar('JNS_REGISTRY_ADDRESS'),
  jnsResolverAddress: getEnvVar('JNS_RESOLVER_ADDRESS'),
  jnsGatewayPort: getEnvNumber('JNS_GATEWAY_PORT') ?? 4005,
})

export { config }
export function configureGateway(updates: Partial<GatewayConfig>): void {
  setGatewayConfig(updates)
}
