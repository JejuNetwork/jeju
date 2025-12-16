/**
 * Leaderboard Integration for Jeju NPM Registry
 */

import type { Address, Hex } from 'viem';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';

const ACTIVITY_SCORES: Record<string, number> = {
  publish: 25,
  download: 0.01,
  deprecate: 5,
  transfer: 10,
};

export type NpmActivityType = keyof typeof ACTIVITY_SCORES;

async function postToLeaderboard(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  const response = await fetch(`${GATEWAY_URL}/leaderboard/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-jeju-service': 'dws-npm' },
    body: JSON.stringify(body),
  }).catch((err: Error) => {
    console.warn(`[NPM Leaderboard] Failed to post to ${endpoint}: ${err.message}`);
    return null;
  });
  
  if (response && !response.ok) {
    console.warn(`[NPM Leaderboard] POST to ${endpoint} returned ${response.status}`);
  }
  
  return response?.ok ?? false;
}

export function recordPackagePublish(
  walletAddress: Address,
  packageId: Hex,
  packageName: string,
  version: string
): Promise<boolean> {
  return postToLeaderboard('contributions/jeju-npm', {
    walletAddress,
    source: 'jeju-npm',
    score: ACTIVITY_SCORES.publish,
    contribution: {
      type: 'publish',
      packageId,
      packageName,
      timestamp: Date.now(),
      metadata: { version },
    },
  });
}

export function recordPackageDownload(
  packageId: Hex,
  packageName: string,
  downloadCount: number
): Promise<boolean> {
  return postToLeaderboard('packages/downloads', {
    packageId,
    packageName,
    downloadCount,
    timestamp: Date.now(),
  });
}
