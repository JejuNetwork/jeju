/**
 * Mode Detection for Elizagotchi
 * Determines if running in local or cloud mode
 */

export type RunMode = 'local' | 'cloud';

export function detectRunMode(): RunMode {
  // Check environment variable first
  if (process.env.ELIZAGOTCHI_MODE) {
    return process.env.ELIZAGOTCHI_MODE as RunMode;
  }

  // Check if Privy credentials are configured
  const hasPrivy = !!(
    process.env.NEXT_PUBLIC_PRIVY_APP_ID &&
    process.env.PRIVY_APP_SECRET
  );

  // Check if running in Tauri (desktop)
  const isTauri = !!(
    process.env.TAURI_PLATFORM ||
    process.env.TAURI_ENV_PLATFORM ||
    typeof (globalThis as { __TAURI__?: unknown }).__TAURI__ !== 'undefined'
  );

  // Desktop without Privy = local mode
  if (isTauri && !hasPrivy) {
    return 'local';
  }

  // Has Privy = cloud mode
  if (hasPrivy) {
    return 'cloud';
  }

  // Default to local for development
  return 'local';
}

export function requiresAuth(): boolean {
  return detectRunMode() === 'cloud';
}

export function getMode

Config(): {
  mode: RunMode;
  requiresAuth: boolean;
  canUseLocalBlockchain: boolean;
  canUseCloudProxy: boolean;
} {
  const mode = detectRunMode();
  
  return {
    mode,
    requiresAuth: mode === 'cloud',
    canUseLocalBlockchain: mode === 'local',
    canUseCloudProxy: mode === 'cloud'
  };
}

