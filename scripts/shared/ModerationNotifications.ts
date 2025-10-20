/**
 * Moderation Notifications Service
 * Sends real-time notifications for moderation events
 */

import { ethers, Contract } from 'ethers';
import { Logger } from './logger';

const logger = new Logger({ prefix: 'NOTIF' });

export interface NotificationConfig {
  banManagerAddress: string;
  labelManagerAddress: string;
  reportingSystemAddress: string;
  rpcUrl: string;
  webhookUrl?: string; // Optional webhook for external notifications
}

export interface ModerationNotification {
  type: 'ban' | 'label' | 'report' | 'appeal';
  agentId: number;
  details: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  txHash?: string;
}

/**
 * Service to handle moderation event notifications
 * Sends real-time alerts when moderation actions occur
 */
export class ModerationNotifications {
  private banManager: Contract;
  private labelManager: Contract;
  private reportingSystem: Contract;
  private provider: ethers.Provider;
  private webhookUrl?: string;

  // Notification callbacks
  private callbacks = new Map<string, ((notification: ModerationNotification) => void)[]>();

  constructor(config: NotificationConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.webhookUrl = config.webhookUrl;

    // Load ABIs
    const banManagerABI = [
      'event NetworkBanApplied(uint256 indexed agentId, string reason, bytes32 indexed proposalId, uint256 timestamp)',
      'event NetworkBanRemoved(uint256 indexed agentId, uint256 timestamp)',
      'event AppBanApplied(uint256 indexed agentId, bytes32 indexed appId, string reason, bytes32 indexed proposalId, uint256 timestamp)',
      'event AppBanRemoved(uint256 indexed agentId, bytes32 indexed appId, uint256 timestamp)',
    ];

    const labelManagerABI = [
      'event LabelApplied(uint256 indexed agentId, uint8 label, bytes32 indexed proposalId, uint256 timestamp)',
      'event LabelRemoved(uint256 indexed agentId, uint8 label, uint256 timestamp)',
      'event LabelProposed(bytes32 indexed proposalId, uint256 indexed targetAgentId, uint8 label, address indexed proposer, bytes32 marketId, bytes32 evidenceHash)',
    ];

    const reportingSystemABI = [
      'event ReportCreated(uint256 indexed reportId, uint256 indexed targetAgentId, uint8 reportType, uint8 severity, address indexed reporter, bytes32 marketId, bytes32 evidenceHash)',
      'event ReportResolved(uint256 indexed reportId, bool actionApproved, uint256 timestamp)',
      'event ReportExecuted(uint256 indexed reportId, uint256 indexed targetAgentId, uint8 reportType, uint256 timestamp)',
    ];

    this.banManager = new Contract(config.banManagerAddress, banManagerABI, this.provider);
    this.labelManager = new Contract(config.labelManagerAddress, labelManagerABI, this.provider);
    this.reportingSystem = new Contract(config.reportingSystemAddress, reportingSystemABI, this.provider);
  }

