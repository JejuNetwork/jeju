/**
 * Moderation System Configuration
 * 
 * CURRENT: Placeholder zero addresses
 * 
 * TO MAKE REAL: After deploying moderation contracts:
 * ```
 * export const MODERATION_CONTRACTS = {
 *   BanManager: import.meta.env.VITE_BAN_MANAGER_ADDRESS as const,
 *   ReputationLabelManager: import.meta.env.VITE_REPUTATION_LABEL_MANAGER_ADDRESS as const,
 *   // ... load from .env.local
 * } as const;
 * ```
 * 
 * REASON: Moderation contracts separate deployment from Gateway core
 * IMPACT: Moderation features unavailable (reports, bans, appeals)
 * CORE GATEWAY FEATURES UNAFFECTED: Bridge, paymaster, LP, nodes, registry all work
 */
export const MODERATION_CONTRACTS = {
  BanManager: '0x0000000000000000000000000000000000000000',
  ReputationLabelManager: '0x0000000000000000000000000000000000000000',
  ReportingSystem: '0x0000000000000000000000000000000000000000',
  Predimarket: '0x0000000000000000000000000000000000000000',
  RegistryGovernance: '0x0000000000000000000000000000000000000000',
  IdentityRegistry: '0x0000000000000000000000000000000000000000',
} as const;

export const MODERATION_CONFIG = {
  reportBonds: {
    LOW: '0.001',
    MEDIUM: '0.01',
    HIGH: '0.05',
    CRITICAL: '0.1',
  },
  votingPeriods: {
    LOW: 7 * 24 * 3600,
    MEDIUM: 3 * 24 * 3600,
    HIGH: 24 * 3600,
    CRITICAL: 24 * 3600,
  },
} as const;

