import { createAppConfig, getEnvNumber, getEnvVar, isProductionEnv } from '@jejunetwork/config'

export interface OAuth3Config {
  // Server
  port: number
  isProduction: boolean

  // Chain
  rpcUrl: string
  mpcRegistryAddress?: string
  identityRegistryAddress?: string

  // Auth
  serviceAgentId: string
  jwtSecret: string
  sessionDuration: number
  allowedOrigins: string[]

  // EQLite
  eqliteDatabaseId: string

  // OAuth providers
  githubClientId?: string
  githubClientSecret?: string
  googleClientId?: string
  googleClientSecret?: string
  twitterClientId?: string
  twitterClientSecret?: string
  discordClientId?: string
  discordClientSecret?: string

  // Base URL
  baseUrl: string
}

const { config, configure: setOAuth3Config } = createAppConfig<OAuth3Config>({
  // Server
  port: getEnvNumber('PORT') ?? 4200,
  isProduction: isProductionEnv(),

  // Chain
  rpcUrl: getEnvVar('RPC_URL') ?? 'http://localhost:8545',
  mpcRegistryAddress: getEnvVar('MPC_REGISTRY_ADDRESS'),
  identityRegistryAddress: getEnvVar('IDENTITY_REGISTRY_ADDRESS'),

  // Auth
  serviceAgentId: getEnvVar('SERVICE_AGENT_ID') ?? 'auth.jeju',
  jwtSecret: getEnvVar('JWT_SECRET') ?? 'dev-secret-change-in-production',
  sessionDuration: 24 * 60 * 60 * 1000, // 24 hours
  allowedOrigins: (getEnvVar('ALLOWED_ORIGINS') ?? '*').split(','),

  // EQLite
  eqliteDatabaseId: getEnvVar('EQLite_DATABASE_ID') ?? 'oauth3',

  // OAuth providers
  githubClientId: getEnvVar('GITHUB_CLIENT_ID'),
  githubClientSecret: getEnvVar('GITHUB_CLIENT_SECRET'),
  googleClientId: getEnvVar('GOOGLE_CLIENT_ID'),
  googleClientSecret: getEnvVar('GOOGLE_CLIENT_SECRET'),
  twitterClientId: getEnvVar('TWITTER_CLIENT_ID'),
  twitterClientSecret: getEnvVar('TWITTER_CLIENT_SECRET'),
  discordClientId: getEnvVar('DISCORD_CLIENT_ID'),
  discordClientSecret: getEnvVar('DISCORD_CLIENT_SECRET'),

  // Base URL
  baseUrl: getEnvVar('BASE_URL') ?? 'https://auth.jejunetwork.org',
})

export { config }
export function configureOAuth3(updates: Partial<OAuth3Config>): void {
  setOAuth3Config(updates)
}
