/**
 * Leaderboard Integration for Jeju Git
 * Syncs git contributions to the leaderboard system
 */

import type { Address, Hex } from 'viem';
import type { ContributionEvent, ContributionType } from './types';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';
const SYNC_INTERVAL = 60000;

interface GitContribution {
  username: string;
  walletAddress: Address;
  repoId: Hex;
  repoName: string;
  type: ContributionType;
  timestamp: number;
  metadata: {
    branch?: string;
    commitCount?: number;
    message?: string;
    prNumber?: number;
    issueNumber?: number;
  };
}

interface ContributionScores {
  commits: number;
  prs: number;
  issues: number;
  reviews: number;
}

function calculateScores(contributions: GitContribution[]): ContributionScores {
  return contributions.reduce(
    (scores, c) => {
      switch (c.type) {
        case 'commit':
          scores.commits += c.metadata.commitCount || 1;
          break;
        case 'merge':
        case 'pr_merge':
          scores.prs += 1;
          break;
        case 'pr_open':
          scores.prs += 0.5;
          break;
        case 'issue_open':
        case 'issue_close':
          scores.issues += 1;
          break;
        case 'pr_review':
          scores.reviews += 1;
          break;
        case 'branch':
        case 'star':
        case 'fork':
          // These don't directly contribute to the core scores
          break;
      }
      return scores;
    },
    { commits: 0, prs: 0, issues: 0, reviews: 0 }
  );
}

class LeaderboardIntegration {
  private pending: GitContribution[] = [];
  private walletMap = new Map<Address, string>();
  private timer: Timer | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sync(), SYNC_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  record(contribution: GitContribution): void {
    this.pending.push(contribution);
  }

  processEvents(events: ContributionEvent[]): void {
    for (const event of events) {
      const username = this.walletMap.get(event.author);
      if (!username) continue;

      this.record({
        username,
        walletAddress: event.author,
        repoId: event.repoId,
        repoName: '',
        type: event.type,
        timestamp: event.timestamp,
        metadata: event.metadata,
      });
    }
  }

  linkWallet(wallet: Address, username: string): void {
    this.walletMap.set(wallet.toLowerCase() as Address, username);
  }

  getUsername(wallet: Address): string | undefined {
    return this.walletMap.get(wallet.toLowerCase() as Address);
  }

  getLocalStats(wallet: Address): ContributionScores & { lastActive: number } {
    const username = this.walletMap.get(wallet.toLowerCase() as Address);
    if (!username) return { commits: 0, prs: 0, issues: 0, reviews: 0, lastActive: 0 };

    const userContributions = this.pending.filter((c) => c.username === username);
    const scores = calculateScores(userContributions);
    const lastActive = Math.max(0, ...userContributions.map((c) => c.timestamp));

    return { ...scores, lastActive };
  }

  async fetchMappings(): Promise<void> {
    const response = await fetch(`${GATEWAY_URL}/leaderboard/api/wallet-mappings`).catch((err: Error) => {
      console.warn(`[Git Leaderboard] Failed to fetch wallet mappings: ${err.message}`);
      return null;
    });
    
    if (!response?.ok) {
      if (response) {
        console.warn(`[Git Leaderboard] Wallet mappings returned ${response.status}`);
      }
      return;
    }

    const data = (await response.json()) as { mappings: Array<{ walletAddress: string; username: string }> };
    for (const m of data.mappings) {
      this.walletMap.set(m.walletAddress.toLowerCase() as Address, m.username);
    }
  }

  private async sync(): Promise<void> {
    if (this.pending.length === 0) return;

    const batch = this.pending.splice(0);
    const byUser = new Map<string, GitContribution[]>();
    for (const c of batch) {
      const existing = byUser.get(c.username);
      if (existing) {
        existing.push(c);
      } else {
        byUser.set(c.username, [c]);
      }
    }

    for (const [username, contributions] of byUser) {
      const ok = await this.syncUser(username, contributions);
      if (!ok) this.pending.push(...contributions);
    }
  }

  private async syncUser(username: string, contributions: GitContribution[]): Promise<boolean> {
    const response = await fetch(`${GATEWAY_URL}/leaderboard/api/contributions/jeju-git`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-jeju-service': 'dws-git' },
      body: JSON.stringify({
        username,
        source: 'jeju-git',
        scores: calculateScores(contributions),
        contributions: contributions.map((c) => ({
          type: c.type,
          repoId: c.repoId,
          timestamp: c.timestamp,
          metadata: c.metadata,
        })),
        timestamp: Date.now(),
      }),
    }).catch((err: Error) => {
      console.warn(`[Git Leaderboard] Failed to sync user ${username}: ${err.message}`);
      return null;
    });

    if (response && !response.ok) {
      console.warn(`[Git Leaderboard] Sync for ${username} returned ${response.status}`);
    }

    return response?.ok ?? false;
  }
}

export const leaderboardIntegration = new LeaderboardIntegration();

export function trackGitContribution(
  wallet: Address,
  repoId: Hex,
  repoName: string,
  type: ContributionType,
  metadata: GitContribution['metadata'] = {}
): void {
  const username = leaderboardIntegration.getUsername(wallet);
  if (!username) {
    leaderboardIntegration.fetchMappings();
    return;
  }

  leaderboardIntegration.record({
    username,
    walletAddress: wallet,
    repoId,
    repoName,
    type,
    timestamp: Date.now(),
    metadata,
  });
}
