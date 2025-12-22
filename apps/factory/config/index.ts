// NOTE: wagmi config is client-only - import directly from './wagmi' in client components
// export * from './wagmi';  // Removed - causes server/client boundary issues in Next.js 16
export * from './contracts';

// ============ Jeju Internal Services ============
export const DWS_API_URL = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4350/graphql';
export const MESSAGING_URL = process.env.NEXT_PUBLIC_MESSAGING_URL || 'http://localhost:3200';
export const CRUCIBLE_URL = process.env.NEXT_PUBLIC_CRUCIBLE_URL || 'http://localhost:4020';
export const AUTOCRAT_URL = process.env.NEXT_PUBLIC_AUTOCRAT_URL || 'http://localhost:4040';
export const KMS_ENDPOINT = process.env.NEXT_PUBLIC_KMS_ENDPOINT || 'http://localhost:4035';

// ============ External Integrations ============
export const GITHUB_API_URL = 'https://api.github.com';
export const LINEAR_API_URL = 'https://api.linear.app/graphql';
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
export const FARCASTER_HUB_URL = process.env.FARCASTER_HUB_URL || 'https://hub.pinata.cloud';
export const NEYNAR_API_URL = process.env.NEXT_PUBLIC_NEYNAR_API_URL || 'https://api.neynar.com/v2';

// Factory channel on Farcaster
export const FACTORY_CHANNEL_ID = process.env.NEXT_PUBLIC_FACTORY_CHANNEL || 'factory';

// ============ Feature Flags ============
export const FEATURES = {
  // Web2 integrations (require MPC KMS secrets)
  githubIntegration: true,
  linearIntegration: true,
  npmIntegration: true,
  
  // Social features
  farcasterIntegration: !!process.env.NEYNAR_API_KEY,
  messaging: true,
  
  // Agent features
  crucibleIntegration: true,
  agentHiring: true,
  guardianValidation: true,
  
  // Governance features
  autocratIntegration: true,
  aiGovernance: true,
  disputeResolution: true,
  
  // Decentralized features
  mpcKms: true,
  jnsHosting: true,
  ipfsStorage: true,
};

// ============ JNS Configuration ============
export const JNS_CONFIG = {
  name: 'factory.jeju',
  gateway: process.env.NEXT_PUBLIC_JNS_GATEWAY || 'https://jns.jejunetwork.org',
  resolver: process.env.NEXT_PUBLIC_JNS_RESOLVER || '0x0000000000000000000000000000000000000000',
};

