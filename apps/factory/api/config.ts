/**
 * Factory App Configuration
 *
 * Workerd-compatible config injection for Factory app.
 */

import { createAppConfig, getEnvVar, getEnvNumber } from '@jejunetwork/config'
import { CORE_PORTS, getCoreAppUrl, getDWSUrl, getL2RpcUrl } from '@jejunetwork/config'
import { join } from 'node:path'
import type { Address } from 'viem'

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
}

const { config, configure } = createAppConfig<FactoryConfig>({
  port: CORE_PORTS.FACTORY.get(),
  isDev: getEnvVar('NODE_ENV') !== 'production',
  dwsUrl: getEnvVar('DWS_URL') || getDWSUrl(),
  rpcUrl: getEnvVar('RPC_URL') || getL2RpcUrl(),
  identityRegistryAddress: undefined,
  factoryDataDir: getEnvVar('FACTORY_DATA_DIR') || (typeof process !== 'undefined' ? join(process.cwd(), 'data') : '/tmp/factory-data'),
  signerEncryptionKey: getEnvVar('SIGNER_ENCRYPTION_KEY'),
  factoryChannelId: getEnvVar('FACTORY_CHANNEL_ID') || 'factory',
  dcRelayUrl: getEnvVar('DC_RELAY_URL') || 'http://localhost:3300',
})

export function configureFactory(configUpdates: Partial<FactoryConfig>): void {
  configure(configUpdates)
}

export function getFactoryConfig(): FactoryConfig {
  return config
}
