#!/usr/bin/env bun
/**
 * @fileoverview CLI for deploying cross-chain token
 * @module @jejunetwork/token/cli/deploy
 *
 * Usage:
 *   bun run src/cli/deploy.ts --network testnet --config ./token-config.json
 *   bun run src/cli/deploy.ts --network mainnet --dry-run
 */

import { Command } from 'commander'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { MAINNET_CHAINS, TESTNET_CHAINS } from '../config/chains'
import type {
  CCAConfig,
  ChainId,
  DeploymentConfig,
  HyperlaneConfig,
  LiquidityConfig,
  PresaleConfig,
  TokenEconomics,
} from '../types'

// =============================================================================
// CLI SETUP
// =============================================================================

const program = new Command()

program
  .name('deploy')
  .description('Deploy cross-chain token with Hyperlane Warp Routes')
  .version('0.1.0')
  .option(
    '-n, --network <network>',
    'Network to deploy on (mainnet, testnet, local)',
    'testnet',
  )
  .option('-c, --config <path>', 'Path to token configuration JSON')
  .option('--dry-run', 'Simulate deployment without executing', false)
  .option('--skip-solana', 'Skip Solana deployment', false)
  .option('--only-chain <chainId>', 'Deploy only to specific chain')
  .parse(process.argv)

const options = program.opts()

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

function getDefaultTokenEconomics(): TokenEconomics {
  return {
    name: 'Jeju Token',
    symbol: 'JEJU',
    decimals: 18,
    totalSupply: 1_000_000_000n, // 1 billion tokens
    allocation: {
      publicSale: 30, // 30% for CCA auction
      presale: 10, // 10% for presale
      team: 15, // 15% for team
      advisors: 5, // 5% for advisors
      ecosystem: 25, // 25% for ecosystem/treasury
      liquidity: 10, // 10% for initial liquidity
      stakingRewards: 5, // 5% for staking rewards
    },
    vesting: {
      team: {
        cliffDuration: 365 * 24 * 60 * 60, // 1 year cliff
        vestingDuration: 3 * 365 * 24 * 60 * 60, // 3 year vesting
        tgeUnlockPercent: 0, // No unlock at TGE
        vestingType: 'linear',
      },
      advisors: {
        cliffDuration: 180 * 24 * 60 * 60, // 6 month cliff
        vestingDuration: 2 * 365 * 24 * 60 * 60, // 2 year vesting
        tgeUnlockPercent: 0,
        vestingType: 'linear',
      },
      presale: {
        cliffDuration: 30 * 24 * 60 * 60, // 1 month cliff
        vestingDuration: 6 * 30 * 24 * 60 * 60, // 6 month vesting
        tgeUnlockPercent: 20, // 20% at TGE
        vestingType: 'linear',
      },
      ecosystem: {
        cliffDuration: 0,
        vestingDuration: 4 * 365 * 24 * 60 * 60, // 4 year vesting
        tgeUnlockPercent: 5, // 5% at TGE
        vestingType: 'linear',
      },
    },
    fees: {
      transferFeeBps: 100, // 1% total transfer fee
      bridgeFeeBps: 50, // 0.5% bridge fee
      swapFeeBps: 30, // 0.3% swap fee (Uniswap default)
      distribution: {
        holders: 40, // 40% to stakers
        creators: 20, // 20% to team
        treasury: 20, // 20% to treasury
        liquidityProviders: 10, // 10% to LPs
        burn: 10, // 10% burned
      },
      feeExemptAddresses: [],
    },
    maxWalletPercent: 2, // 2% max wallet
    maxTxPercent: 1, // 1% max transaction
  }
}

