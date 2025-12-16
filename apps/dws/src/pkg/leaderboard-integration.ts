/**
 * Leaderboard Integration for JejuPkg Registry
 */

import type { Address, Hex } from 'viem';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';

const ACTIVITY_SCORES: Record<string, number> = {
  publish: 25,
  download: 0.01,
  deprecate: 5,
  transfer: 10,
};

export type PkgActivityType = keyof typeof ACTIVITY_SCORES;

async function postToLeaderboard(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  const response = await fetch(`${GATEWAY_URL}/leaderboard/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-jeju-service': 'dws-pkg' },
    body: JSON.stringify(body),
  }).catch((err: Error) => {
    console.warn(`[Pkg Leaderboard] Failed to post to ${endpoint}: ${err.message}`);
    return null;
  });
  
  if (response && !response.ok) {
    console.warn(`[Pkg Leaderboard] POST to ${endpoint} returned ${response.status}`);
  }
  
  return response?.ok ?? false;
}

export function recordPackagePublish(
  walletAddress: Address,
  packageId: Hex,
  packageName: string,
  version: string
): Promise<boolean> {
  return postToLeaderboard('contributions/jeju-pkg', {
    walletAddress,
    source: 'jeju-pkg',
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
  walletAddress: Address,
  packageId: Hex,
  packageName: string,
  version: string
): Promise<boolean> {
  return postToLeaderboard('contributions/jeju-pkg', {
    walletAddress,
    source: 'jeju-pkg',
    score: ACTIVITY_SCORES.download,
    contribution: {
      type: 'download',
      packageId,
      packageName,
      timestamp: Date.now(),
      metadata: { version },
    },
  });
}

export function recordPackageDeprecation(
  walletAddress: Address,
  packageId: Hex,
  packageName: string
): Promise<boolean> {
  return postToLeaderboard('contributions/jeju-pkg', {
    walletAddress,
    source: 'jeju-pkg',
    score: ACTIVITY_SCORES.deprecate,
    contribution: {
      type: 'deprecate',
      packageId,
      packageName,
      timestamp: Date.now(),
      metadata: {},
    },
  });
}