  /**
   * Start listening for moderation events
   */
  startListening(): void {
    logger.info('Starting moderation event listeners...');

    // Network bans
    this.banManager.on('NetworkBanApplied', (agentId: bigint, reason: string, proposalId: string, timestamp: bigint, event) => {
      this.notify({
        type: 'ban',
        agentId: Number(agentId),
        details: `Network ban: ${reason}`,
        severity: 'critical',
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
      });
    });

    this.banManager.on('NetworkBanRemoved', (agentId: bigint, timestamp: bigint, event) => {
      this.notify({
        type: 'ban',
        agentId: Number(agentId),
        details: 'Network ban removed (appeal successful)',
        severity: 'medium',
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
      });
    });

    // App bans
    this.banManager.on('AppBanApplied', (agentId: bigint, appId: string, reason: string, proposalId: string, timestamp: bigint, event) => {
      this.notify({
        type: 'ban',
        agentId: Number(agentId),
        details: `App ban (${this.appIdToName(appId)}): ${reason}`,
        severity: 'high',
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
      });
    });

    // Labels
    this.labelManager.on('LabelApplied', (agentId: bigint, label: number, proposalId: string, timestamp: bigint, event) => {
      const labelName = this.labelToString(label);
      const severity = label === 1 ? 'critical' : label === 2 ? 'high' : label === 4 ? 'low' : 'medium';

      this.notify({
        type: 'label',
        agentId: Number(agentId),
        details: `${labelName} label applied`,
        severity,
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
      });
    });

    // Reports
    this.reportingSystem.on(
      'ReportCreated',
      (reportId: bigint, targetAgentId: bigint, reportType: number, severity: number, reporter: string, marketId: string, evidenceHash: string, event) => {
        const severityStr = ['low', 'medium', 'high', 'critical'][severity] as 'low' | 'medium' | 'high' | 'critical';

        this.notify({
          type: 'report',
          agentId: Number(targetAgentId),
          details: `New report #${reportId} filed`,
          severity: severityStr,
          timestamp: Date.now(),
          txHash: event.log.transactionHash,
        });
      }
    );

    this.reportingSystem.on('ReportResolved', (reportId: bigint, actionApproved: boolean, timestamp: bigint, event) => {
      this.notify({
        type: 'report',
        agentId: 0, // Would need to query report to get target
        details: `Report #${reportId} ${actionApproved ? 'approved' : 'rejected'}`,
        severity: actionApproved ? 'high' : 'low',
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
      });
    });

    logger.success('Moderation event listeners active');
  }

  /**
   * Subscribe to notifications
   * @param agentId Agent ID to watch (0 for all)
   * @param callback Function to call on notification
   */
  subscribe(agentId: number, callback: (notification: ModerationNotification) => void): () => void {
    const key = agentId.toString();
    if (!this.callbacks.has(key)) {
      this.callbacks.set(key, []);
    }
    this.callbacks.get(key)!.push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.callbacks.get(key);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  /**
   * Notify all subscribers and send webhook if configured
   */
  private async notify(notification: ModerationNotification): Promise<void> {
    logger.info(`Notification: ${notification.type} for agent ${notification.agentId} - ${notification.details}`);

    // Call agent-specific callbacks
    const agentCallbacks = this.callbacks.get(notification.agentId.toString()) || [];
    agentCallbacks.forEach((cb) => cb(notification));

    // Call global callbacks (agentId 0)
    const globalCallbacks = this.callbacks.get('0') || [];
    globalCallbacks.forEach((cb) => cb(notification));

    // Send webhook if configured
    if (this.webhookUrl) {
      try {
        await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notification),
        });
      } catch (error) {
        logger.error('Webhook failed:', error);
      }
    }
  }

  /**
   * Stop all listeners
   */
  stopListening(): void {
    this.banManager.removeAllListeners();
    this.labelManager.removeAllListeners();
    this.reportingSystem.removeAllListeners();
    logger.info('Event listeners stopped');
  }

  // Helper methods
  private labelToString(label: number): string {
    const labels = ['NONE', 'HACKER', 'SCAMMER', 'SPAM_BOT', 'TRUSTED'];
    return labels[label] || 'UNKNOWN';
  }

  private appIdToName(appId: string): string {
    // Simplified - would use AppIdentifiers.getAppName() in production
    return appId.substring(0, 10) + '...';
  }
}

/**
 * Create notification service from environment
 */
export function createNotificationService(): ModerationNotifications {
  const config: NotificationConfig = {
    banManagerAddress: process.env.BAN_MANAGER_ADDRESS || '',
    labelManagerAddress: process.env.LABEL_MANAGER_ADDRESS || '',
    reportingSystemAddress: process.env.REPORTING_SYSTEM_ADDRESS || '',
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    webhookUrl: process.env.MODERATION_WEBHOOK_URL,
  };

  return new ModerationNotifications(config);
}

