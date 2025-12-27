#!/usr/bin/env bun

/**
 * Bootstrap Prediction Markets for Bazaar
 *
 * Deploys PredictionOracle and PredictionMarket contracts, then creates sample markets.
 *
 * Usage:
 *   bun run scripts/bootstrap-prediction-markets.ts
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

// Anvil default key - ONLY for local development
const ANVIL_DEFAULT_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

/**
 * Get deployer key with safety checks.
 * Anvil default key only allowed for local RPCs.
 */
function getDeployerKey(): string {
  const envKey = process.env.PRIVATE_KEY
  if (envKey) return envKey

  const isLocalRpc =
    RPC_URL.includes('127.0.0.1') || RPC_URL.includes('localhost')
  if (!isLocalRpc) {
    throw new Error(
      'PRIVATE_KEY environment variable required for non-local deployments. ' +
        'The Anvil default key is only allowed for local development.',
    )
  }

  return ANVIL_DEFAULT_KEY
}

const DEPLOYER_KEY = getDeployerKey()

const CONTRACTS_DIR = join(import.meta.dirname, '../../../packages/contracts')

interface DeploymentResult {
  predictionOracle: string
  predictionMarket: string
  markets: Array<{
    sessionId: string
    question: string
    liquidity: string
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
    console.error(
      'Localnet not running. Start with: jeju dev or jeju infra start',
    )
    process.exit(1)
  }