function getDefaultPresaleConfig(
  network: 'mainnet' | 'testnet',
): PresaleConfig {
  const now = Math.floor(Date.now() / 1000)
  const oneDay = 24 * 60 * 60
  const oneWeek = 7 * oneDay

  return {
    enabled: true,
    startTime: now + oneDay, // Start tomorrow
    endTime: now + oneWeek, // End in 1 week
    softCapUsd: network === 'mainnet' ? 500_000 : 1_000, // $500k mainnet, $1k testnet
    hardCapUsd: network === 'mainnet' ? 2_000_000 : 10_000,
    priceUsd: 0.01, // $0.01 per token
    tiers: [
      {
        name: 'Community',
        minContribution: 100,
        maxContribution: 10_000,
        discountPercent: 20, // 20% discount
      },
      {
        name: 'VIP',
        minContribution: 10_000,
        maxContribution: 100_000,
        discountPercent: 30, // 30% discount
      },
    ],
    acceptedTokens: {
      1: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address], // USDC on Ethereum
      8453: ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address], // USDC on Base
    } as Record<ChainId, Address[]>,
    refundIfSoftCapMissed: true,
  }
}

function getDefaultCCAConfig(network: 'mainnet' | 'testnet'): CCAConfig {
  const now = Math.floor(Date.now() / 1000)
  const oneWeek = 7 * 24 * 60 * 60

  return {
    deploymentMode: 'self-deployed', // We control the fees
    startTime: now + oneWeek, // Start after presale
    duration: oneWeek, // 1 week auction
    startPriceUsd: 0.05, // Start at $0.05 (Dutch auction)
    reservePriceUsd: 0.01, // Floor at $0.01
    supplyReleaseCurve: 'linear',
    maxBidPercent: 5, // Max 5% of supply per bid
    minBidUsd: network === 'mainnet' ? 100 : 1, // Min $100 mainnet, $1 testnet
    autoMigrateLiquidity: true,
    auctionFees: {
      platformFeeBps: 250, // 2.5% platform fee (goes to us)
      referralFeeBps: 50, // 0.5% referral fee
    },
  }
}

function getDefaultLiquidityConfig(): LiquidityConfig {
  return {
    lockDuration: 365 * 24 * 60 * 60, // 1 year lock
    lpTokenRecipient: '0x0000000000000000000000000000000000000000' as Address, // Locked
    allocations: [
      {
        chainId: 1,
        percentage: 40, // 40% on Ethereum
        initialPriceUsd: 0.01,
        pairedAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
        dex: 'uniswap-v4',
      },
      {
        chainId: 8453,
        percentage: 30, // 30% on Base
        initialPriceUsd: 0.01,
        pairedAsset: '0x4200000000000000000000000000000000000006' as Address, // WETH on Base
        dex: 'uniswap-v4',
      },
      {
        chainId: 42161,
        percentage: 20, // 20% on Arbitrum
        initialPriceUsd: 0.01,
        pairedAsset: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address, // WETH on Arbitrum
        dex: 'uniswap-v4',
      },
      {
        chainId: 'solana-mainnet',
        percentage: 10, // 10% on Solana
        initialPriceUsd: 0.01,
        pairedAsset: 'SOL',
        dex: 'raydium',
      },
    ],
  }
}

