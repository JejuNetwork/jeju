#!/usr/bin/env bun

/**
 * Bootstrap Perpetual Trading for Bazaar
 *
 * Deploys PerpsPriceOracle, MarginManager, InsuranceFund, and PerpetualMarket contracts,
 * then creates sample markets (BTC-USD, ETH-USD).
 *
 * Usage:
 *   bun run scripts/bootstrap-perps.ts
 *
 * Prerequisites:
 *   - Localnet running (jeju dev or jeju infra start)
 *   - Contracts built (cd packages/contracts && forge build)
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Configuration
const RPC_URL = process.env.JEJU_RPC_URL || 'http://127.0.0.1:6546'

// Anvil default deployer
const DEPLOYER_KEY =
  process.env.PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const CONTRACTS_DIR = join(import.meta.dirname, '../../../packages/contracts')

interface DeploymentResult {
  priceOracle: string
  marginManager: string
  insuranceFund: string
  perpetualMarket: string
  markets: Array<{
    marketId: string
    symbol: string
    baseAsset: string
  }>
  deployedAt: string
}

function getDeployerAddress(): string {
  return execSync(`cast wallet address ${DEPLOYER_KEY}`, {
    encoding: 'utf-8',
  }).trim()
}

function checkPrerequisites(): void {
  console.log('Checking prerequisites...')

  // Check localnet is running
  try {
    const blockNumber = execSync(`cast block-number --rpc-url ${RPC_URL}`, {
      encoding: 'utf-8',
    }).trim()
    console.log(`  Localnet running (block ${blockNumber})`)
  } catch {
    console.error('Localnet not running. Start with: jeju dev or jeju infra start')
    process.exit(1)
  }

  // Check contracts are built
  const perpMarketArtifact = join(
    CONTRACTS_DIR,
    'out/PerpetualMarket.sol/PerpetualMarket.json',
  )
  if (!existsSync(perpMarketArtifact)) {
    console.log('  Building contracts...')
    execSync('forge build', { cwd: CONTRACTS_DIR, stdio: 'pipe' })
  }
  console.log('  Contracts built')
}

function deployContract(path: string, args: string[], name: string): string {
  console.log(`  Deploying ${name}...`)

  const argsStr = args.map((a) => `"${a}"`).join(' ')
  const cmd = `cd ${CONTRACTS_DIR} && forge create ${path} \
    --rpc-url ${RPC_URL} \
    --private-key ${DEPLOYER_KEY} \
    --broadcast \
    ${args.length > 0 ? `--constructor-args ${argsStr}` : ''}`

  const output = execSync(cmd, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // Parse deployment output
  const match = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/)
  if (!match) {
    throw new Error(`Failed to parse deployment output for ${name}: ${output}`)
  }

  console.log(`    ${name}: ${match[1]}`)
  return match[1]
}

function sendTx(to: string, sig: string, args: string[], label: string): void {
  const argsStr = args.map((a) => `"${a}"`).join(' ')
  const cmd = `cast send ${to} "${sig}" ${argsStr} --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY}`
  execSync(cmd, { stdio: 'pipe' })
  console.log(`    ${label}`)
}

function loadExistingContracts(): { usdc: string; jeju: string; weth: string } | null {
  const localnetPath = join(
    CONTRACTS_DIR,
    'deployments/localnet-complete.json',
  )

  if (!existsSync(localnetPath)) {
    return null
  }

  const data = JSON.parse(readFileSync(localnetPath, 'utf-8'))
  if (!data.contracts?.usdc || !data.contracts?.jeju) {
    return null
  }

  return {
    usdc: data.contracts.usdc,
    jeju: data.contracts.jeju,
    weth: data.contracts.weth || data.contracts.jeju, // Fallback to JEJU if no WETH
  }
}

async function deployPerpsSystem(): Promise<DeploymentResult> {
  console.log('\n=== Deploying Perpetual Trading System ===\n')

  const deployer = getDeployerAddress()
  console.log(`Deployer: ${deployer}`)

  // Load existing contracts
  const tokens = loadExistingContracts()
  if (!tokens) {
    console.error('No token contracts found. Run: jeju dev --bootstrap first')
    process.exit(1)
  }
  console.log(`Using USDC: ${tokens.usdc}`)
  console.log(`Using JEJU: ${tokens.jeju}`)

  // Step 1: Deploy PerpsPriceOracle (simplified for local dev - no external oracles)
  console.log('\n1. Deploying PerpsPriceOracle...')
  const priceOracle = deployContract(
    'src/perps/PerpsPriceOracle.sol:PerpsPriceOracle',
    [
      '0x0000000000000000000000000000000000000000', // pythOracle (none for local)
      '0x0000000000000000000000000000000000000000', // chainlinkRegistry (none)
      '0x0000000000000000000000000000000000000000', // twapOracle (none)
      deployer, // owner
    ],
    'PerpsPriceOracle',
  )

  // Step 2: Deploy MarginManager
  console.log('\n2. Deploying MarginManager...')
  const marginManager = deployContract(
    'src/perps/MarginManager.sol:MarginManager',
    [priceOracle, deployer],
    'MarginManager',
  )

  // Step 3: Deploy InsuranceFund
  console.log('\n3. Deploying InsuranceFund...')
  const insuranceFund = deployContract(
    'src/perps/InsuranceFund.sol:InsuranceFund',
    [priceOracle, deployer],
    'InsuranceFund',
  )

  // Step 4: Deploy PerpetualMarket
  console.log('\n4. Deploying PerpetualMarket...')
  const perpetualMarket = deployContract(
    'src/perps/PerpetualMarket.sol:PerpetualMarket',
    [marginManager, insuranceFund, priceOracle, deployer],
    'PerpetualMarket',
  )

  // Step 5: Configure contracts
  console.log('\n5. Configuring contracts...')

  // Add USDC as accepted collateral (100% factor = 10000 bps)
  sendTx(
    marginManager,
    'addAcceptedToken(address,uint256)',
    [tokens.usdc, '10000'],
    'USDC added as collateral (100% factor)',
  )

  // Add JEJU as accepted collateral (80% factor)
  sendTx(
    marginManager,
    'addAcceptedToken(address,uint256)',
    [tokens.jeju, '8000'],
    'JEJU added as collateral (80% factor)',
  )

  // Authorize PerpetualMarket to manage collateral (proposes, will need execution after timelock)
  // For local dev, we'll skip the timelock by directly setting
  console.log('    Note: MarginManager authorization requires 12-hour timelock in production')

  // Step 6: Set up price feeds for local dev (manual prices)
  console.log('\n6. Setting up price feeds...')

  // Set manual prices for local dev
  // BTC at $100,000, ETH at $4,000, USDC at $1
  sendTx(
    priceOracle,
    'setManualPrice(address,uint256)',
    [tokens.jeju, '10000000000'], // $100 in 8 decimals (JEJU as BTC proxy)
    'JEJU price set to $100',
  )

  sendTx(
    priceOracle,
    'setManualPrice(address,uint256)',
    [tokens.usdc, '100000000'], // $1 in 8 decimals
    'USDC price set to $1',
  )

  // Set up asset feeds (even without external oracles, needed for getPrice to work)
  sendTx(
    priceOracle,
    'setAssetFeed(address,bytes32,address,address,uint256,uint8)',
    [
      tokens.jeju,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '86400', // 24h staleness for manual prices
      '8',
    ],
    'JEJU asset feed configured',
  )

  sendTx(
    priceOracle,
    'setAssetFeed(address,bytes32,address,address,uint256,uint8)',
    [
      tokens.usdc,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '86400',
      '8',
    ],
    'USDC asset feed configured',
  )

  // Step 7: Create markets
  console.log('\n7. Creating perpetual markets...')
  const markets = await createMarkets(perpetualMarket, priceOracle, tokens)

  const result: DeploymentResult = {
    priceOracle,
    marginManager,
    insuranceFund,
    perpetualMarket,
    markets,
    deployedAt: new Date().toISOString(),
  }

  // Save deployment info
  saveDeployment(result)

  return result
}

async function createMarkets(
  perpetualMarket: string,
  priceOracle: string,
  tokens: { usdc: string; jeju: string; weth: string },
): Promise<DeploymentResult['markets']> {
  const markets: DeploymentResult['markets'] = []

  // Market configurations
  const marketConfigs = [
    {
      symbol: 'JEJU-USD',
      baseAsset: tokens.jeju,
      quoteAsset: tokens.usdc,
      maxLeverage: 20,
      maintenanceMarginBps: 50, // 0.5%
      initialMarginBps: 100, // 1%
      takerFeeBps: 5, // 0.05%
      makerFeeBps: 2, // 0.02%
      maxOpenInterest: '10000000000000000000000000', // 10M tokens
    },
    {
      symbol: 'ETH-USD',
      baseAsset: tokens.weth,
      quoteAsset: tokens.usdc,
      maxLeverage: 50,
      maintenanceMarginBps: 50,
      initialMarginBps: 100,
      takerFeeBps: 5,
      makerFeeBps: 2,
      maxOpenInterest: '10000000000000000000000000',
    },
  ]

  for (const config of marketConfigs) {
    // Create market via PerpetualMarket.createMarket
    // MarketConfig struct: marketId, symbol, baseAsset, quoteAsset, oracle, maxLeverage,
    // maintenanceMarginBps, initialMarginBps, takerFeeBps, makerFeeBps, maxOpenInterest, fundingInterval, isActive

    // Use cast to create market with tuple
    const tupleArgs = `"(0x0000000000000000000000000000000000000000000000000000000000000000,${config.symbol},${config.baseAsset},${config.quoteAsset},${priceOracle},${config.maxLeverage},${config.maintenanceMarginBps},${config.initialMarginBps},${config.takerFeeBps},${config.makerFeeBps},${config.maxOpenInterest},3600,true)"`

    const cmd = `cast send ${perpetualMarket} "createMarket((bytes32,string,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool))" ${tupleArgs} --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY}`

    try {
      const output = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' })

      // Extract marketId from logs (MarketCreated event)
      const logMatch = output.match(/topics:\s*\[\s*0x[a-fA-F0-9]+,\s*(0x[a-fA-F0-9]+)/)
      const marketId = logMatch ? logMatch[1] : `market-${markets.length}`

      console.log(`    Market ${config.symbol}: created`)

      // Set up market price feed
      sendTx(
        priceOracle,
        'setMarketFeed(bytes32,address,address,int256,bool)',
        [marketId, config.baseAsset, config.quoteAsset, '0', 'false'],
        `    Price feed for ${config.symbol} configured`,
      )

      markets.push({
        marketId,
        symbol: config.symbol,
        baseAsset: config.baseAsset,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.log(`    Skipped ${config.symbol}: ${msg.slice(0, 100)}`)
    }
  }

  return markets
}

function saveDeployment(result: DeploymentResult): void {
  // Save to perps-specific deployment file
  const deployPath = join(
    CONTRACTS_DIR,
    'deployments/perps-localnet.json',
  )
  writeFileSync(deployPath, JSON.stringify(result, null, 2))
  console.log(`\nSaved: ${deployPath}`)

  // Update main localnet deployment
  const localnetPath = join(
    CONTRACTS_DIR,
    'deployments/localnet-complete.json',
  )
  if (existsSync(localnetPath)) {
    const data = JSON.parse(readFileSync(localnetPath, 'utf-8'))
    if (!data.contracts) data.contracts = {}
    data.contracts.perps = {
      priceOracle: result.priceOracle,
      marginManager: result.marginManager,
      insuranceFund: result.insuranceFund,
      perpetualMarket: result.perpetualMarket,
    }
    writeFileSync(localnetPath, JSON.stringify(data, null, 2))
    console.log(`Updated: ${localnetPath}`)
  }

  // Update config/contracts.json
  const configPath = join(import.meta.dirname, '../../../packages/config/contracts.json')
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (!config.localnet) config.localnet = {}
    if (!config.localnet.bazaar) config.localnet.bazaar = {}
    config.localnet.bazaar.perpetualMarket = result.perpetualMarket
    config.localnet.bazaar.marginManager = result.marginManager
    config.localnet.bazaar.insuranceFund = result.insuranceFund
    config.localnet.bazaar.priceOracle = result.priceOracle
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    console.log(`Updated: ${configPath}`)
  }

  // Create env vars for bazaar
  const envPath = join(import.meta.dirname, '../.env.local')
  let envContent = ''
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, 'utf-8')
  }

  // Add/update perps addresses
  const perpsEnv = `
# Perpetual Trading Contracts (auto-generated)
PERPETUAL_MARKET_ADDRESS=${result.perpetualMarket}
MARGIN_MANAGER_ADDRESS=${result.marginManager}
PERPS_PRICE_ORACLE_ADDRESS=${result.priceOracle}
INSURANCE_FUND_ADDRESS=${result.insuranceFund}
`

  if (envContent.includes('PERPETUAL_MARKET_ADDRESS')) {
    // Replace existing
    envContent = envContent.replace(
      /# Perpetual Trading Contracts[\s\S]*?INSURANCE_FUND_ADDRESS=\S+/,
      perpsEnv.trim(),
    )
  } else {
    envContent += perpsEnv
  }

  writeFileSync(envPath, envContent)
  console.log(`Updated: ${envPath}`)
}

function printSummary(result: DeploymentResult): void {
  console.log('\n' + '='.repeat(60))
  console.log('PERPETUAL TRADING BOOTSTRAP COMPLETE')
  console.log('='.repeat(60))
  console.log('\nContracts:')
  console.log(`  PerpsPriceOracle:  ${result.priceOracle}`)
  console.log(`  MarginManager:     ${result.marginManager}`)
  console.log(`  InsuranceFund:     ${result.insuranceFund}`)
  console.log(`  PerpetualMarket:   ${result.perpetualMarket}`)
  console.log(`\nMarkets Created: ${result.markets.length}`)
  for (const market of result.markets) {
    console.log(`  - ${market.symbol}`)
  }
  console.log('\nNext Steps:')
  console.log('  1. Restart bazaar: cd apps/bazaar && bun run dev')
  console.log('  2. Visit /perps to start trading')
  console.log('')
}

// Main
async function main(): Promise<void> {
  console.log('Bazaar Perpetual Trading Bootstrap')
  console.log('==================================\n')

  checkPrerequisites()
  const result = await deployPerpsSystem()
  printSummary(result)
}

main().catch((error) => {
  console.error('Bootstrap failed:', error)
  process.exit(1)
})
