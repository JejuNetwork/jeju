#!/usr/bin/env bun

/**
 * Bazaar Development Seeder
 *
 * Seeds development environment with test data:
 * - Deploys TokenFactory and creates test coins
 * - Mints NFTs to SimpleCollectible
 * - Bootstraps prediction markets and perps
 *
 * Usage:
 *   bun run scripts/seed.ts
 *   jeju seed app bazaar
 *
 * Prerequisites:
 *   - Localnet running (jeju dev)
 *   - Contracts deployed (jeju dev --bootstrap)
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getL2RpcUrl, getLocalhostHost } from '@jejunetwork/config'
import {
  bootstrapPerps,
  bootstrapPredictionMarkets,
  savePerpsDeployment,
  savePredictionMarketDeployment,
} from '../lib/bootstrap'
import { getDeployerKey } from '../lib/secrets'

const RPC_URL = getL2RpcUrl()
const DEPLOYER_KEY = getDeployerKey(RPC_URL)
const CONTRACTS_DIR = join(import.meta.dirname, '../../../packages/contracts')
const CONFIG_DIR = join(import.meta.dirname, '../../../packages/config')

interface SeedResult {
  tokenFactory: string
  coins: Array<{
    address: string
    name: string
    symbol: string
    supply: string
  }>
  nfts: Array<{ tokenId: number; uri: string }>
  predictionMarkets: number
  perpMarkets: number
  seededAt: string
  warnings: string[]
}

// Track seeding warnings globally
const seedWarnings: string[] = []

function exec(cmd: string, options?: { cwd?: string }): string {
  return execSync(cmd, {
    encoding: 'utf-8',
    cwd: options?.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
  }).trim()
}

function getDeployerAddress(): string {
  return exec(`cast wallet address ${DEPLOYER_KEY}`)
}

function checkPrerequisites(): void {
  console.log('Checking prerequisites...')

  try {
    const blockNumber = exec(`cast block-number --rpc-url ${RPC_URL}`)
    console.log(`  Localnet running (block ${blockNumber})`)
  } catch {
    console.error('Localnet not running. Start with: jeju dev')
    process.exit(1)
  }

  const tokenFactoryArtifact = join(
    CONTRACTS_DIR,
    'out/TokenFactory.sol/SimpleERC20Factory.json',
  )
  if (!existsSync(tokenFactoryArtifact)) {
    console.log('  Building contracts...')
    exec('forge build', { cwd: CONTRACTS_DIR })
  }
  console.log('  Contracts built')
}

function loadConfig(): {
  simpleCollectible: string
  usdc: string
  jeju: string
} {
  const configPath = join(CONFIG_DIR, 'contracts.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  const localnet = config.localnet

  if (!localnet?.bazaar?.simpleCollectible) {
    throw new Error('SimpleCollectible not deployed. Run: jeju dev --bootstrap')
  }

  return {
    simpleCollectible: localnet.bazaar.simpleCollectible,
    usdc: localnet.tokens?.usdc || '',
    jeju: localnet.tokens?.jeju || '',
  }
}

function deployContract(path: string, args: string[], name: string): string {
  console.log(`  Deploying ${name}...`)

  const argsStr = args.map((a) => `"${a}"`).join(' ')
  const cmd = `cd ${CONTRACTS_DIR} && forge create ${path} \
    --rpc-url ${RPC_URL} \
    --private-key ${DEPLOYER_KEY} \
    --broadcast \
    ${args.length > 0 ? `--constructor-args ${argsStr}` : ''}`

  const output = exec(cmd)
  const match = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/)
  if (!match) {
    throw new Error(`Failed to parse deployment output for ${name}`)
  }

  console.log(`    ${name}: ${match[1]}`)
  return match[1]
}

function sendTx(
  to: string,
  sig: string,
  args: string[],
  label: string,
  value?: string,
): string {
  const argsStr = args.map((a) => `"${a}"`).join(' ')
  const valueFlag = value ? `--value ${value}` : ''
  const cmd = `cast send ${to} "${sig}" ${argsStr} --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY} ${valueFlag}`
  const output = exec(cmd)
  console.log(`    ${label}`)
  return output
}

function callContract(to: string, sig: string, args: string[] = []): string {
  const argsStr = args.map((a) => `"${a}"`).join(' ')
  const cmd = `cast call ${to} "${sig}" ${argsStr} --rpc-url ${RPC_URL}`
  return exec(cmd)
}

async function deployTokenFactory(): Promise<string> {
  return deployContract(
    'src/tokens/TokenFactory.sol:SimpleERC20Factory',
    [],
    'SimpleERC20Factory',
  )
}

async function createTestCoins(
  tokenFactory: string,
): Promise<SeedResult['coins']> {
  console.log('\n3. Creating test coins...')

  const coins: SeedResult['coins'] = []
  const testTokens = [
    {
      name: 'Bazaar Test Token',
      symbol: 'BZRT',
      decimals: 18,
      supply: '1000000000000000000000000',
    },
    {
      name: 'Meme Coin',
      symbol: 'MEME',
      decimals: 18,
      supply: '1000000000000000000000000000',
    },
    {
      name: 'Degen Token',
      symbol: 'DEGEN',
      decimals: 18,
      supply: '100000000000000000000000',
    },
  ]

  for (const token of testTokens) {
    try {
      sendTx(
        tokenFactory,
        'createToken(string,string,uint8,uint256)',
        [token.name, token.symbol, token.decimals.toString(), token.supply],
        `Created $${token.symbol}`,
      )

      const tokenCount = callContract(tokenFactory, 'tokenCount()')
      const count = parseInt(tokenCount, 16)
      const tokenAddressRaw = callContract(tokenFactory, 'allTokens(uint256)', [
        (count - 1).toString(),
      ])
      const tokenAddress = `0x${tokenAddressRaw.slice(-40)}`

      coins.push({
        address: tokenAddress,
        name: token.name,
        symbol: token.symbol,
        supply: token.supply,
      })

      console.log(`      Address: ${tokenAddress}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const warning = `Token ${token.symbol} creation failed: ${msg.slice(0, 80)}`
      console.log(`    WARNING: ${warning}`)
      seedWarnings.push(warning)
    }
  }

  return coins
}

async function mintTestNFTs(
  simpleCollectible: string,
): Promise<SeedResult['nfts']> {
  console.log('\n4. Minting test NFTs...')

  const nfts: SeedResult['nfts'] = []
  // Test NFTs with valid data URIs for development
  const testNFTs = [
    {
      uri: 'data:application/json,{"name":"Bazaar Genesis 1","description":"Test NFT for development"}',
      name: 'Bazaar Genesis #1',
    },
    {
      uri: 'data:application/json,{"name":"Bazaar Genesis 2","description":"Test NFT for development"}',
      name: 'Bazaar Genesis #2',
    },
    {
      uri: 'data:application/json,{"name":"Rare Collectible","description":"Test rare NFT"}',
      name: 'Rare Collectible',
    },
    {
      uri: 'data:application/json,{"name":"HTTP NFT","description":"Test HTTP metadata NFT"}',
      name: 'HTTP Metadata NFT',
    },
  ]

  let mintFee = '0'
  try {
    const feeHex = callContract(simpleCollectible, 'mintFee()')
    mintFee = BigInt(feeHex).toString()
  } catch {
    // No fee or not supported
  }

  for (const nft of testNFTs) {
    try {
      sendTx(
        simpleCollectible,
        'mint(string)',
        [nft.uri],
        `Minted: ${nft.name}`,
        mintFee !== '0' ? mintFee : undefined,
      )

      const nextIdHex = callContract(simpleCollectible, 'nextTokenId()')
      const tokenId = parseInt(nextIdHex, 16) - 1

      nfts.push({ tokenId, uri: nft.uri })
      console.log(`      Token ID: ${tokenId}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const warning = `NFT ${nft.name} mint failed: ${msg.slice(0, 80)}`
      console.log(`    WARNING: ${warning}`)
      seedWarnings.push(warning)
    }
  }

  return nfts
}

function getExistingTokenFactory(): string | null {
  const seedFile = join(import.meta.dirname, '../.seed-state.json')
  if (existsSync(seedFile)) {
    const state = JSON.parse(readFileSync(seedFile, 'utf-8'))
    if (state.tokenFactory) {
      try {
        const code = exec(
          `cast code ${state.tokenFactory} --rpc-url ${RPC_URL}`,
        )
        if (code !== '0x') return state.tokenFactory
      } catch {
        // Not deployed
      }
    }
  }

  const configPath = join(CONFIG_DIR, 'contracts.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  const factory = config.localnet?.bazaar?.tokenFactory
  if (factory && factory !== '') {
    try {
      const code = exec(`cast code ${factory} --rpc-url ${RPC_URL}`)
      if (code !== '0x') return factory
    } catch {
      // Not deployed
    }
  }

  return null
}

function checkIfSeedingNeeded(
  config: { simpleCollectible: string },
  tokenFactory: string | null,
): { needsSeeding: boolean; tokenCount: number; nftCount: number } {
  let tokenCount = 0
  let nftCount = 0

  if (tokenFactory) {
    try {
      const countHex = callContract(tokenFactory, 'tokenCount()')
      tokenCount = parseInt(countHex, 16)
    } catch {
      // Factory doesn't exist
    }
  }

  try {
    const totalSupplyHex = callContract(
      config.simpleCollectible,
      'totalSupply()',
    )
    nftCount = parseInt(totalSupplyHex, 16)
  } catch {
    // Contract doesn't exist
  }

  return {
    needsSeeding: tokenCount === 0 && nftCount === 0,
    tokenCount,
    nftCount,
  }
}

function saveSeedState(result: SeedResult): void {
  const seedFile = join(import.meta.dirname, '../.seed-state.json')
  writeFileSync(seedFile, JSON.stringify(result, null, 2))
  console.log(`\nSaved seed state: ${seedFile}`)

  const configPath = join(CONFIG_DIR, 'contracts.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))

  if (!config.localnet.bazaar) config.localnet.bazaar = {}
  config.localnet.bazaar.tokenFactory = result.tokenFactory

  if (result.coins.length > 0) {
    config.localnet.bazaar.featuredToken = result.coins[0].address
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2))
  console.log(`Updated: ${configPath}`)
}

function printSummary(result: SeedResult): void {
  console.log(`\n${'='.repeat(60)}`)
  console.log('BAZAAR SEED COMPLETE')
  console.log('='.repeat(60))

  console.log('\nContracts:')
  console.log(`  TokenFactory:      ${result.tokenFactory}`)

  console.log(`\nCoins Created: ${result.coins.length}`)
  for (const coin of result.coins) {
    console.log(`  $${coin.symbol}: ${coin.address}`)
  }

  console.log(`\nNFTs Minted: ${result.nfts.length}`)
  for (const nft of result.nfts) {
    console.log(`  Token #${nft.tokenId}: ${nft.uri.slice(0, 40)}...`)
  }

  console.log(`\nPrediction Markets: ${result.predictionMarkets}`)
  console.log(`Perp Markets: ${result.perpMarkets}`)

  // Show warnings if any
  if (result.warnings.length > 0) {
    console.log('\nWarnings:')
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`)
    }
  }

  const host = getLocalhostHost()
  console.log('\nNext Steps:')
  console.log(`  1. Open Bazaar: http://${host}:4006`)
  console.log('  2. Connect wallet (use Anvil dev account)')
  console.log('  3. Browse Coins, Items, and Prediction markets')

  if (result.warnings.length > 0) {
    console.log(
      `\nSeeding completed with ${result.warnings.length} warning(s).\n`,
    )
  } else {
    console.log('\nSeeding completed successfully.\n')
  }
}

async function main(): Promise<void> {
  console.log('Bazaar Development Seeder')
  console.log('=========================\n')

  const forceFlag = process.argv.includes('--force')

  checkPrerequisites()

  const deployer = getDeployerAddress()
  console.log(`Deployer: ${deployer}`)

  const config = loadConfig()
  console.log(`SimpleCollectible: ${config.simpleCollectible}`)

  const existingFactory = getExistingTokenFactory()
  const { needsSeeding, tokenCount, nftCount } = checkIfSeedingNeeded(
    config,
    existingFactory,
  )

  if (!needsSeeding && !forceFlag) {
    console.log('\n  Market already has data:')
    console.log(`    Tokens: ${tokenCount}`)
    console.log(`    NFTs: ${nftCount}`)
    console.log('\n  Skipping seed (use --force to re-seed)')
    return
  }

  if (forceFlag && !needsSeeding) {
    console.log(
      `\n  Forcing re-seed (existing: ${tokenCount} tokens, ${nftCount} NFTs)`,
    )
  }

  // Step 1: Deploy TokenFactory
  console.log('\n1. Setting up TokenFactory...')
  const tokenFactory = existingFactory ?? (await deployTokenFactory())

  // Step 2: Create test coins
  let coins: SeedResult['coins'] = []
  if (tokenCount === 0 || forceFlag) {
    coins = await createTestCoins(tokenFactory)
  } else {
    console.log(`\n3. Skipping coins (${tokenCount} already exist)`)
  }

  // Step 3: Mint test NFTs
  let nfts: SeedResult['nfts'] = []
  if (nftCount === 0 || forceFlag) {
    nfts = await mintTestNFTs(config.simpleCollectible)
  } else {
    console.log(`\n4. Skipping NFTs (${nftCount} already exist)`)
  }

  // Step 4: Bootstrap prediction markets
  console.log('\n5. Bootstrapping prediction markets...')
  let predictionMarketCount = 0
  try {
    const predictionResult = await bootstrapPredictionMarkets(
      RPC_URL,
      CONTRACTS_DIR,
    )
    if (predictionResult) {
      predictionMarketCount = predictionResult.markets.length
      savePredictionMarketDeployment(CONTRACTS_DIR, predictionResult)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const warning = `Prediction markets bootstrap failed: ${msg.slice(0, 80)}`
    console.log(`  WARNING: ${warning}`)
    seedWarnings.push(warning)
  }

  // Step 5: Bootstrap perps
  console.log('\n6. Bootstrapping perpetual trading...')
  let perpMarketCount = 0
  try {
    const perpsResult = await bootstrapPerps(RPC_URL, CONTRACTS_DIR)
    if (perpsResult) {
      perpMarketCount = perpsResult.markets.length
      savePerpsDeployment(CONTRACTS_DIR, perpsResult)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const warning = `Perps bootstrap failed: ${msg.slice(0, 80)}`
    console.log(`  WARNING: ${warning}`)
    seedWarnings.push(warning)
  }

  const result: SeedResult = {
    tokenFactory,
    coins,
    nfts,
    predictionMarkets: predictionMarketCount,
    perpMarkets: perpMarketCount,
    seededAt: new Date().toISOString(),
    warnings: seedWarnings,
  }

  saveSeedState(result)
  printSummary(result)
}

main().catch((error) => {
  console.error('Seed failed:', error)
  process.exit(1)
})
