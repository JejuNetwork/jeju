export const TOKENOMICS = {
  name: 'Jeju',
  symbol: 'JEJU',
  decimals: 18,
  
  // Total Supply
  maxSupply: 10_000_000_000n * 10n ** 18n, // 10 billion
  initialSupply: 1_000_000_000n * 10n ** 18n, // 1 billion at launch
  
  // Distribution (percentage of max supply)
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
  
  // Presale Configuration
  presale: {
    softCap: 100n * 10n ** 18n, // 100 ETH
    hardCap: 1000n * 10n ** 18n, // 1000 ETH
    minContribution: 1n * 10n ** 16n, // 0.01 ETH
    maxContribution: 50n * 10n ** 18n, // 50 ETH
    tokenPrice: 5n * 10n ** 13n, // 0.00005 ETH per JEJU ($0.15 at $3k ETH)
    
    // Bonuses
    whitelistBonus: 10, // 10% bonus for whitelist
    volumeBonuses: [
      { minEth: 10, bonus: 5 }, // 5% for 10+ ETH
      { minEth: 5, bonus: 3 },  // 3% for 5+ ETH
      { minEth: 1, bonus: 1 },  // 1% for 1+ ETH
    ],
  },
  
  // Key Dates (timestamps will be set during deployment)
  schedule: {
    whitelistDuration: 7 * 24 * 60 * 60, // 7 days
    publicDuration: 14 * 24 * 60 * 60, // 14 days
    tgeDelay: 7 * 24 * 60 * 60, // 7 days after presale ends
  },
  
  utility: [
    { name: 'Governance', description: 'Vote on protocol upgrades', icon: 'vote' },
    { name: 'Moderation', description: 'Stake in moderation marketplace', icon: 'shield' },
    { name: 'Services', description: 'Pay for compute and storage', icon: 'server' },
    { name: 'Council', description: 'Revenue funds operations', icon: 'users' },
  ],
} as const;

export type TokenomicsAllocation = keyof typeof TOKENOMICS.allocation;
