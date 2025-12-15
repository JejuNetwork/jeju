import type { Hex, Address } from 'viem';

// Vite exposes env vars via import.meta.env with VITE_ prefix
const env = import.meta.env;

export const OAUTH3_CONFIG = {
  // TEE Auth Agent (runs alongside the demo app)
  teeAgentUrl: env.VITE_TEE_AGENT_URL || 'http://localhost:4200',
  
  // Chain configuration
  chainId: parseInt(env.VITE_CHAIN_ID || '420691'),
  rpcUrl: env.VITE_JEJU_RPC_URL || 'http://localhost:9545',
  
  // Contract addresses (deployed to localnet)
  contracts: {
    identityRegistry: (env.VITE_IDENTITY_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    appRegistry: (env.VITE_APP_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    teeVerifier: (env.VITE_TEE_VERIFIER_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    accountFactory: (env.VITE_ACCOUNT_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address,
  },
  
  // Demo app OAuth config
  appId: (env.VITE_OAUTH3_APP_ID || '0x0000000000000000000000000000000000000000000000000000000000000001') as Hex,
  redirectUri: env.VITE_OAUTH3_REDIRECT_URI || 'http://localhost:4100/auth/callback',
  
  // OAuth providers (client IDs only - secrets stay server-side)
  providers: {
    discord: {
      enabled: true,
      clientId: env.VITE_OAUTH_DISCORD_CLIENT_ID || '',
    },
    google: {
      enabled: !!env.VITE_OAUTH_GOOGLE_CLIENT_ID,
      clientId: env.VITE_OAUTH_GOOGLE_CLIENT_ID || '',
    },
    farcaster: {
      enabled: true,
    },
  },
};

export type OAuth3Config = typeof OAUTH3_CONFIG;
