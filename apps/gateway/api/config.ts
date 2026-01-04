import {
  createAppConfig,
  getEnvNumber,
  getEnvVar,
  getLocalhostHost,
  isProductionEnv,
} from '@jejunetwork/config'

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

  // RPC / Oracle (all signing uses KMS service IDs, not private keys)
  feedRegistryAddress?: string
  reportVerifierAddress?: string
  committeeManagerAddress?: string
  feeRouterAddress?: string
  networkConnectorAddress?: string
  pollIntervalMs: number
  heartbeatIntervalMs: number
  metricsPort: number

  // x402 Facilitator (signing uses KMS via service ID)
  facilitatorPort: number
  host: string
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

  // Leaderboard (signing uses KMS via service ID)
  leaderboardSQLitDatabaseId: string
  leaderboardDebug: boolean
  leaderboardDomain: string
  leaderboardRepositories: string
  dwsApiUrl: string
  leaderboardDataDir: string
  leaderboardLlmModel: string

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
  prometheusUrl:
    getEnvVar('PROMETHEUS_URL') ?? `http://${getLocalhostHost()}:9090`,
  oifAggregatorUrl:
    getEnvVar('OIF_AGGREGATOR_URL') ?? `http://${getLocalhostHost()}:4010`,

  // A2A / Monitoring
  a2aPort: getEnvNumber('A2A_PORT') ?? 9091,

  // RPC / Oracle (all signing uses KMS service IDs, not private keys)
  feedRegistryAddress: getEnvVar('FEED_REGISTRY_ADDRESS'),
  reportVerifierAddress: getEnvVar('REPORT_VERIFIER_ADDRESS'),
  committeeManagerAddress: getEnvVar('COMMITTEE_MANAGER_ADDRESS'),
  feeRouterAddress: getEnvVar('FEE_ROUTER_ADDRESS'),
  networkConnectorAddress: getEnvVar('NETWORK_CONNECTOR_ADDRESS'),
  pollIntervalMs: getEnvNumber('POLL_INTERVAL_MS') ?? 60000,
  heartbeatIntervalMs: getEnvNumber('HEARTBEAT_INTERVAL_MS') ?? 300000,
  metricsPort: getEnvNumber('METRICS_PORT') ?? 9090,

  // x402 Facilitator (signing uses KMS via service ID)
  facilitatorPort:
    getEnvNumber('FACILITATOR_PORT') ?? getEnvNumber('PORT') ?? 3402,
  host: getEnvVar('HOST') ?? '0.0.0.0',
  facilitatorAddress: getEnvVar('X402_FACILITATOR_ADDRESS'),
  usdcAddress: getEnvVar('JEJU_USDC_ADDRESS'),
  protocolFeeBps: getEnvNumber('PROTOCOL_FEE_BPS') ?? 50,
  feeRecipientAddress: getEnvVar('FEE_RECIPIENT_ADDRESS'),
  maxPaymentAge: getEnvNumber('MAX_PAYMENT_AGE') ?? 300,
  minPaymentAmount: BigInt(getEnvNumber('MIN_PAYMENT_AMOUNT') ?? 1),
  facilitatorUrl:
    getEnvVar('FACILITATOR_URL') ??
    `http://${getLocalhostHost()}:${getEnvNumber('FACILITATOR_PORT') ?? getEnvNumber('PORT') ?? 3402}`,
  kmsEnabled: getEnvVar('KMS_ENABLED') === 'true' || isProductionEnv(),
  kmsSecretId: getEnvVar('FACILITATOR_KMS_SECRET_ID'),
  facilitatorServiceAddress: getEnvVar('FACILITATOR_SERVICE_ADDRESS'),

  // Leaderboard (signing uses KMS via service ID)
  leaderboardSQLitDatabaseId:
    getEnvVar('LEADERBOARD_SQLIT_DATABASE_ID') ?? 'leaderboard',
  leaderboardDebug: !isProductionEnv(),
  leaderboardDomain:
    getEnvVar('LEADERBOARD_DOMAIN') ?? 'leaderboard.jejunetwork.org',
  leaderboardRepositories:
    getEnvVar('LEADERBOARD_REPOSITORIES') ?? 'jejunetwork/jeju',
  dwsApiUrl: getEnvVar('DWS_API_URL') ?? `http://${getLocalhostHost()}:4030`,
  leaderboardDataDir: getEnvVar('LEADERBOARD_DATA_DIR') ?? './data/leaderboard',
  leaderboardLlmModel:
    getEnvVar('LEADERBOARD_LLM_MODEL') ?? 'anthropic/claude-sonnet-4-5',

  // JNS Gateway
  gatewayUrl: getEnvVar('GATEWAY_URL'),
  wsPort: getEnvNumber('WS_PORT') ?? 4004,
  devMode:
    getEnvVar('DEV_MODE') === 'true' ||
    !isProductionEnv() ||
    getEnvVar('JEJU_DEV') === 'true' ||
    getEnvVar('JNS_DEV_PROXY') === 'true',
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
