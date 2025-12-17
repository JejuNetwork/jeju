/**
 * Leaderboard Integration for JejuPkg Registry
 * Includes retry logic and error handling
 */

import type { Address, Hex } from 'viem';
import type { PkgActivityType } from './types';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const ACTIVITY_SCORES: Record<PkgActivityType, number> = {
  publish: 25,
  download: 0.01,
  deprecate: 5,
  transfer: 10,
  star: 2,
};

interface QueuedEvent {
  endpoint: string;
  body: Record<string, unknown>;
  retries: number;
  timestamp: number;
}

class LeaderboardQueue {
  private queue: QueuedEvent[] = [];
  private processing = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    // Process queue every 5 seconds
    this.intervalId = setInterval(() => this.processQueue(), 5000);
  }

  async add(endpoint: string, body: Record<string, unknown>): Promise<void> {
    this.queue.push({
      endpoint,
      body,
      retries: 0,
      timestamp: Date.now(),
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const batch = this.queue.splice(0, 10); // Process up to 10 at a time

    for (const event of batch) {
      const success = await postToLeaderboardWithRetry(event.endpoint, event.body, event.retries);
      if (!success && event.retries < MAX_RETRIES) {
        // Re-queue with incremented retry count
        event.retries++;
        this.queue.push(event);
      } else if (!success) {
        console.error(`[Pkg Leaderboard] Failed to post to ${event.endpoint} after ${MAX_RETRIES} retries`);
      }
    }

    this.processing = false;
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

const leaderboardQueue = new LeaderboardQueue();

async function postToLeaderboardWithRetry(
  endpoint: string,
  body: Record<string, unknown>,
  retryCount: number
): Promise<boolean> {
  const delay = retryCount * RETRY_DELAY_MS;
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(`${GATEWAY_URL}/leaderboard/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-jeju-service': 'dws-pkg' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.warn(`[Pkg Leaderboard] POST to ${endpoint} returned ${response.status}: ${errorText}`);
      return false;
    }

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (retryCount < MAX_RETRIES) {
      console.debug(`[Pkg Leaderboard] Retry ${retryCount + 1}/${MAX_RETRIES} for ${endpoint}: ${errorMessage}`);
    } else {
      console.error(`[Pkg Leaderboard] Failed to post to ${endpoint} after retries: ${errorMessage}`);
    }
    return false;
  }
}

async function postToLeaderboard(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  // Queue the event for async processing with retries
  await leaderboardQueue.add(endpoint, body);
  return true; // Return immediately, processing happens async
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