function getDefaultHyperlaneConfig(
  owner: Address,
  validators: string[],
): HyperlaneConfig {
  return {
    routes: [
      {
        chainId: 1,
        tokenType: 'collateral', // Lock on Ethereum
        ism: {
          type: 'multisig',
          validators,
          threshold: Math.ceil((validators.length * 2) / 3), // 2/3 threshold
        },
        owner,
        rateLimitPerDay: 1_000_000n * 10n ** 18n, // 1M tokens per day
      },
      {
        chainId: 8453,
        tokenType: 'synthetic', // Mint/burn on Base
        ism: {
          type: 'multisig',
          validators,
          threshold: Math.ceil((validators.length * 2) / 3),
        },
        owner,
        rateLimitPerDay: 1_000_000n * 10n ** 18n,
      },
      {
        chainId: 42161,
        tokenType: 'synthetic',
        ism: {
          type: 'multisig',
          validators,
          threshold: Math.ceil((validators.length * 2) / 3),
        },
        owner,
        rateLimitPerDay: 1_000_000n * 10n ** 18n,
      },
      {
        chainId: 'solana-mainnet',
        tokenType: 'synthetic',
        ism: {
          type: 'multisig',
          validators,
          threshold: Math.ceil((validators.length * 2) / 3),
        },
        owner,
        rateLimitPerDay: 1_000_000n * 10n ** 18n,
      },
    ],
    validators: validators.map((v) => ({
      address: v,
      chains: [1, 8453, 42161, 'solana-mainnet'] as ChainId[],
    })),
    gasConfig: {
      defaultGasLimit: 200_000n,
      gasOverhead: 50_000n,
    },
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log(
    '╔══════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║     Cross-Chain Token Deployment                             ║',
  )
  console.log(
    '║     Permissionless • Hyperlane Warp Routes • EVM + Solana    ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════╝',
  )
  console.log()

  const network = options.network as 'mainnet' | 'testnet' | 'local'
  const dryRun = options.dryRun as boolean
  const skipSolana = options.skipSolana as boolean

  console.log(`Network: ${network}`)
  console.log(`Dry Run: ${dryRun}`)
  console.log(`Skip Solana: ${skipSolana}`)
  console.log()

  // Get deployer private key from environment
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey && !dryRun) {
    console.error('❌ DEPLOYER_PRIVATE_KEY environment variable not set')
    process.exit(1)
  }

  // Get validator addresses from environment
  const validatorAddressEnv = process.env.VALIDATOR_ADDRESSES
  if (!validatorAddressEnv && !dryRun) {
    console.error('❌ VALIDATOR_ADDRESSES environment variable not set')
    console.error(
      '   Format: comma-separated addresses, e.g., 0xabc...,0xdef...,0x123...',
    )
    process.exit(1)
  }
  const validatorAddresses = validatorAddressEnv?.split(',') ?? []

  // Create deployer account
  const account = privateKey
    ? privateKeyToAccount(privateKey as Hex)
    : privateKeyToAccount(
        '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex,
      )

  console.log(`Deployer: ${account.address}`)
  console.log(`Validators: ${validatorAddresses.length}`)
  console.log()

  // Build deployment configuration
  const chains = network === 'mainnet' ? MAINNET_CHAINS : TESTNET_CHAINS
  const filteredChains = skipSolana
    ? chains.filter((c) => c.chainType === 'evm')
    : chains

  const config: DeploymentConfig = {
    token: getDefaultTokenEconomics(),
    liquidity: getDefaultLiquidityConfig(),
    presale: getDefaultPresaleConfig(
      network === 'mainnet' ? 'mainnet' : 'testnet',
    ),
    cca: getDefaultCCAConfig(network === 'mainnet' ? 'mainnet' : 'testnet'),
    hyperlane: getDefaultHyperlaneConfig(account.address, validatorAddresses),
    chains: filteredChains,
    owner: account.address,
    timelockDelay: network === 'mainnet' ? 48 * 60 * 60 : 60 * 60, // 48h mainnet, 1h testnet
    deploymentSalt:
      '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex,
  }

  // Print configuration summary
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('TOKEN CONFIGURATION')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Name: ${config.token.name}`)
  console.log(`Symbol: ${config.token.symbol}`)
  console.log(`Total Supply: ${config.token.totalSupply.toLocaleString()}`)
  console.log()
  console.log('Allocation:')
  console.log(`  Public Sale: ${config.token.allocation.publicSale}%`)
  console.log(`  Presale: ${config.token.allocation.presale}%`)
  console.log(`  Team: ${config.token.allocation.team}%`)
  console.log(`  Advisors: ${config.token.allocation.advisors}%`)
  console.log(`  Ecosystem: ${config.token.allocation.ecosystem}%`)
  console.log(`  Liquidity: ${config.token.allocation.liquidity}%`)
  console.log(`  Staking Rewards: ${config.token.allocation.stakingRewards}%`)
  console.log()
  console.log('Fee Distribution:')
  console.log(`  Transfer Fee: ${config.token.fees.transferFeeBps / 100}%`)
  console.log(`  → Holders: ${config.token.fees.distribution.holders}%`)
  console.log(`  → Creators: ${config.token.fees.distribution.creators}%`)
  console.log(`  → Treasury: ${config.token.fees.distribution.treasury}%`)
  console.log(`  → LPs: ${config.token.fees.distribution.liquidityProviders}%`)
  console.log(`  → Burn: ${config.token.fees.distribution.burn}%`)
  console.log()
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('DEPLOYMENT CHAINS')
  console.log('═══════════════════════════════════════════════════════════════')
  for (const chain of config.chains) {
    console.log(
      `  ${chain.isHomeChain ? '★' : '○'} ${chain.name} (${chain.chainId})`,
    )
  }
  console.log()
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('LIQUIDITY ALLOCATION')
  console.log('═══════════════════════════════════════════════════════════════')
  for (const alloc of config.liquidity.allocations) {
    console.log(`  ${alloc.chainId}: ${alloc.percentage}% on ${alloc.dex}`)
  }
  console.log()

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No transactions will be executed')
    console.log()
    console.log('Configuration looks valid. Ready for deployment.')
    console.log()
    console.log('To deploy, run without --dry-run flag.')
    console.log()
    console.log('Notes:')
    console.log(
      '  • Contracts will be deployed via CREATE2 for deterministic addresses',
    )
    console.log('  • Warp routes will be configured for cross-chain transfers')
    console.log(
      '  • Solana requires manual SPL token creation + Hyperlane CLI setup',
    )
    console.log('  • Liquidity deployment requires ETH in deployer wallet')
    return
  }

  // Conditional imports: only loaded when not in dry-run mode to avoid loading heavy dependencies unnecessarily
  const { createWalletClient, http } = await import('viem')
  const {
    arbitrum,
    arbitrumSepolia,
    avalanche,
    base,
    baseSepolia,
    bsc,
    mainnet,
    optimism,
    polygon,
    sepolia,
  } = await import('viem/chains')
  const { MultiChainLauncher } = await import(
    '../deployer/multi-chain-launcher'
  )
  const { preloadAllArtifacts } = await import('../deployer/contract-deployer')

  const VIEM_CHAINS = {
    1: mainnet,
    10: optimism,
    56: bsc,
    137: polygon,
    8453: base,
    42161: arbitrum,
    43114: avalanche,
    11155111: sepolia,
    84532: baseSepolia,
    421614: arbitrumSepolia,
  } as const

  function getViemChain(chainId: number) {
    return VIEM_CHAINS[chainId as keyof typeof VIEM_CHAINS]
  }

  // Preload contract artifacts
  console.log('Loading contract artifacts...')
  await preloadAllArtifacts()
  console.log('✓ Artifacts loaded')
  console.log()

  // Create wallet clients for each chain
  const walletClients = new Map()

  for (const chain of config.chains) {
    if (chain.chainType !== 'evm') continue

    const viemChain = getViemChain(chain.chainId as number)
    if (!viemChain) continue

    const client = createWalletClient({
      account,
      chain: viemChain,
      transport: http(chain.rpcUrl),
    })

    walletClients.set(chain.chainId, client)
  }

  const launcher = new MultiChainLauncher(config, (progress) => {
    console.log(
      `[${progress.completedSteps}/${progress.totalSteps}] ${progress.currentStep?.name}: ${progress.currentStep?.status}`,
    )
  })

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('STARTING DEPLOYMENT')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log()

  const result = await launcher.deploy(walletClients)

  console.log()
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('DEPLOYMENT COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log()
  console.log('Deployed Contracts:')
  for (const deployment of result.deployments) {
    console.log(`  Chain ${deployment.chainId}:`)
    console.log(`    Token: ${deployment.token}`)
    console.log(`    Vesting: ${deployment.vesting}`)
    console.log(`    Fee Distributor: ${deployment.feeDistributor}`)
    console.log(`    Warp Route: ${deployment.warpRoute}`)
    if (deployment.presale) {
      console.log(`    Presale: ${deployment.presale}`)
    }
    if (deployment.ccaAuction) {
      console.log(`    CCA Auction: ${deployment.ccaAuction}`)
    }
    console.log()
  }

  // Save deployment result
  const outputPath = `./deployments/${network}-${Date.now()}.json`
  await Bun.write(
    outputPath,
    JSON.stringify(
      result,
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    ),
  )
  console.log(`Deployment saved to: ${outputPath}`)
}

main().catch(console.error)
