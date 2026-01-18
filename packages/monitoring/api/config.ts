import {
  CORE_PORTS,
  createAppConfig,
  getCurrentNetwork,
  getEnvNumber,
  getEnvVar,
  getLocalhostHost,
  getRpcUrl,
  getServiceUrl,
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

const network = getCurrentNetwork()
const uiPort = CORE_PORTS.MONITORING.get()
const apiPort = uiPort + 1

const { config, configure: setMonitoringConfig } =
  createAppConfig<MonitoringConfig>({
    // Server
    port: getEnvNumber('PORT') ?? apiPort,
    a2aPort: getEnvNumber('A2A_PORT') ?? apiPort,
    isProduction: isProductionEnv(),
    corsOrigins: (() => {
      const host = getLocalhostHost()
      return (
        getEnvVar('CORS_ORIGINS') ??
        `http://${host}:${uiPort},http://${host}:4020`
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    })(),

    // URLs
    prometheusUrl: (() => {
      return (
        getEnvVar('PROMETHEUS_URL') ??
        getServiceUrl('monitoring', 'prometheus', network)
      )
    })(),
    oifAggregatorUrl: (() => {
      return (
        getEnvVar('OIF_AGGREGATOR_URL') ??
        getServiceUrl('oif', 'aggregator', network)
      )
    })(),
    rpcUrl: (() => {
      return getEnvVar('RPC_URL') ?? getRpcUrl(network)
    })(),

    // Identity
    privateKey: getEnvVar('PRIVATE_KEY'),
    identityRegistryAddress: getEnvVar('IDENTITY_REGISTRY_ADDRESS'),
  })

export { config }
export function configureMonitoring(updates: Partial<MonitoringConfig>): void {
  setMonitoringConfig(updates)
}
