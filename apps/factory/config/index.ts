export * from './wagmi';
export * from './contracts';

// API endpoints
export const DWS_API_URL = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4350/graphql';
export const MESSAGING_URL = process.env.NEXT_PUBLIC_MESSAGING_URL || 'http://localhost:3200';

// External integrations
export const GITHUB_API_URL = 'https://api.github.com';
export const LINEAR_API_URL = 'https://api.linear.app/graphql';
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
export const FARCASTER_HUB_URL = process.env.FARCASTER_HUB_URL || 'https://hub.pinata.cloud';
export const NEYNAR_API_URL = 'https://api.neynar.com/v2';

// Factory channel on Farcaster
export const FACTORY_CHANNEL_ID = process.env.NEXT_PUBLIC_FACTORY_CHANNEL || 'factory';

// Feature flags
export const FEATURES = {
  githubIntegration: !!process.env.GITHUB_TOKEN,
  linearIntegration: !!process.env.LINEAR_API_KEY,
  npmIntegration: !!process.env.NPM_TOKEN,
  farcasterIntegration: !!process.env.NEYNAR_API_KEY,
};

