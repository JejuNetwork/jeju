import { createAppConfig, getEnvNumber, getEnvVar, isProductionEnv } from '@jejunetwork/config'

export interface VPNConfig {
  // Server
  port: number
  isProduction: boolean

  // URLs
  publicUrl: string
  coordinatorUrl: string
  rpcUrl: string

  // Chain
  chainId: number

  // Contracts
  vpnRegistryAddress?: string
  vpnBillingAddress?: string
  x402FacilitatorAddress?: string
  paymentRecipientAddress?: string
  paymentTokenAddress?: string

  // Pricing
  pricePerGB: string
  pricePerHour: string
  pricePerRequest: string
}

const { config, configure: setVPNConfig } = createAppConfig<VPNConfig>({
  // Server
  port: getEnvNumber('PORT') ?? 4050,
  isProduction: isProductionEnv(),

  // URLs
  publicUrl: getEnvVar('PUBLIC_URL') ?? `http://localhost:${getEnvNumber('PORT') ?? 4050}`,
  coordinatorUrl: getEnvVar('COORDINATOR_URL') ?? 'https://vpn-coordinator.jejunetwork.org',
  rpcUrl: getEnvVar('RPC_URL') ?? 'https://mainnet.base.org',

  // Chain
  chainId: getEnvNumber('CHAIN_ID') ?? 8453, // Base mainnet

  // Contracts
  vpnRegistryAddress: getEnvVar('VPN_REGISTRY_ADDRESS'),
  vpnBillingAddress: getEnvVar('VPN_BILLING_ADDRESS'),
  x402FacilitatorAddress: getEnvVar('X402_FACILITATOR_ADDRESS'),
  paymentRecipientAddress: getEnvVar('PAYMENT_RECIPIENT'),
  paymentTokenAddress: getEnvVar('PAYMENT_TOKEN'),

  // Pricing
  pricePerGB: getEnvVar('PRICE_PER_GB') ?? '1000000000000000', // 0.001 ETH
  pricePerHour: getEnvVar('PRICE_PER_HOUR') ?? '100000000000000', // 0.0001 ETH
  pricePerRequest: getEnvVar('PRICE_PER_REQUEST') ?? '10000000000000',
})

export { config }
export function configureVPN(updates: Partial<VPNConfig>): void {
  setVPNConfig(updates)
}
