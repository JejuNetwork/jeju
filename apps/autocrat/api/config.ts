import {
  createAppConfig,
  getCurrentNetwork,
  getEnvNumber,
  getEnvVar,
  getLocalhostHost,
  isProductionEnv,
} from '@jejunetwork/config'

export interface AutocratConfig {
  // Network
  rpcUrl: string
  network: 'mainnet' | 'testnet' | 'localnet'

  // DAO
  defaultDao: string
  directorModelId: string

  // SQLit Database
  sqlitDatabaseId: string

  // TEE
  teePlatform?: string
  teeEncryptionKeyId?: string // Key ID in KMS, not the raw secret
  teeEncryptionSecret?: string // Raw secret for local dev (localnet only)

  // Local Services
  ollamaUrl: string
  ollamaModel: string

  // Compute
  computeModel?: string
  orchestratorCron: string

  // Sandbox
  sandboxMaxTime: number
  sandboxMaxMemory: number
  sandboxMaxCpu: number

  // Messaging
  farcasterHubUrl: string

  // Authentication / Keys
  operatorKey?: string // Operator private key or address
  privateKey?: string // Private key for signing (localnet only)
  cloudApiKey?: string // Cloud API key for external services
  autocratApiKey?: string // Internal API key for autocrat service

  // Environment
  isProduction: boolean
  nodeEnv: string
}

// Get network value from shared config (defaults to localnet for dev)
const network = getCurrentNetwork()

const { config, configure: setAutocratConfig } =
  createAppConfig<AutocratConfig>({
    rpcUrl: getEnvVar('RPC_URL') ?? '',
    network,
    defaultDao: getEnvVar('DEFAULT_DAO') ?? 'jeju',
    directorModelId: getEnvVar('DIRECTOR_MODEL_ID') ?? 'claude-opus-4-5',
    sqlitDatabaseId: getEnvVar('SQLIT_DATABASE_ID') ?? 'autocrat',
    teePlatform: getEnvVar('TEE_PLATFORM'),
    teeEncryptionKeyId: getEnvVar('TEE_ENCRYPTION_KEY_ID'),
    // TEE encryption secret - only use raw secret in localnet for development
    teeEncryptionSecret:
      getEnvVar('TEE_ENCRYPTION_SECRET') ??
      (network === 'localnet' ? 'localnet-tee-secret-32-chars-min!' : undefined),
    ollamaUrl: getEnvVar('OLLAMA_URL') ?? `http://${getLocalhostHost()}:11434`,
    ollamaModel: getEnvVar('OLLAMA_MODEL') ?? 'llama3.2',
    computeModel: getEnvVar('COMPUTE_MODEL'),
    orchestratorCron: getEnvVar('ORCHESTRATOR_CRON') ?? '*/30 * * * * *',
    sandboxMaxTime: getEnvNumber('SANDBOX_MAX_TIME') ?? 3600,
    sandboxMaxMemory: getEnvNumber('SANDBOX_MAX_MEMORY') ?? 8192,
    sandboxMaxCpu: getEnvNumber('SANDBOX_MAX_CPU') ?? 4,
    farcasterHubUrl:
      getEnvVar('FARCASTER_HUB_URL') ?? 'https://hub.pinata.cloud',
    // Authentication / Keys - read from env, no defaults for security
    operatorKey: getEnvVar('OPERATOR_KEY') ?? getEnvVar('PRIVATE_KEY'),
    privateKey: getEnvVar('PRIVATE_KEY'),
    cloudApiKey: getEnvVar('CLOUD_API_KEY'),
    autocratApiKey: getEnvVar('AUTOCRAT_API_KEY'),
    isProduction: isProductionEnv(),
    nodeEnv: getEnvVar('NODE_ENV') ?? 'development',
  })

export { config }

export function configureAutocrat(updates: Partial<AutocratConfig>): void {
  setAutocratConfig(updates)
}
