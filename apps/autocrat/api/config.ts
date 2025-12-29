/**
 * Autocrat App Configuration
 * Centralized config injection for workerd compatibility
 */

import {
  createAppConfig,
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

  // Operator/Private Keys
  operatorKey?: string
  privateKey?: string

  // EQLite Database
  eqliteDatabaseId: string

  // API Keys
  autocratApiKey?: string
  cloudApiKey?: string

  // TEE
  teePlatform?: string
  teeEncryptionSecret?: string

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

  // Environment
  isProduction: boolean
  nodeEnv: string
}

const { config, configure: setAutocratConfig } =
  createAppConfig<AutocratConfig>({
    rpcUrl: getEnvVar('RPC_URL') ?? '',
    network: (getEnvVar('JEJU_NETWORK') ?? 'testnet') as
      | 'mainnet'
      | 'testnet'
      | 'localnet',
    defaultDao: getEnvVar('DEFAULT_DAO') ?? 'jeju',
    directorModelId: getEnvVar('DIRECTOR_MODEL_ID') ?? 'claude-opus-4-5',
    operatorKey: getEnvVar('OPERATOR_KEY'),
    privateKey: getEnvVar('PRIVATE_KEY'),
    eqliteDatabaseId: getEnvVar('EQLITE_DATABASE_ID') ?? 'autocrat',
    autocratApiKey: getEnvVar('AUTOCRAT_API_KEY'),
    cloudApiKey: getEnvVar('CLOUD_API_KEY'),
    teePlatform: getEnvVar('TEE_PLATFORM'),
    teeEncryptionSecret: getEnvVar('TEE_ENCRYPTION_SECRET'),
    ollamaUrl:
      getEnvVar('OLLAMA_URL') ?? `http://${getLocalhostHost()}:11434`,
    ollamaModel: getEnvVar('OLLAMA_MODEL') ?? 'llama3.2',
    computeModel: getEnvVar('COMPUTE_MODEL'),
    orchestratorCron: getEnvVar('ORCHESTRATOR_CRON') ?? '*/30 * * * * *',
    sandboxMaxTime: getEnvNumber('SANDBOX_MAX_TIME') ?? 3600,
    sandboxMaxMemory: getEnvNumber('SANDBOX_MAX_MEMORY') ?? 8192,
    sandboxMaxCpu: getEnvNumber('SANDBOX_MAX_CPU') ?? 4,
    farcasterHubUrl:
      getEnvVar('FARCASTER_HUB_URL') ?? 'https://hub.pinata.cloud',
    isProduction: isProductionEnv(),
    nodeEnv: getEnvVar('NODE_ENV') ?? 'development',
  })

export { config }

export function configureAutocrat(updates: Partial<AutocratConfig>): void {
  setAutocratConfig(updates)
}
