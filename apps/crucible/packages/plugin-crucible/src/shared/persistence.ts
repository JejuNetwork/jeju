/**
 * Agent State Persistence Service
 * Saves agent state to database for crash recovery
 */

import { Plugin, Service, type IAgentRuntime } from '@elizaos/core';

export interface AgentState {
  agentId: string;
  agentType: string;
  erc8004AgentId?: number;
  discoveredVulnerabilities: VulnerabilityRecord[];
  submittedReports: ReportRecord[];
  pendingAppeals: AppealRecord[];
  lastSaved: number;
  metadata: Record<string, any>;
}

export interface VulnerabilityRecord {
  contract: string;
  function: string;
  type: string;
  severity: string;
  discoveredAt: number;
  txHash?: string;
}

export interface ReportRecord {
  reportId: number;
  targetAgentId: number;
  reportType: string;
  severity: string;
  submittedAt: number;
  txHash: string;
  evidenceHash: string;
}

export interface AppealRecord {
  appealId: string;
  proposalId: string;
  submittedAt: number;
  status: string;
}

/**
 * Persistence Service
 * Manages agent state persistence and recovery
 */
export class PersistenceService extends Service {
  public static serviceType = 'persistence_service';
  
  private state: AgentState | null = null;
  private saveInterval?: NodeJS.Timeout;
  private isDirty: boolean = false;
  
  async start(runtime: IAgentRuntime): Promise<PersistenceService> {
    const agentType = runtime.getSetting('AGENT_TYPE') || 'unknown';
    
    // Try to load existing state from database
    await this.loadState(runtime);
    
    // If no state exists, create new
    if (!this.state) {
      this.state = {
        agentId: runtime.agentId.toString(),
        agentType,
        discoveredVulnerabilities: [],
        submittedReports: [],
        pendingAppeals: [],
        lastSaved: Date.now(),
        metadata: {}
      };
    }
    
    // Auto-save every 30 seconds if dirty
    this.saveInterval = setInterval(() => {
      if (this.isDirty) {
        this.saveState(runtime);
      }
    }, 30000);
    
    runtime.logger.info('Persistence service started', {
      agentType,
      hasExistingState: !!this.state,
      vulnerabilities: this.state.discoveredVulnerabilities.length,
      reports: this.state.submittedReports.length
    });
    
    return this;
  }
  
  /**
   * Load state from database
   */
  private async loadState(runtime: IAgentRuntime): Promise<void> {
    try {
      const stateKey = `agent_state_${runtime.agentId}`;
      const cached = await runtime.getCache(stateKey);
      
      if (cached) {
        this.state = cached as AgentState;
        runtime.logger.info('Loaded agent state from database', {
          vulnerabilities: this.state.discoveredVulnerabilities.length,
          reports: this.state.submittedReports.length,
          lastSaved: new Date(this.state.lastSaved).toISOString()
        });
      }
    } catch (error) {
      runtime.logger.warn('Could not load state from database', error);
    }
  }
  
  /**
   * Save state to database
   */
  private async saveState(runtime: IAgentRuntime): Promise<void> {
    if (!this.state) return;
    
    try {
      this.state.lastSaved = Date.now();
      const stateKey = `agent_state_${runtime.agentId}`;
      
      await runtime.setCache(stateKey, this.state);
      
      this.isDirty = false;
      
      runtime.logger.debug('Agent state saved to database');
    } catch (error) {
      runtime.logger.error('Failed to save agent state', error);
    }
  }
  
  /**
   * Get current state
   */
  getState(): AgentState | null {
    return this.state;
  }
  
  /**
   * Record discovered vulnerability
   */
  recordVulnerability(vuln: VulnerabilityRecord): void {
    if (!this.state) return;
    
    this.state.discoveredVulnerabilities.push(vuln);
    this.isDirty = true;
    
    this.runtime.logger.info('Vulnerability recorded in state', {
      contract: vuln.contract,
      type: vuln.type,
      severity: vuln.severity
    });
  }
  
  /**
   * Record submitted report
   */
  recordReport(report: ReportRecord): void {
    if (!this.state) return;
    
    this.state.submittedReports.push(report);
    this.isDirty = true;
    
    this.runtime.logger.info('Report recorded in state', {
      reportId: report.reportId,
      targetAgentId: report.targetAgentId
    });
  }
  
  /**
   * Record appeal
   */
  recordAppeal(appeal: AppealRecord): void {
    if (!this.state) return;
    
    this.state.pendingAppeals.push(appeal);
    this.isDirty = true;
    
    this.runtime.logger.info('Appeal recorded in state', {
      appealId: appeal.appealId
    });
  }
  
  /**
   * Update appeal status
   */
  updateAppealStatus(appealId: string, status: string): void {
    if (!this.state) return;
    
    const appeal = this.state.pendingAppeals.find(a => a.appealId === appealId);
    if (appeal) {
      appeal.status = status;
      this.isDirty = true;
    }
  }
  
  /**
   * Set ERC-8004 agent ID
   */
  setERC8004AgentId(agentId: number): void {
    if (!this.state) return;
    
    this.state.erc8004AgentId = agentId;
    this.isDirty = true;
    
    this.runtime.logger.info('ERC-8004 agent ID saved to state', {agentId});
  }
  
  /**
   * Get statistics
   */
  getStatistics(): {
    totalVulnerabilities: number;
    totalReports: number;
    pendingAppeals: number;
    bySeverity: Record<string, number>;
  } {
    if (!this.state) {
      return {
        totalVulnerabilities: 0,
        totalReports: 0,
        pendingAppeals: 0,
        bySeverity: {}
      };
    }
    
    const bySeverity = this.state.discoveredVulnerabilities.reduce((acc, v) => {
      acc[v.severity] = (acc[v.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      totalVulnerabilities: this.state.discoveredVulnerabilities.length,
      totalReports: this.state.submittedReports.length,
      pendingAppeals: this.state.pendingAppeals.filter(a => a.status === 'PENDING').length,
      bySeverity
    };
  }
  
  /**
   * Force save now
   */
  async forceSave(runtime: IAgentRuntime): Promise<void> {
    await this.saveState(runtime);
  }
  
  async stop(): Promise<void> {
    // Save state one final time
    if (this.isDirty && this.state) {
      this.runtime.logger.info('Saving agent state before shutdown...');
      await this.saveState(this.runtime);
    }
    
    // Clear interval
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    
    this.runtime.logger.info('Persistence service stopped');
  }
  
  public get capabilityDescription(): string {
    return 'Agent state persistence for crash recovery and resume functionality';
  }
}

export const persistencePlugin: Plugin = {
  name: '@crucible/plugin-persistence',
  description: 'Agent state persistence for crash recovery',
  services: [PersistenceService]
};

