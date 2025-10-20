import { Plugin } from '@elizaos/core';

// Import all sub-plugins
import { registryPlugin } from './shared/registry';
import { recoveryPlugin } from './shared/recovery';
import { contractsPlugin } from './shared/contracts';
import { paymasterPlugin } from './shared/paymaster';
import { oraclePlugin } from './shared/oracle';
import { evidencePlugin } from './shared/evidence';
import { approvalPlugin } from './shared/approval';
import { providersPlugin } from './shared/providers';
import { loggerPlugin } from './shared/logger';
import { persistencePlugin } from './shared/persistence';
import { reentrancyPlugin } from './adversary/reentrancy';
import { scamsPlugin } from './adversary/scams';
import { reporterPlugin } from './defender/reporter';
import { appealsPlugin } from './governor/appeals';
import { coordinationPlugin } from './governor/coordination';
import { deployPlugin } from './governor/deploy';

/**
 * Jeju Crucible Plugin
 * 
 * Comprehensive security testing plugin for multi-agent simulation.
 * 
 * Includes:
 * - Shared: Registry (ERC-8004), Recovery (Guardian), Contracts (Utils)
 * - Adversary: Reentrancy attacks, Scams, Front-running
 * - Defender: Monitoring, Reporting (UnifiedReportingSystem), Voting
 * - Governor: Appeals, Proposals, Multi-sig
 * 
 * Agent types use different subsets based on character configuration.
 */
