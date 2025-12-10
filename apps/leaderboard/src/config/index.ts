/**
 * Leaderboard App Configuration
 * 
 * Config-first architecture:
 * - Defaults based on network
 * - NEXT_PUBLIC_* env vars override at build time
 */

// Build-time network selection
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || 'localnet') as 'localnet' | 'testnet' | 'mainnet';

// GitHub OAuth (client ID is public, secret stays in server-side env)
export const GITHUB_CLIENT_ID = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '';

// Auth Worker URL (Cloudflare Worker for OAuth)
export const AUTH_WORKER_URL = process.env.NEXT_PUBLIC_AUTH_WORKER_URL || getDefaultAuthWorkerUrl();

function getDefaultAuthWorkerUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://auth.jeju.network';
    case 'testnet': return 'https://testnet-auth.jeju.network';
    default: return 'http://localhost:8787';
  }
}
