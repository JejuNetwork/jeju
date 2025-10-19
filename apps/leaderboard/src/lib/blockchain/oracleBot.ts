/**
 * Oracle Bot Service
 * 
 * Monitors monthly snapshots and submits them to FeeDistributorV2 contract.
 * Handles dispute period and finalization.
 */

import { BlockchainClient } from "./contractClient";
import { getLatestSnapshot, markSnapshotSubmitted, markSnapshotFinalized } from "./snapshotGenerator";
import type { Address } from "viem";

export interface OracleBotConfig {
  disputePeriodHours: number;  // Hours to wait before finalization
  checkIntervalMinutes: number; // How often to check for new snapshots
  maxRetries: number;
  retryDelayMs: number;
}

const DEFAULT_CONFIG: OracleBotConfig = {
  disputePeriodHours: 48,     // 48 hour dispute period
  checkIntervalMinutes: 60,    // Check every hour
  maxRetries: 3,
  retryDelayMs: 30000,        // 30 seconds between retries
};

/**
 * Oracle Bot for automated snapshot submission
 */
export class OracleBot {
  private client: BlockchainClient;
  private config: OracleBotConfig;
  private isRunning: boolean = false;

  constructor(client: BlockchainClient, config: Partial<OracleBotConfig> = {}) {
    this.client = client;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the oracle bot (runs indefinitely)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("⚠️  Oracle bot is already running");
      return;
    }

    this.isRunning = true;
    console.log("🤖 Oracle bot started");
    console.log(`   Dispute period: ${this.config.disputePeriodHours}h`);
    console.log(`   Check interval: ${this.config.checkIntervalMinutes}m`);

    while (this.isRunning) {
      await this.tick();
      
      // Wait for next check interval
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.checkIntervalMinutes * 60 * 1000),
      );
    }
  }

  /**
   * Stop the oracle bot
   */
  stop(): void {
    this.isRunning = false;
    console.log("🛑 Oracle bot stopped");
  }

  /**
   * Single tick - check and process snapshots
   */
  async tick(): Promise<void> {
    try {
      await this.processSnapshots();
    } catch (error) {
      console.error("❌ Error in oracle bot tick:", error);
    }
  }

  /**
   * Process snapshots - submit new ones, finalize old ones
   */
  private async processSnapshots(): Promise<void> {
    // Get latest snapshot from database
    const snapshot = await getLatestSnapshot();
    
    if (!snapshot) {
      console.log("📭 No snapshots found");
      return;
    }

    // Check if snapshot needs to be submitted
    const snapshotData = await this.client.getSnapshot(snapshot.period);
    
    if (!snapshotData.finalized && snapshotData.contributorCount === 0n) {
      // Snapshot not submitted yet
      console.log(`📤 Submitting snapshot for period ${snapshot.period}...`);
      await this.submitSnapshot(snapshot.period);
      return;
    }

    if (snapshotData.finalized) {
      console.log(`✅ Period ${snapshot.period} already finalized`);
      return;
    }

    // Check if dispute period has passed
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const disputePeriodSeconds = BigInt(this.config.disputePeriodHours * 3600);
    
    if (snapshotData.timestamp + disputePeriodSeconds <= currentTime) {
      // Dispute period passed, finalize
      console.log(`🔒 Finalizing snapshot for period ${snapshot.period}...`);
      await this.finalizeSnapshot(snapshot.period);
    } else {
      const remaining = Number(snapshotData.timestamp + disputePeriodSeconds - currentTime);
      const hoursRemaining = (remaining / 3600).toFixed(1);
      console.log(`⏳ Period ${snapshot.period} dispute period: ${hoursRemaining}h remaining`);
    }
  }

  /**
   * Submit snapshot to blockchain with retry logic
   */
  private async submitSnapshot(period: number): Promise<void> {
    const snapshot = await getLatestSnapshot();
    if (!snapshot || snapshot.period !== period) {
      throw new Error(`Snapshot for period ${period} not found`);
    }

    // Convert wallet addresses to Address type
    const contributors = snapshot.walletAddresses.map((addr) => addr as Address);
    const shares = snapshot.shares;

    // Submit with retries
    const hash = await this.executeWithRetry(
      async () => await this.client.submitMonthlySnapshot(period, contributors, shares),
      `Submit snapshot period ${period}`,
    );

    // Wait for confirmation
    await this.client.waitForTransaction(hash, 2); // 2 confirmations

    // Update database
    await markSnapshotSubmitted(period, hash);

    console.log(`✅ Snapshot period ${period} submitted (tx: ${hash})`);
  }

  /**
   * Finalize snapshot on blockchain with retry logic
   */
  private async finalizeSnapshot(period: number): Promise<void> {
    const hash = await this.executeWithRetry(
      async () => await this.client.finalizeSnapshot(period),
      `Finalize snapshot period ${period}`,
    );

    // Wait for confirmation
    await this.client.waitForTransaction(hash, 2); // 2 confirmations

    // Update database
    await markSnapshotFinalized(period, hash);

    console.log(`✅ Snapshot period ${period} finalized (tx: ${hash})`);
  }

  /**
   * Execute function with exponential backoff retry logic
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    description: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/${this.config.maxRetries}: ${description}`);
        return await fn();
      } catch (error) {
        lastError = error as Error;
        console.error(`❌ Attempt ${attempt} failed:`, error);

        if (attempt < this.config.maxRetries) {
          // Exponential backoff
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `Failed after ${this.config.maxRetries} attempts: ${description}. Last error: ${lastError?.message}`,
    );
  }

  /**
   * Manual snapshot submission (for testing/emergency)
   */
  async submitSnapshotManual(period: number): Promise<void> {
    await this.submitSnapshot(period);
  }

  /**
   * Manual finalization (for testing/emergency)
   */
  async finalizeSnapshotManual(period: number): Promise<void> {
    await this.finalizeSnapshot(period);
  }
}

/**
 * Create and start oracle bot from environment variables
 */
export async function startOracleBotFromEnv(): Promise<OracleBot> {
  const { createBlockchainClientFromEnv } = await import("./contractClient");
  const client = createBlockchainClientFromEnv();

  const config: Partial<OracleBotConfig> = {
    disputePeriodHours: parseInt(
      process.env.DISPUTE_PERIOD_HOURS || "48",
    ),
    checkIntervalMinutes: parseInt(
      process.env.CHECK_INTERVAL_MINUTES || "60",
    ),
    maxRetries: parseInt(process.env.MAX_RETRIES || "3"),
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || "30000"),
  };

  const bot = new OracleBot(client, config);
  
  // Start the bot (runs in background)
  bot.start();

  return bot;
}


