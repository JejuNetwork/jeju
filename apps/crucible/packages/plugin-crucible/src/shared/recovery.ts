import { Plugin, Service, type IAgentRuntime } from '@elizaos/core';
import { ethers } from 'ethers';

/**
 * Guardian Recovery Service
 * 
 * Automatically recovers all stolen/scammed funds to guardian addresses.
 * Runs continuously in background for all agent types.
 * 
 * Key features:
 * - Monitors wallet balance every 10 seconds
 * - Auto-transfers amounts > threshold to guardian
 * - Logs all fund movements
 * - Prevents fund loss from exploits
 */
class GuardianRecoveryService extends Service {
  public static serviceType = 'guardian_recovery';
  
  private provider!: ethers.JsonRpcProvider;
  private wallet!: ethers.Wallet;
  private guardianAddress!: string;
  private checkInterval?: NodeJS.Timeout;
  private recoveryThreshold: bigint;
  private gasReserve: bigint;
  private isRecovering: boolean = false; // Semaphore to prevent concurrent execution
  private pendingShutdown: boolean = false;

  async start(runtime: IAgentRuntime): Promise<GuardianRecoveryService> {
    const network = runtime.getSetting('NETWORK');
    const rpcUrl = runtime.getSetting('JEJU_L2_RPC');
    const privateKey = runtime.getSetting('REDTEAM_PRIVATE_KEY');
    
    if (!network) {
      throw new Error('NETWORK environment variable is required for GuardianRecoveryService');
    }
    
    if (!rpcUrl) {
      throw new Error('JEJU_L2_RPC environment variable is required for GuardianRecoveryService');
    }
    
    if (!privateKey) {
      throw new Error('REDTEAM_PRIVATE_KEY environment variable is required for GuardianRecoveryService');
    }
    
    // Get guardian address for current network
    const guardianKey = `GUARDIAN_ADDRESS_${network.toUpperCase()}`;
    this.guardianAddress = runtime.getSetting(guardianKey);
    
    if (!this.guardianAddress || this.guardianAddress === 'NEVER_USE') {
      throw new Error(`${guardianKey} environment variable is required and must be a valid address`);
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    
    // Configuration
    const thresholdSetting = runtime.getSetting('AUTO_RECOVER_THRESHOLD');
    this.recoveryThreshold = thresholdSetting ? ethers.parseEther(thresholdSetting) : ethers.parseEther('0.1');
    this.gasReserve = ethers.parseEther('0.01');
    
    const intervalSetting = runtime.getSetting('RECOVERY_CHECK_INTERVAL');
    const checkIntervalMs = intervalSetting ? Number(intervalSetting) : 10000;

    // Start monitoring
    this.startMonitoring(runtime, checkIntervalMs);

    runtime.logger.info('Guardian recovery service started', {
      network,
      rpcUrl,
      guardian: this.guardianAddress,
      wallet: this.wallet.address,
      threshold: ethers.formatEther(this.recoveryThreshold) + ' ETH',
      checkInterval: `${checkIntervalMs}ms`
    });

    return this;
  }

  private startMonitoring(runtime: IAgentRuntime, intervalMs: number): void {
    this.checkInterval = setInterval(async () => {
      // Skip if already running or shutting down
      if (this.isRecovering || this.pendingShutdown) {
        return;
      }
      
      try {
        await this.checkAndRecover(runtime);
      } catch (error: any) {
        runtime.logger.error('Recovery monitor error:', error);
        this.isRecovering = false; // Reset lock on error
      }
    }, intervalMs);
  }

  private async checkAndRecover(runtime: IAgentRuntime): Promise<void> {
    // Acquire lock
    if (this.isRecovering) {
      runtime.logger.debug('Recovery already in progress, skipping check');
      return;
    }
    
    this.isRecovering = true;
    
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      
      if (balance > this.recoveryThreshold) {
        await this.recoverFunds(runtime, balance);
      }
    } finally {
      // Always release lock
      this.isRecovering = false;
    }
  }

  async recoverFunds(runtime: IAgentRuntime, amount: bigint): Promise<string> {
    try {
      runtime.logger.warn(`🚨 RECOVERING FUNDS: ${ethers.formatEther(amount)} ETH → Guardian`);

      // Keep minimal gas reserve
      const recoveryAmount = amount - this.gasReserve;
      
      if (recoveryAmount <= 0n) {
        runtime.logger.info('Amount too small to recover (< gas reserve)');
        return '';
      }

      const tx = await this.wallet.sendTransaction({
        to: this.guardianAddress,
        value: recoveryAmount
      });

      const receipt = await tx.wait();

      runtime.logger.info('✅ FUNDS RECOVERED TO GUARDIAN', {
        amount: ethers.formatEther(recoveryAmount) + ' ETH',
        guardian: this.guardianAddress,
        txHash: receipt?.hash
      });

      // Log to database
      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `FUND RECOVERY: ${ethers.formatEther(recoveryAmount)} ETH recovered to guardian ${this.guardianAddress}. TX: ${receipt?.hash}`,
          action: 'GUARDIAN_RECOVERY',
          data: {
            amount: ethers.formatEther(recoveryAmount),
            guardian: this.guardianAddress,
            txHash: receipt?.hash,
            timestamp: Date.now()
          }
        },
        roomId: 'recovery-log'
      }, 'recovery');

      return receipt?.hash || '';
    } catch (error: any) {
      runtime.logger.error('Recovery failed:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.runtime.logger.info('Stopping Guardian recovery service...');
    
    // Set shutdown flag
    this.pendingShutdown = true;
    
    // Stop the interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    
    // Wait for any in-flight recovery to complete (max 30 seconds)
    const maxWaitMs = 30000;
    const startWait = Date.now();
    
    while (this.isRecovering && (Date.now() - startWait) < maxWaitMs) {
      this.runtime.logger.debug('Waiting for in-flight recovery operation to complete...');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (this.isRecovering) {
      this.runtime.logger.warn('Recovery operation still in progress after 30s, forcing shutdown');
    }
    
    this.runtime.logger.info('Guardian recovery service stopped');
  }

  public get capabilityDescription(): string {
    return 'Automatic recovery of exploited funds to guardian addresses';
  }
}

export const recoveryPlugin: Plugin = {
  name: '@crucible/plugin-recovery',
  description: 'Guardian fund recovery system - auto-recovers all stolen funds',
  services: [GuardianRecoveryService]
};

