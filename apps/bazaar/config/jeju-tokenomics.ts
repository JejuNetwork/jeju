// Jeju Network Token Configuration
// This is used for the official Jeju ICO on the launchpad

export const JEJU_TOKENOMICS = {
  name: 'Jeju',
  symbol: 'JEJU',
  decimals: 18,
  
  maxSupply: 10_000_000_000n * 10n ** 18n, // 10 billion
  initialSupply: 1_000_000_000n * 10n ** 18n, // 1 billion at launch
  
  allocation: {
    presale: {
      percent: 10,
      amount: 1_000_000_000n * 10n ** 18n,
      description: 'Public presale',
      vesting: {
        tgePercent: 20,
        cliff: 0,
        duration: 180 * 24 * 60 * 60, // 180 days
      },
    },
    ecosystem: {
      percent: 30,
      amount: 3_000_000_000n * 10n ** 18n,
      description: 'Grants and development',
      vesting: {
        tgePercent: 0,
        cliff: 365 * 24 * 60 * 60, // 1 year
        duration: 4 * 365 * 24 * 60 * 60, // 4 years
      },
    },
    agentCouncil: {
      percent: 25,
      amount: 2_500_000_000n * 10n ** 18n,
      description: 'Council treasury',
      vesting: {
        tgePercent: 5,
        cliff: 180 * 24 * 60 * 60, // 6 months
        duration: 5 * 365 * 24 * 60 * 60, // 5 years
      },
    },
    team: {
      percent: 15,
      amount: 1_500_000_000n * 10n ** 18n,
      description: 'Team and advisors',
      vesting: {
        tgePercent: 0,
        cliff: 365 * 24 * 60 * 60, // 1 year
        duration: 4 * 365 * 24 * 60 * 60, // 4 years
      },
    },
    liquidity: {
      percent: 10,
      amount: 1_000_000_000n * 10n ** 18n,
      description: 'DEX liquidity',
      vesting: {
        tgePercent: 100,
        cliff: 0,
        duration: 0,
      },
    },
    community: {
      percent: 10,
      amount: 1_000_000_000n * 10n ** 18n,
      description: 'Airdrops and rewards',
      vesting: {
        tgePercent: 10,
        cliff: 0,
        duration: 3 * 365 * 24 * 60 * 60, // 3 years
      },
    },
  },
  
  presale: {
    softCap: 1000n * 10n ** 18n, // 1000 ETH
    hardCap: 3000n * 10n ** 18n, // 3000 ETH
    minContribution: 1n * 10n ** 16n, // 0.01 ETH
    maxContribution: 50n * 10n ** 18n, // 50 ETH
    tokenPrice: 3n * 10n ** 12n, // 0.000003 ETH per JEJU
    
    whitelistBonus: 10, // 10% bonus for whitelist
    volumeBonuses: [
      { minEth: 10, bonus: 5 },
      { minEth: 5, bonus: 3 },
      { minEth: 1, bonus: 1 },
    ],
  },
  
  schedule: {
    whitelistDuration: 7 * 24 * 60 * 60, // 7 days
    publicDuration: 7 * 24 * 60 * 60, // 7 days
    tgeDelay: 0, // Immediate
  },
  
  exclusiveUtility: [
    { name: 'Governance', description: 'Vote on protocol upgrades', icon: 'vote' },
    { name: 'Moderation', description: 'Stake in moderation marketplace', icon: 'shield' },
    { name: 'Ban Enforcement', description: 'Conviction lock for banned users', icon: 'lock' },
  ],
  
  universalPayment: [
    { name: 'Compute', description: 'Inference and TEE', icon: 'cpu' },
    { name: 'Storage', description: 'IPFS pinning', icon: 'database' },
    { name: 'Bazaar', description: 'Marketplace fees', icon: 'store' },
    { name: 'Gateway', description: 'API access', icon: 'globe' },
  ],
  
  targets: {
    softCap: 3_000_000, // $3M USD
    hardCap: 10_000_000, // $10M USD
    participants: 5_000,
    liquidityTarget: 500_000, // $500K TVL
  },
} as const

export type JejuAllocationKey = keyof typeof JEJU_TOKENOMICS.allocation

// Contract addresses by network
export const JEJU_CONTRACTS = {
  localnet: {
    token: '0x0000000000000000000000000000000000000000' as const,
    presale: '0x0000000000000000000000000000000000000000' as const,
  },
  testnet: {
    token: '0x0000000000000000000000000000000000000000' as const,
    presale: '0x0000000000000000000000000000000000000000' as const,
  },
  mainnet: {
    token: '0x0000000000000000000000000000000000000000' as const,
    presale: '0x0000000000000000000000000000000000000000' as const,
  },
} as const
