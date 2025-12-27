import { createAppConfig, getEnvNumber, getEnvVar, isProductionEnv } from '@jejunetwork/config'

export interface WalletConfig {
  // Server
  port: number
  isProduction: boolean

  // Messaging
  farcasterHubUrl: string
  xmtpRelayUrl?: string
}

const { config, configure: setWalletConfig } = createAppConfig<WalletConfig>({
  // Server
  port: getEnvNumber('PORT') ?? 4100,
  isProduction: isProductionEnv(),

  // Messaging
  farcasterHubUrl: getEnvVar('FARCASTER_HUB_URL') ?? 'https://hub.pinata.cloud',
  xmtpRelayUrl: getEnvVar('XMTP_RELAY_URL'),
})

export { config }
export function configureWallet(updates: Partial<WalletConfig>): void {
  setWalletConfig(updates)
}
