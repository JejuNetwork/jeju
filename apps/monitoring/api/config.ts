import {
  createAppConfig,
  getEnvNumber,
  getEnvVar,
  getLocalhostHost,
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
    corsOrigins: (() => {
      const host = getLocalhostHost()
      return (
        getEnvVar('CORS_ORIGINS') ?? `http://${host}:3000,http://${host}:4020`
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    })(),

    // URLs
    prometheusUrl: (() => {
      const host = getLocalhostHost()
      return getEnvVar('PROMETHEUS_URL') ?? `http://${host}:9090`
    })(),
    oifAggregatorUrl: (() => {
      const host = getLocalhostHost()
      return getEnvVar('OIF_AGGREGATOR_URL') ?? `http://${host}:4010`
    })(),
    rpcUrl: (() => {
      const host = getLocalhostHost()
      return getEnvVar('RPC_URL') ?? `http://${host}:8545`
    })(),

    // Identity
    privateKey: getEnvVar('PRIVATE_KEY'),
    identityRegistryAddress: getEnvVar('IDENTITY_REGISTRY_ADDRESS'),
  })

export { config }
export function configureMonitoring(updates: Partial<MonitoringConfig>): void {
  setMonitoringConfig(updates)
}