  // Check contracts are built
  const predictionMarketArtifact = join(
    CONTRACTS_DIR,
    'out/PredictionMarket.sol/PredictionMarket.json',
  )
  if (!existsSync(predictionMarketArtifact)) {
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

function loadExistingContracts(): { usdc: string; jeju: string } | null {
  const localnetPath = join(CONTRACTS_DIR, 'deployments/localnet-complete.json')

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
  }
}

async function deployPredictionSystem(): Promise<DeploymentResult> {
  console.log('\n=== Deploying Prediction Market System ===\n')

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

  // Step 1: Deploy PredictionOracle
  console.log('\n1. Deploying PredictionOracle...')
  const predictionOracle = deployContract(
    'src/prediction/PredictionOracle.sol:PredictionOracle',
    [deployer], // owner
    'PredictionOracle',
  )

  // Step 2: Deploy PredictionMarket
  console.log('\n2. Deploying PredictionMarket...')
  // Constructor: (defaultToken, oracle, treasury, owner)
  const predictionMarket = deployContract(
    'src/prediction/PredictionMarket.sol:PredictionMarket',
    [
      tokens.usdc, // defaultToken (for betting)
      predictionOracle, // oracle
      deployer, // treasury
      deployer, // owner
    ],
    'PredictionMarket',
  )

  // Step 3: Enable JEJU as supported token
  console.log('\n3. Configuring supported tokens...')
  sendTx(
    predictionMarket,
    'setTokenSupport(address,bool)',
    [tokens.jeju, 'true'],
    'JEJU token enabled for betting',
  )

  // Step 4: Create sample prediction markets
  console.log('\n4. Creating sample prediction markets...')
  const markets = await createSampleMarkets(predictionMarket, predictionOracle)

  const result: DeploymentResult = {
    predictionOracle,
    predictionMarket,
    markets,
    deployedAt: new Date().toISOString(),
  }

  // Save deployment info
  saveDeployment(result)

  return result
}

async function createSampleMarkets(
  predictionMarket: string,
  predictionOracle: string,
): Promise<DeploymentResult['markets']> {
  const markets: DeploymentResult['markets'] = []

  // Sample prediction market questions
  const sampleMarkets = [
    {
      question: 'Will Bitcoin hit $150,000 by end of 2025?',
      liquidity: '1000000000000000000000', // 1000 tokens
    },
    {
      question: 'Will Ethereum 3.0 launch in Q1 2026?',
      liquidity: '1000000000000000000000',
    },
    {
      question: 'Will a major AI lab release AGI by 2027?',
      liquidity: '500000000000000000000', // 500 tokens
    },
    {
      question: 'Will the US Federal Reserve cut rates in January 2026?',
      liquidity: '1000000000000000000000',
    },
    {
      question: 'Will Jeju Network reach 10,000 daily active users?',
      liquidity: '2000000000000000000000', // 2000 tokens
    },
  ]

  for (let i = 0; i < sampleMarkets.length; i++) {
    const market = sampleMarkets[i]
    // Generate deterministic session ID from index
    const sessionIdHex = `0x${(i + 1).toString(16).padStart(64, '0')}`

    // Generate a commitment hash (keccak256 of outcome + salt)
    // outcome=true, salt=sessionId (simple for dev)
    const commitmentCmd = `cast keccak256 $(cast abi-encode "f(bool,bytes32)" true ${sessionIdHex})`
    const commitment = execSync(commitmentCmd, { encoding: 'utf-8' }).trim()

    try {
      // First, commit game to oracle (3 args: sessionId, question, commitment)
      sendTx(
        predictionOracle,
        'commitGame(bytes32,string,bytes32)',
        [sessionIdHex, market.question, commitment],
        `Oracle: Committed game ${i + 1}`,
      )

      // Create market on PredictionMarket (only owner can create)
      sendTx(
        predictionMarket,
        'createMarket(bytes32,string,uint256)',
        [sessionIdHex, market.question, market.liquidity],
        `Market: "${market.question.substring(0, 40)}..."`,
      )

      markets.push({
        sessionId: sessionIdHex,
        question: market.question,
        liquidity: market.liquidity,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.log(`    Skipped market ${i + 1}: ${msg}`)
    }
  }

  return markets
}

function saveDeployment(result: DeploymentResult): void {
  // Save to bazaar-specific deployment file
  const deployPath = join(CONTRACTS_DIR, 'deployments/bazaar-localnet.json')
  writeFileSync(deployPath, JSON.stringify(result, null, 2))
  console.log(`\nSaved: ${deployPath}`)

  // Update main localnet deployment
  const localnetPath = join(CONTRACTS_DIR, 'deployments/localnet-complete.json')
  if (existsSync(localnetPath)) {
    const data = JSON.parse(readFileSync(localnetPath, 'utf-8'))
    if (!data.contracts) data.contracts = {}
    data.contracts.predictionOracle = result.predictionOracle
    data.contracts.predictionMarket = result.predictionMarket
    writeFileSync(localnetPath, JSON.stringify(data, null, 2))
    console.log(`Updated: ${localnetPath}`)
  }

  // Update localnet/deployment.json
  const deploymentJsonPath = join(
    CONTRACTS_DIR,
    'deployments/localnet/deployment.json',
  )
  if (existsSync(deploymentJsonPath)) {
    const data = JSON.parse(readFileSync(deploymentJsonPath, 'utf-8'))
    if (!data.bazaar) data.bazaar = {}
    data.bazaar.predictionMarket = result.predictionMarket
    data.bazaar.predictionOracle = result.predictionOracle
    writeFileSync(deploymentJsonPath, JSON.stringify(data, null, 2))
    console.log(`Updated: ${deploymentJsonPath}`)
  }

  // Create env vars for bazaar
  const envPath = join(import.meta.dirname, '../.env.local')
  const envContent = `# Prediction Market Contracts (auto-generated)
# Generated: ${result.deployedAt}

PREDICTION_ORACLE_ADDRESS=${result.predictionOracle}
PREDICTION_MARKET_ADDRESS=${result.predictionMarket}
INDEXER_URL=http://localhost:4350/graphql
`
  writeFileSync(envPath, envContent)
  console.log(`Created: ${envPath}`)
}

function printSummary(result: DeploymentResult): void {
  console.log(`\n${'='.repeat(60)}`)
  console.log('PREDICTION MARKET BOOTSTRAP COMPLETE')
  console.log('='.repeat(60))
  console.log('\nContracts:')
  console.log(`  PredictionOracle:  ${result.predictionOracle}`)
  console.log(`  PredictionMarket:  ${result.predictionMarket}`)
  console.log(`\nMarkets Created: ${result.markets.length}`)
  for (const market of result.markets) {
    console.log(`  - ${market.question.substring(0, 50)}...`)
  }
  console.log('\nNext Steps:')
  console.log(
    '  1. Start the indexer: cd apps/indexer && bun run db:up && bun run dev:full',
  )
  console.log('  2. Restart bazaar: cd apps/bazaar && bun run dev')
  console.log('  3. Markets should now appear in the UI')
  console.log('')
}

// Main
async function main(): Promise<void> {
  console.log('Bazaar Prediction Market Bootstrap')
  console.log('==================================\n')

  checkPrerequisites()
  const result = await deployPredictionSystem()
  printSummary(result)
}

main().catch((error) => {
  console.error('Bootstrap failed:', error)
  process.exit(1)
})
