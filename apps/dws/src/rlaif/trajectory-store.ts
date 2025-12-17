/**
 * Trajectory Store for Jeju DWS
 *
 * CID-first storage for trajectories, rewards, and training artifacts.
 * Uses Jeju Storage (IPFS) for decentralized persistence.
 */

import { keccak256, toHex } from 'viem';
import type { Hex } from 'viem';
import type { JudgeScore, Trajectory, TrajectoryManifest } from './types';

export interface TrajectoryStoreConfig {
  storageApiUrl: string;
}

export class TrajectoryStore {
  private config: TrajectoryStoreConfig;

  constructor(config: TrajectoryStoreConfig) {
    this.config = config;
  }

  async storeTrajectory(trajectory: Trajectory): Promise<string> {
    const data = JSON.stringify(trajectory);
    const response = await fetch(`${this.config.storageApiUrl}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data,
    });

    if (!response.ok) {
      throw new Error(`Failed to store trajectory: ${response.status}`);
    }

    const result = (await response.json()) as { cid: string };
    return result.cid;
  }

  async storeTrajectories(trajectories: Trajectory[]): Promise<TrajectoryManifest> {
    const trajectoryCIDs: string[] = [];

    for (const trajectory of trajectories) {
      const cid = await this.storeTrajectory(trajectory);
      trajectoryCIDs.push(cid);
    }

    const merkleRoot = this.computeMerkleRoot(trajectoryCIDs);
    
    const manifest: TrajectoryManifest = {
      cid: '',
      trajectoryCIDs,
      totalCount: trajectories.length,
      environmentId: trajectories[0]?.environmentId ?? '',
      policyModelCID: trajectories[0]?.policyModelCID ?? '',
      createdAt: Date.now(),
      merkleRoot,
    };

    const manifestData = JSON.stringify(manifest);
    const response = await fetch(`${this.config.storageApiUrl}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: manifestData,
    });

    if (!response.ok) {
      throw new Error(`Failed to store manifest: ${response.status}`);
    }

    const result = (await response.json()) as { cid: string };
    manifest.cid = result.cid;

    return manifest;
  }

  async loadTrajectory(cid: string): Promise<Trajectory> {
    const response = await fetch(`${this.config.storageApiUrl}/get/${cid}`);
    if (!response.ok) {
      throw new Error(`Failed to load trajectory ${cid}: ${response.status}`);
    }
    return (await response.json()) as Trajectory;
  }

  async loadManifest(manifestCID: string): Promise<TrajectoryManifest> {
    const response = await fetch(`${this.config.storageApiUrl}/get/${manifestCID}`);
    if (!response.ok) {
      throw new Error(`Failed to load manifest ${manifestCID}: ${response.status}`);
    }
    return (await response.json()) as TrajectoryManifest;
  }

  async loadTrajectories(manifestCID: string): Promise<Trajectory[]> {
    const manifest = await this.loadManifest(manifestCID);
    const trajectories: Trajectory[] = [];

    for (const cid of manifest.trajectoryCIDs) {
      const trajectory = await this.loadTrajectory(cid);
      trajectories.push(trajectory);
    }

    return trajectories;
  }

  async sampleTrajectories(
    manifestCID: string,
    count: number,
    seed?: number
  ): Promise<Trajectory[]> {
    const manifest = await this.loadManifest(manifestCID);
    
    const indices = this.deterministicSample(
      manifest.trajectoryCIDs.length,
      count,
      seed ?? Date.now()
    );

    const trajectories: Trajectory[] = [];
    for (const idx of indices) {
      const cid = manifest.trajectoryCIDs[idx];
      if (cid) {
        const trajectory = await this.loadTrajectory(cid);
        trajectories.push(trajectory);
      }
    }

    return trajectories;
  }

  async storeRewards(scores: JudgeScore[]): Promise<string> {
    const data = JSON.stringify({
      type: 'rewards',
      scores,
      createdAt: Date.now(),
    });

    const response = await fetch(`${this.config.storageApiUrl}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data,
    });

    if (!response.ok) {
      throw new Error(`Failed to store rewards: ${response.status}`);
    }

    const result = (await response.json()) as { cid: string };
    return result.cid;
  }

  async loadRewards(cid: string): Promise<JudgeScore[]> {
    const response = await fetch(`${this.config.storageApiUrl}/get/${cid}`);
    if (!response.ok) {
      throw new Error(`Failed to load rewards ${cid}: ${response.status}`);
    }
    const data = (await response.json()) as { scores: JudgeScore[] };
    return data.scores;
  }

  async storeModel(modelData: Uint8Array, metadata: Record<string, unknown>): Promise<string> {
    const formData = new FormData();
    formData.append('model', new Blob([modelData]));
    formData.append('metadata', JSON.stringify(metadata));

    const response = await fetch(`${this.config.storageApiUrl}/upload/model`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to store model: ${response.status}`);
    }

    const result = (await response.json()) as { cid: string };
    return result.cid;
  }

  private computeMerkleRoot(cids: string[]): Hex {
    if (cids.length === 0) {
      return '0x0000000000000000000000000000000000000000000000000000000000000000';
    }

    let leaves = cids.map((cid) => keccak256(toHex(cid)));

    while (leaves.length > 1) {
      const newLeaves: Hex[] = [];
      for (let i = 0; i < leaves.length; i += 2) {
        const left = leaves[i]!;
        const right = leaves[i + 1] ?? left;
        const combined = (left < right ? left + right.slice(2) : right + left.slice(2)) as Hex;
        newLeaves.push(keccak256(combined));
      }
      leaves = newLeaves;
    }

    return leaves[0]!;
  }

  private deterministicSample(total: number, count: number, seed: number): number[] {
    const sampleCount = Math.min(count, total);
    const indices: number[] = [];
    const available = Array.from({ length: total }, (_, i) => i);

    let s = seed;
    for (let i = 0; i < sampleCount; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const idx = s % available.length;
      indices.push(available[idx]!);
      available.splice(idx, 1);
    }

    return indices.sort((a, b) => a - b);
  }
}

export function createTrajectoryStore(config: TrajectoryStoreConfig): TrajectoryStore {
  return new TrajectoryStore(config);
}

