/**
 * Free Tier Service
 * Manages free tier limits and usage tracking
 */

export const TIER_LIMITS = {
  free: {
    cpuHoursMonthly: 100,
    cpuHoursPerMonth: 100,
    storageGb: 10,
    storageGbLimit: 10,
    bandwidthGbPerMonth: 100,
    invocationsDaily: 100000,
    functionInvocationsPerMonth: 3000000,
    concurrentDeployments: 3,
    workersMax: 5,
    memoryMb: 256,
  },
  hobby: {
    cpuHoursMonthly: 250,
    cpuHoursPerMonth: 250,
    storageGb: 25,
    storageGbLimit: 25,
    bandwidthGbPerMonth: 250,
    invocationsDaily: 250000,
    functionInvocationsPerMonth: 7500000,
    concurrentDeployments: 5,
    workersMax: 10,
    memoryMb: 384,
  },
  starter: {
    cpuHoursMonthly: 500,
    cpuHoursPerMonth: 500,
    storageGb: 50,
    storageGbLimit: 50,
    bandwidthGbPerMonth: 500,
    invocationsDaily: 500000,
    functionInvocationsPerMonth: 15000000,
    concurrentDeployments: 10,
    workersMax: 20,
    memoryMb: 512,
  },
  pro: {
    cpuHoursMonthly: 2000,
    cpuHoursPerMonth: 2000,
    storageGb: 200,
    storageGbLimit: 200,
    bandwidthGbPerMonth: 2000,
    invocationsDaily: 2000000,
    functionInvocationsPerMonth: 60000000,
    concurrentDeployments: 50,
    workersMax: 100,
    memoryMb: 2048,
  },
  enterprise: {
    cpuHoursMonthly: Infinity,
    cpuHoursPerMonth: Infinity,
    storageGb: Infinity,
    storageGbLimit: Infinity,
    bandwidthGbPerMonth: Infinity,
    invocationsDaily: Infinity,
    functionInvocationsPerMonth: Infinity,
    concurrentDeployments: Infinity,
    workersMax: Infinity,
    memoryMb: 4096,
  },
} as const

export type TierType = keyof typeof TIER_LIMITS

interface DailyUsage {
  date: string
  cpuHours: number
  storageGb: number
  invocations: number
  errors: number
}

interface UsageReport {
  daily: DailyUsage[]
  totals: {
    cpuHours: number
    storageGb: number
    invocations: number
    errors: number
    functionInvocations: number
    cpuHoursUsed: number
    storageGbUsed: number
    bandwidthGbUsed: number
  }
}

interface UserStatus {
  tier: TierType
  limits: (typeof TIER_LIMITS)[TierType]
  usage: UsageReport['totals']
  quotaResetAt: number
}

interface FreeTierService {
  getTier(): TierType
  getLimits(): (typeof TIER_LIMITS)[TierType]
  checkLimit(usage: number, limit: keyof (typeof TIER_LIMITS)['free']): boolean
  getUsageReport(address: string, days: number): Promise<UsageReport>
  getUserStatus(address: string): Promise<UserStatus>
  upgradeTier(
    address: string,
    tier: TierType,
    paymentTxHash?: string,
  ): Promise<boolean>
}

let freeTierService: FreeTierService | null = null

const defaultTotals = {
  cpuHours: 0,
  storageGb: 0,
  invocations: 0,
  errors: 0,
  functionInvocations: 0,
  cpuHoursUsed: 0,
  storageGbUsed: 0,
  bandwidthGbUsed: 0,
}

export function getFreeTierService(): FreeTierService {
  if (!freeTierService) {
    freeTierService = {
      getTier: () => 'free' as TierType,
      getLimits: () => TIER_LIMITS.free,
      checkLimit: (usage, limit) => usage < TIER_LIMITS.free[limit],
      getUsageReport: async (_address: string, _days: number) => ({
        daily: [],
        totals: defaultTotals,
      }),
      getUserStatus: async (_address: string) => ({
        tier: 'free' as TierType,
        limits: TIER_LIMITS.free,
        usage: defaultTotals,
        quotaResetAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days from now
      }),
      upgradeTier: async (
        _address: string,
        _tier: TierType,
        _paymentTxHash?: string,
      ) => true,
    }
  }
  return freeTierService
}
