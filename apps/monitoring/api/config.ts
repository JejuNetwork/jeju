import {
  createAppConfig,
  getEnvNumber,
  getEnvVar,
  isProductionEnv,
} from '@jejunetwork/config'

export interface MonitoringConfig {
  // Server
  port: number
  a2aPort: number
  isProduction: boolean
  corsOrigins: string[]

  // URLs
  prometheusUrl: string
  oifAggregatorUrl: string
  rpcUrl: string

  // Identity
  privateKey?: string
  identityRegistryAddress?: string
}

const { config, configure: setMonitoringConfig } =
  createAppConfig<MonitoringConfig>({
    // Server
    port: getEnvNumber('PORT') ?? 9091,
    a2aPort: getEnvNumber('A2A_PORT') ?? 9091,
    isProduction: isProductionEnv(),
    corsOrigins: (
      getEnvVar('CORS_ORIGINS') ?? 'http://localhost:3000,http://localhost:4020'
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),

    // URLs
    prometheusUrl: getEnvVar('PROMETHEUS_URL') ?? 'http://localhost:9090',
    oifAggregatorUrl:
      getEnvVar('OIF_AGGREGATOR_URL') ?? 'http://localhost:4010',
    rpcUrl: getEnvVar('RPC_URL') ?? 'http://localhost:8545',

    // Identity
    privateKey: getEnvVar('PRIVATE_KEY'),
    identityRegistryAddress: getEnvVar('IDENTITY_REGISTRY_ADDRESS'),
  })

export { config }
export function configureMonitoring(updates: Partial<MonitoringConfig>): void {
  setMonitoringConfig(updates)
}