export const cruciblePlugin: Plugin = {
  name: '@crucible/plugin',
  description: 'Jeju Crucible multi-agent security testing plugin suite',
  version: '1.0.0',
  
  // Merge all services
  services: [
    ...(loggerPlugin.services || []), // Start logger first
    ...(persistencePlugin.services || []), // Load persistence early
    ...(registryPlugin.services || []),
    ...(recoveryPlugin.services || []),
    ...(contractsPlugin.services || []),
    ...(paymasterPlugin.services || []),
    ...(oraclePlugin.services || []),
    ...(evidencePlugin.services || []),
    ...(approvalPlugin.services || []),
    ...(coordinationPlugin.services || [])
  ],
  
  // Merge all providers
  providers: [
    ...(oraclePlugin.providers || []),
    ...(providersPlugin.providers || []),
    ...(coordinationPlugin.providers || [])
  ],
  
  // Merge all actions
  actions: [
    ...(registryPlugin.actions || []),
    ...(paymasterPlugin.actions || []),
    ...(evidencePlugin.actions || []),
    ...(approvalPlugin.actions || []),
    ...(reporterPlugin.actions || []),
    ...(reentrancyPlugin.actions || []),
    ...(scamsPlugin.actions || []),
    ...(appealsPlugin.actions || []),
    ...(deployPlugin.actions || [])
  ],
  
  // Initialization with comprehensive validation
  async init(config: Record<string, string>, runtime: any) {
    runtime.logger.info('Initializing Crucible plugin...');
    
    // === CRITICAL ENVIRONMENT VALIDATION ===
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // 1. Network Configuration (REQUIRED)
    const network = runtime.getSetting('NETWORK');
    if (!network) {
      errors.push('NETWORK environment variable is required (localnet/testnet)');
    } else if (network === 'mainnet') {
      throw new Error('❌ FATAL: Crucible cannot run on mainnet');
    } else if (network === 'testnet') {
      warnings.push('Running on testnet - ensure guardian address is multi-sig');
    }
    
    // 2. RPC URLs (REQUIRED)
    const rpcUrl = runtime.getSetting('JEJU_L2_RPC');
    if (!rpcUrl) {
      errors.push('JEJU_L2_RPC environment variable is required');
    }
    
    // 3. Wallet (REQUIRED)
    const privateKey = runtime.getSetting('REDTEAM_PRIVATE_KEY');
    if (!privateKey) {
      errors.push('REDTEAM_PRIVATE_KEY environment variable is required');
    } else if (!privateKey.startsWith('0x')) {
      errors.push('REDTEAM_PRIVATE_KEY must start with 0x');
    } else if (privateKey.length !== 66) {
      errors.push('REDTEAM_PRIVATE_KEY must be 66 characters (0x + 64 hex chars)');
    }
    
    // 4. Guardian Address (REQUIRED)
    const guardianKey = `GUARDIAN_ADDRESS_${(network || 'LOCALNET').toUpperCase()}`;
    const guardianAddr = runtime.getSetting(guardianKey);
    if (!guardianAddr) {
      errors.push(`${guardianKey} environment variable is required for ${network}`);
    } else if (guardianAddr === 'NEVER_USE') {
      errors.push('Guardian address cannot be NEVER_USE');
    } else if (!guardianAddr.startsWith('0x') || guardianAddr.length !== 42) {
      errors.push(`${guardianKey} must be a valid Ethereum address`);
    }
    
    // 5. Contract Addresses (REQUIRED)
    const requiredContracts = [
      'IDENTITY_REGISTRY',
      'REPUTATION_REGISTRY',
      'CREDIT_MANAGER'
    ];
    
    for (const contractKey of requiredContracts) {
      const addr = runtime.getSetting(contractKey);
      if (!addr) {
        errors.push(`${contractKey} environment variable is required`);
      } else if (!addr.startsWith('0x') || addr.length !== 42) {
        errors.push(`${contractKey} must be a valid Ethereum address`);
      }
    }
    
    // 6. Governance Contracts (WARN if missing - may not be deployed yet)
    const optionalContracts = [
      'REGISTRY_GOVERNANCE',
      'UNIFIED_REPORTING_SYSTEM',
      'BAN_MANAGER',
      'LABEL_MANAGER',
      'PREDIMARKET'
    ];
    
    for (const contractKey of optionalContracts) {
      const addr = runtime.getSetting(contractKey);
      if (!addr) {
        warnings.push(`${contractKey} not configured - governance features may not work`);
      }
    }
    
    // 7. AI Provider (REQUIRED)
    const openaiKey = runtime.getSetting('OPENAI_API_KEY');
    const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
    if (!openaiKey && !anthropicKey) {
      errors.push('Either OPENAI_API_KEY or ANTHROPIC_API_KEY is required');
    }
    
    // 8. Agent Configuration (REQUIRED)
    const agentType = runtime.getSetting('AGENT_TYPE');
    if (!agentType) {
      errors.push('AGENT_TYPE environment variable is required (hacker/scammer/citizen/guardian/player)');
    } else if (!['hacker', 'scammer', 'citizen', 'guardian', 'player'].includes(agentType)) {
      errors.push(`Invalid AGENT_TYPE: ${agentType}. Must be one of: hacker, scammer, citizen, guardian, player`);
    }
    
    // === THROW IF CRITICAL ERRORS ===
    if (errors.length > 0) {
      const errorMsg = [
        '❌ CRUCIBLE PLUGIN INITIALIZATION FAILED',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Critical environment validation errors:',
        ...errors.map(e => `  • ${e}`),
        '',
        'Please check your .env file and ensure all required variables are set.',
        'See env.template for a complete list of required variables.'
      ].join('\n');
      
      runtime.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    // === LOG WARNINGS ===
    if (warnings.length > 0) {
      runtime.logger.warn('⚠️  Crucible plugin warnings:', warnings);
    }
    
    // === SUCCESS ===
    runtime.logger.info('✅ Crucible plugin initialized successfully', {
      network,
      agentType,
      wallet: runtime.getSetting('REDTEAM_PRIVATE_KEY')?.slice(0, 10) + '...',
      guardian: guardianAddr?.slice(0, 10) + '...',
      contracts: {
        identity: runtime.getSetting('IDENTITY_REGISTRY')?.slice(0, 10) + '...',
        reputation: runtime.getSetting('REPUTATION_REGISTRY')?.slice(0, 10) + '...'
      }
    });
  }
};

export default cruciblePlugin;

// Re-export individual plugins for granular control
export {
  loggerPlugin,
  persistencePlugin,
  registryPlugin,
  recoveryPlugin,
  contractsPlugin,
  paymasterPlugin,
  oraclePlugin,
  evidencePlugin,
  approvalPlugin,
  providersPlugin,
  reentrancyPlugin,
  scamsPlugin,
  reporterPlugin,
  appealsPlugin,
  coordinationPlugin,
  deployPlugin
};

