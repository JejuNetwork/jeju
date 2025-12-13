/**
 * Commitment Store for JejuDA
 * Maps commitments to CIDs with persistence
 */

import type { CommitmentData } from './types';
import { mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';

export class CommitmentStore {
  private cache: Map<string, CommitmentData>;
  private dataDir: string;

  constructor(dataDir: string) {
    this.cache = new Map();
    this.dataDir = dataDir;
  }

  /**
   * Initialize the store and load existing commitments
   */
  async init(): Promise<void> {
    const commitmentDir = `${this.dataDir}/commitments`;

    // Create directory if it doesn't exist
    if (!existsSync(commitmentDir)) {
      await mkdir(commitmentDir, { recursive: true });
    }

    // Load existing commitments
    const files = await readdir(commitmentDir).catch(() => []);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const commitment = file.replace('.json', '');
        await this.load(commitment);
      }
    }

    console.log(`[Store] Loaded ${this.cache.size} commitments from disk`);
  }

  /**
   * Store a commitment -> CID mapping
   */
  async set(commitment: string, cid: string, size?: number): Promise<void> {
    const data: CommitmentData = {
      cid,
      timestamp: Date.now(),
      size,
    };

    // Cache in memory
    this.cache.set(commitment, data);

    // Persist to disk
    const file = Bun.file(`${this.dataDir}/commitments/${commitment}.json`);
    await Bun.write(file, JSON.stringify(data));
  }

  /**
   * Get CID by commitment
   */
  get(commitment: string): CommitmentData | undefined {
    return this.cache.get(commitment);
  }

  /**
   * Check if commitment exists
   */
  has(commitment: string): boolean {
    return this.cache.has(commitment);
  }

  /**
   * Load a commitment from disk
   */
  private async load(commitment: string): Promise<CommitmentData | undefined> {
    const file = Bun.file(`${this.dataDir}/commitments/${commitment}.json`);

    if (await file.exists()) {
      const data = (await file.json()) as CommitmentData;
      this.cache.set(commitment, data);
      return data;
    }

    return undefined;
  }

  /**
   * Try to load a commitment that might not be in cache
   */
  async loadIfMissing(commitment: string): Promise<CommitmentData | undefined> {
    if (this.cache.has(commitment)) {
      return this.cache.get(commitment);
    }
    return this.load(commitment);
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all commitments (for backup/export)
   */
  getAll(): Map<string, CommitmentData> {
    return new Map(this.cache);
  }
}






