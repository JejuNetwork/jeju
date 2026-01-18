import { join } from 'node:path'
import {
  CORE_PORTS,
  createAppConfig,
  getDWSUrl,
  getEnvNumber,
  getEnvVar,
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitUrl,
} from '@jejunetwork/config'
import type { Address, Hex } from 'viem'

export interface FactoryConfig {
  port: number
  isDev: boolean
  dwsUrl: string
  rpcUrl: string
  identityRegistryAddress?: Address
  factoryDataDir: string
  signerEncryptionKey?: string
  factoryChannelId: string
  dcRelayUrl: string
  // SQLit configuration
  sqlitEndpoint: string
  sqlitDatabaseId: string
  sqlitPrivateKey?: Hex
}

function getEnvHex(key: string): Hex | undefined {
  const value = getEnvVar(key)
  if (!value) return undefined
  if (!value.startsWith('0x')) {
    throw new Error(`[factory] ${key} must be a 0x-prefixed hex string`)
  }
  return value as Hex
}

const { config, configure } = createAppConfig<FactoryConfig>({
  port: getEnvNumber('PORT') ?? CORE_PORTS.FACTORY.get(),
  isDev: getEnvVar('NODE_ENV') !== 'production',
  dwsUrl: getEnvVar('DWS_URL') || getDWSUrl(),
  rpcUrl: getEnvVar('RPC_URL') || getL2RpcUrl(),
  identityRegistryAddress: undefined,
  factoryDataDir:
    getEnvVar('FACTORY_DATA_DIR') ||
    (typeof process !== 'undefined'
      ? join(process.cwd(), 'data')
      : '/tmp/factory-data'),
  signerEncryptionKey: getEnvVar('SIGNER_ENCRYPTION_KEY'),
  factoryChannelId: getEnvVar('FACTORY_CHANNEL_ID') || 'factory',
  dcRelayUrl: getEnvVar('DC_RELAY_URL') || `http://${getLocalhostHost()}:3300`,
  // SQLit configuration with sensible defaults
  sqlitEndpoint: getEnvVar('SQLIT_ENDPOINT') || getSQLitUrl(),
  sqlitDatabaseId: getEnvVar('SQLIT_DATABASE_ID') || 'factory',
  sqlitPrivateKey: getEnvHex('SQLIT_PRIVATE_KEY'),
})

export function configureFactory(configUpdates: Partial<FactoryConfig>): void {
  configure(configUpdates)
}

export function getFactoryConfig(): FactoryConfig {
  return config
}
