#!/usr/bin/env bun

/**
 * Bazaar Deployment Script
 *
 * Deploys and seeds all Bazaar contracts:
 * - JEJU Token
 * - Prediction Markets (with "Will Jeju go mainnet in 2026?")
 * - Perpetual Trading (JEJU-USD market)
 * - NFT Collection (Jeju Genesis)
 *
 * Usage:
 *   bun run scripts/deploy-testnet.ts                           # Testnet (default)
 *   bun run scripts/deploy-testnet.ts --network localnet        # Localnet
 *   PRIVATE_KEY=0x... bun run scripts/deploy-testnet.ts         # With custom key
 *
 * Prerequisites:
 *   - Target network RPC accessible and producing blocks
 *   - Deployer wallet with ETH for gas
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Address, createPublicClient, formatEther, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getDeployerKey } from '../lib/secrets'

// Network configurations
const NETWORKS = {
  testnet: {
    name: 'testnet',
    chainId: 420690,
    rpcUrl: 'https://testnet-rpc.jejunetwork.org',
    blockTime: 2000, // 2s block time
    minBlockAge: 60, // Blocks should be at most 60s old
  },
  localnet: {
    name: 'localnet',
    chainId: 31337,
    rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
    blockTime: 1000,
    minBlockAge: 300, // More lenient for localnet
  },
} as const

type NetworkName = keyof typeof NETWORKS

interface DeploymentResult {
  chainId: number
  network: string
  deployedAt: string
  deployer: string
  contracts: {
    jeju: string
    usdc: string
    tokenFactory: string
    predictionOracle: string
    predictionMarket: string
    perpetualMarket: string
    marginManager: string
    insuranceFund: string
    priceOracle: string
    simpleCollectible: string
    nftMarketplace: string
    tfmmPools: Array<{
      address: string
      name: string
      symbol: string
      tokens: string[]
    }>
  }
  markets: {
    predictions: Array<{
      sessionId: string
      question: string
      liquidity: string
    }>
    perps: Array<{
      marketId: string
      symbol: string
    }>
  }
  warnings: string[]
}

// Track deployment warnings globally
const deploymentWarnings: string[] = []

function parseArgs(): { network: NetworkName; forceDeploy: boolean } {
  const args = process.argv.slice(2)
  let network: NetworkName = 'testnet'
  let forceDeploy = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--network' && args[i + 1]) {
      const n = args[i + 1] as NetworkName
      if (n in NETWORKS) {
        network = n
      } else {
        throw new Error(
          `Unknown network: ${n}. Valid options: ${Object.keys(NETWORKS).join(', ')}`,
        )
      }
    }
    if (args[i] === '--force-deploy' || args[i] === '--force') {
      forceDeploy = true
    }
  }

  return { network, forceDeploy }
}

// Used below in main()
function getDeployerKeyForNetwork(networkName: NetworkName): string {
  const config = NETWORKS[networkName]
  return getDeployerKey(config.rpcUrl)
}

const CONTRACTS_DIR = join(import.meta.dirname, '../../../packages/contracts')
const CONFIG_DIR = join(import.meta.dirname, '../../../packages/config')

function exec(cmd: string, options?: { cwd?: string }): string {
  const displayCmd = cmd.length > 100 ? `${cmd.slice(0, 97)}...` : cmd
  console.log(`  > ${displayCmd}`)
  return execSync(cmd, {
    encoding: 'utf-8',
    cwd: options?.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
  }).trim()
}

async function checkChainHealth(
  rpcUrl: string,
  config: (typeof NETWORKS)[NetworkName],
): Promise<void> {
  console.log('\nChecking chain health...')

  const client = createPublicClient({
    transport: http(rpcUrl),
  })

  // Check connectivity
  let blockNumber: bigint
  try {
    blockNumber = await client.getBlockNumber()
    console.log(`  Block number: ${blockNumber}`)
  } catch (error) {
    throw new Error(
      `Cannot connect to RPC at ${rpcUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }

  // Check chain ID
  const chainId = await client.getChainId()
  if (chainId !== config.chainId) {
    throw new Error(
      `Chain ID mismatch. Expected ${config.chainId}, got ${chainId}`,
    )
  }
  console.log(`  Chain ID: ${chainId}`)

  // Check if blocks are being produced
  const block = await client.getBlock({ blockNumber })
  const blockAge = Math.floor(Date.now() / 1000) - Number(block.timestamp)

  console.log(`  Latest block age: ${blockAge}s`)

  // For localnet (Anvil), blocks are produced on-demand, so we just need to verify
  // the chain responds. For testnet, we need blocks to be recent.
  if (config.name === 'localnet') {
    // Anvil produces blocks on-demand, just verify we can send a transaction
    console.log('  Localnet detected (on-demand block production)')
    console.log('  Chain is ready')
    return
  }

  if (blockAge > config.minBlockAge) {
    const blockDate = new Date(Number(block.timestamp) * 1000).toISOString()

    // Check if --force flag is passed to skip the stale check
    if (process.argv.includes('--force-deploy')) {
      console.log(
        `  WARNING: Chain appears stale but --force-deploy was passed. Proceeding anyway.`,
      )
      console.log(`  Last block: ${blockNumber} at ${blockDate}`)
      return
    }

    throw new Error(
      `Chain appears to be stalled. Last block (${blockNumber}) was produced ${blockAge}s ago at ${blockDate}.\n` +
        `The ${config.name} sequencer may need to be restarted.\n\n` +
        `For localnet, run: jeju dev --start\n` +
        `For testnet, check Kubernetes deployment status.\n\n` +
        `Use --force-deploy to skip this check if you know the chain is operational.`,
    )
  }

  // Wait for a new block to confirm chain is live
  console.log('  Waiting for new block to confirm chain is live...')
  const startBlock = blockNumber

  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, config.blockTime))
    const currentBlock = await client.getBlockNumber()
    if (currentBlock > startBlock) {
      console.log(
        `  Chain is producing blocks (${startBlock} -> ${currentBlock})`,
      )
      return
    }
  }

  throw new Error(
    `Chain is not producing new blocks. Waited ${(10 * config.blockTime) / 1000}s but block number stayed at ${startBlock}.\n` +
      `The sequencer may be stalled.`,
  )
}

async function checkDeployerBalance(
  rpcUrl: string,
  deployer: Address,
): Promise<void> {
  const client = createPublicClient({
    transport: http(rpcUrl),
  })

  const balance = await client.getBalance({ address: deployer })
  console.log(`  Deployer balance: ${formatEther(balance)} ETH`)

  if (balance < BigInt(1e16)) {
    throw new Error(
      `Deployer ${deployer} needs at least 0.01 ETH for gas.\n` +
        `Current balance: ${formatEther(balance)} ETH`,
    )
  }
}

function deployContract(
  rpcUrl: string,
  privateKey: string,
  path: string,
  args: string[],
  name: string,
): string {
  console.log(`  Deploying ${name}...`)

  // Parse contract path
  const [contractPath, contractName] = path.split(':')
  const jsonFileName = contractPath.split('/').pop()
  const jsonPath = `${CONTRACTS_DIR}/out/${jsonFileName}/${contractName}.json`

  // Get bytecode from compiled output
  const artifact = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  let bytecode = artifact.bytecode.object as string

  // Encode constructor args if any
  if (args.length > 0) {
    // Build the constructor types from the ABI
    const ctor = artifact.abi.find(
      (x: { type: string }) => x.type === 'constructor',
    )
    if (ctor) {
      const types = ctor.inputs.map((i: { type: string }) => i.type).join(',')
      const argsStr = args.map((a) => `"${a}"`).join(' ')
      const encoded = exec(`cast abi-encode "constructor(${types})" ${argsStr}`)
      // Remove 0x prefix and append to bytecode
      bytecode = bytecode + encoded.slice(2)
    }
  }

  // Deploy using cast send --create
  const cmd = `cast send --rpc-url ${rpcUrl} --private-key ${privateKey} --create "${bytecode}" --json`
  const output = exec(cmd)

  // Parse JSON output
  const result = JSON.parse(output)
  const contractAddress = result.contractAddress

  if (!contractAddress) {
    throw new Error(
      `Deployment failed for ${name}. Transaction: ${result.transactionHash}`,
    )
  }

  console.log(`    ${name}: ${contractAddress}`)
  return contractAddress
}

function sendTx(
  rpcUrl: string,
  privateKey: string,
  to: string,
  sig: string,
  args: string[],
  label: string,
): void {
  const argsStr = args.map((a) => `"${a}"`).join(' ')
  const cmd = `cast send ${to} "${sig}" ${argsStr} --rpc-url ${rpcUrl} --private-key ${privateKey}`
  exec(cmd)
  console.log(`    ${label}`)
}

async function deployTokens(
  rpcUrl: string,
  privateKey: string,
  deployer: string,
): Promise<{ jeju: string; usdc: string }> {
  console.log('\n=== Deploying Tokens ===\n')

  // Deploy JEJU Token (MockJEJU allows minting for testing)
  const jeju = deployContract(
    rpcUrl,
    privateKey,
    'src/tokens/MockJEJU.sol:MockJEJU',
    [deployer],
    'JEJU Token',
  )

  // Check if USDC already exists from config
  const configPath = join(CONFIG_DIR, 'contracts.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  let usdc = config.testnet?.tokens?.usdc

  if (!usdc || usdc === '') {
    // Deploy mock USDC for testnet
    usdc = deployContract(
      rpcUrl,
      privateKey,
      'src/tokens/NetworkUSDC.sol:NetworkUSDC',
      [deployer, '1000000000000000', 'true'], // 1B USDC, mintable
      'Mock USDC',
    )
  } else {
    console.log(`  Using existing USDC: ${usdc}`)
  }

  return { jeju, usdc }
}

async function deployTokenFactory(
  rpcUrl: string,
  privateKey: string,
): Promise<string> {
  console.log('\n=== Deploying Token Factory ===\n')

  // Check if TokenFactory already exists
  const configPath = join(CONFIG_DIR, 'contracts.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  const existingFactory = config.testnet?.bazaar?.tokenFactory

  if (existingFactory && existingFactory !== '') {
    // Verify contract exists on chain
    try {
      const code = exec(`cast code ${existingFactory} --rpc-url ${rpcUrl}`)
      if (code !== '0x') {
        console.log(`  Using existing TokenFactory: ${existingFactory}`)
        return existingFactory
      }
    } catch {
      // Contract doesn't exist, deploy new one
    }
  }

  // Deploy SimpleERC20Factory
  const tokenFactory = deployContract(
    rpcUrl,
    privateKey,
    'src/tokens/TokenFactory.sol:SimpleERC20Factory',
    [],
    'SimpleERC20Factory (TokenFactory)',
  )

  return tokenFactory
}

async function deployPredictionMarkets(
  rpcUrl: string,
  privateKey: string,
  deployer: string,
  tokens: { jeju: string; usdc: string },
): Promise<{
  predictionOracle: string
  predictionMarket: string
  markets: DeploymentResult['markets']['predictions']
}> {
  console.log('\n=== Deploying Prediction Markets ===\n')

  // Deploy PredictionOracle
  const predictionOracle = deployContract(
    rpcUrl,
    privateKey,
    'src/prediction/PredictionOracle.sol:PredictionOracle',
    [deployer],
    'PredictionOracle',
  )

  // Deploy PredictionMarket
  const predictionMarket = deployContract(
    rpcUrl,
    privateKey,
    'src/prediction/PredictionMarket.sol:PredictionMarket',
    [tokens.usdc, predictionOracle, deployer, deployer],
    'PredictionMarket',
  )

  // Enable JEJU as supported token
  sendTx(
    rpcUrl,
    privateKey,
    predictionMarket,
    'setTokenSupport(address,bool)',
    [tokens.jeju, 'true'],
    'JEJU token enabled for betting',
  )

  // Create prediction markets
  console.log('\n  Creating prediction markets...')

  const markets: DeploymentResult['markets']['predictions'] = []
  const predictionQuestions = [
    {
      question: 'Will Jeju Network go mainnet in 2026?',
      liquidity: '10000000000000000000000', // 10,000 USDC
    },
    {
      question: 'Will JEJU token reach $10 by end of 2026?',
      liquidity: '5000000000000000000000', // 5,000 USDC
    },
    {
      question: 'Will Jeju have 100+ active validators by Q2 2026?',
      liquidity: '3000000000000000000000', // 3,000 USDC
    },
  ]

  for (let i = 0; i < predictionQuestions.length; i++) {
    const market = predictionQuestions[i]
    const sessionIdHex = `0x${(i + 1).toString(16).padStart(64, '0')}`

    // Generate commitment for oracle
    const commitmentCmd = `cast keccak256 $(cast abi-encode "f(bool,bytes32)" true ${sessionIdHex})`
    const commitment = exec(commitmentCmd)

    try {
      // Commit game to oracle
      sendTx(
        rpcUrl,
        privateKey,
        predictionOracle,
        'commitGame(bytes32,string,bytes32)',
        [sessionIdHex, market.question, commitment],
        `Oracle: Committed "${market.question.substring(0, 30)}..."`,
      )

      // Create market
      sendTx(
        rpcUrl,
        privateKey,
        predictionMarket,
        'createMarket(bytes32,string,uint256)',
        [sessionIdHex, market.question, market.liquidity],
        `Market created with ${Number(BigInt(market.liquidity) / BigInt(1e18))} USDC liquidity`,
      )

      markets.push({
        sessionId: sessionIdHex,
        question: market.question,
        liquidity: market.liquidity,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const warning = `Prediction market ${i + 1} failed: ${msg.slice(0, 100)}`
      console.log(`    WARNING: ${warning}`)
      deploymentWarnings.push(warning)
    }
  }

  return { predictionOracle, predictionMarket, markets }
}

async function deployPerps(
  rpcUrl: string,
  privateKey: string,
  deployer: string,
  tokens: { jeju: string; usdc: string },
): Promise<{
  perpetualMarket: string
  marginManager: string
  insuranceFund: string
  priceOracle: string
  markets: DeploymentResult['markets']['perps']
}> {
  console.log('\n=== Deploying Perpetual Trading System ===\n')

  // Deploy PerpsPriceOracle
  const priceOracle = deployContract(
    rpcUrl,
    privateKey,
    'src/perps/PerpsPriceOracle.sol:PerpsPriceOracle',
    [
      '0x0000000000000000000000000000000000000000', // Chainlink ETH/USD
      '0x0000000000000000000000000000000000000000', // Chainlink BTC/USD
      '0x0000000000000000000000000000000000000000', // Pyth
      deployer,
    ],
    'PerpsPriceOracle',
  )

  // Deploy MarginManager
  const marginManager = deployContract(
    rpcUrl,
    privateKey,
    'src/perps/MarginManager.sol:MarginManager',
    [priceOracle, deployer],
    'MarginManager',
  )

  // Deploy InsuranceFund
  const insuranceFund = deployContract(
    rpcUrl,
    privateKey,
    'src/perps/InsuranceFund.sol:InsuranceFund',
    [priceOracle, deployer],
    'InsuranceFund',
  )

  // Deploy PerpetualMarket
  const perpetualMarket = deployContract(
    rpcUrl,
    privateKey,
    'src/perps/PerpetualMarket.sol:PerpetualMarket',
    [marginManager, insuranceFund, priceOracle, deployer],
    'PerpetualMarket',
  )

  // Configure margin manager
  console.log('\n  Configuring margin manager...')
  sendTx(
    rpcUrl,
    privateKey,
    marginManager,
    'addAcceptedToken(address,uint256)',
    [tokens.usdc, '10000'],
    'USDC added as collateral (100% factor)',
  )
  sendTx(
    rpcUrl,
    privateKey,
    marginManager,
    'addAcceptedToken(address,uint256)',
    [tokens.jeju, '8000'],
    'JEJU added as collateral (80% factor)',
  )

  // Set initial prices (manual for testnet)
  console.log('\n  Setting initial prices...')
  sendTx(
    rpcUrl,
    privateKey,
    priceOracle,
    'setManualPrice(address,uint256)',
    [tokens.jeju, '100000000'], // $1.00 (8 decimals)
    'JEJU price set to $1.00',
  )
  sendTx(
    rpcUrl,
    privateKey,
    priceOracle,
    'setManualPrice(address,uint256)',
    [tokens.usdc, '100000000'], // $1.00
    'USDC price set to $1.00',
  )

  // Create JEJU-USD perp market
  console.log('\n  Creating perp markets...')
  const markets: DeploymentResult['markets']['perps'] = []

  const perpMarkets = [
    {
      symbol: 'JEJU-USD',
      baseAsset: tokens.jeju,
      quoteAsset: tokens.usdc,
      maxLeverage: 20,
      maintenanceMarginBps: 50,
      initialMarginBps: 100,
      takerFeeBps: 5,
      makerFeeBps: 2,
      maxOpenInterest: '10000000000000000000000000', // 10M
    },
  ]

  for (const mc of perpMarkets) {
    const tupleArgs = `"(0x0000000000000000000000000000000000000000000000000000000000000000,${mc.symbol},${mc.baseAsset},${mc.quoteAsset},${priceOracle},${mc.maxLeverage},${mc.maintenanceMarginBps},${mc.initialMarginBps},${mc.takerFeeBps},${mc.makerFeeBps},${mc.maxOpenInterest},3600,true)"`

    try {
      const cmd = `cast send ${perpetualMarket} "createMarket((bytes32,string,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool))" ${tupleArgs} --rpc-url ${rpcUrl} --private-key ${privateKey}`
      exec(cmd)
      console.log(`    Market ${mc.symbol} created`)

      markets.push({
        marketId: `market-${markets.length}`,
        symbol: mc.symbol,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const warning = `Perp market ${mc.symbol} failed: ${msg.slice(0, 100)}`
      console.log(`    WARNING: ${warning}`)
      deploymentWarnings.push(warning)
    }
  }

  return { perpetualMarket, marginManager, insuranceFund, priceOracle, markets }
}

async function deployNFT(
  rpcUrl: string,
  privateKey: string,
  deployer: string,
): Promise<string> {
  console.log('\n=== Deploying NFT Collection ===\n')

  // Deploy SimpleCollectible
  // Constructor: (name, symbol, owner, mintFee, feeRecipient, maxSupply, maxPerAddress)
  const simpleCollectible = deployContract(
    rpcUrl,
    privateKey,
    'src/bazaar/SimpleCollectible.sol:SimpleCollectible',
    [
      'Jeju Genesis', // name
      'JEJUNFT', // symbol
      deployer, // owner
      '0', // mintFee (free mints for testnet)
      deployer, // feeRecipient
      '10000', // maxSupply
      '10', // maxPerAddress
    ],
    'Jeju Genesis NFT',
  )

  // Mint some genesis NFTs for testing
  // These use placeholder metadata - in production, upload real metadata to IPFS first
  console.log('\n  Minting genesis NFTs...')
  const nftMetadata = [
    'data:application/json,{"name":"Jeju Genesis #1","description":"Jeju Network Genesis NFT","image":""}',
    'data:application/json,{"name":"Jeju Genesis #2","description":"Jeju Network Genesis NFT","image":""}',
    'data:application/json,{"name":"Jeju Genesis #3","description":"Jeju Network Genesis NFT","image":""}',
  ]

  for (const uri of nftMetadata) {
    try {
      sendTx(
        rpcUrl,
        privateKey,
        simpleCollectible,
        'mint(string)',
        [uri],
        `Minted NFT: ${uri.slice(0, 30)}...`,
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const warning = `NFT mint failed: ${msg.slice(0, 100)}`
      console.log(`    WARNING: ${warning}`)
      deploymentWarnings.push(warning)
    }
  }

  return simpleCollectible
}

async function deployNFTMarketplace(
  rpcUrl: string,
  privateKey: string,
  deployer: string,
  tokens: { jeju: string; usdc: string },
): Promise<string> {
  console.log('\n=== Deploying NFT Marketplace ===\n')

  // Deploy Marketplace contract
  // Constructor: (initialOwner, _gameGold, _usdc, _feeRecipient)
  const nftMarketplace = deployContract(
    rpcUrl,
    privateKey,
    'src/marketplace/Marketplace.sol:Marketplace',
    [
      deployer, // initialOwner
      tokens.jeju, // gameGold (using JEJU as the game token)
      tokens.usdc, // usdc
      deployer, // feeRecipient
    ],
    'NFT Marketplace',
  )

  console.log(`  NFT Marketplace deployed at: ${nftMarketplace}`)

  return nftMarketplace
}

interface TFMMPoolConfig {
  name: string
  symbol: string
  tokens: string[]
  initialWeights: string[]
  swapFeeBps: number
  initialLiquidity: string[]
}

async function deployTFMMPools(
  rpcUrl: string,
  privateKey: string,
  deployer: string,
  tokens: { jeju: string; usdc: string },
): Promise<DeploymentResult['contracts']['tfmmPools']> {
  console.log('\n=== Deploying TFMM Liquidity Pools ===\n')

  const pools: DeploymentResult['contracts']['tfmmPools'] = []

  // Pool configurations
  const poolConfigs: TFMMPoolConfig[] = [
    {
      name: 'JEJU-USDC Pool',
      symbol: 'TFMM-JEJU-USDC',
      tokens: [tokens.jeju, tokens.usdc],
      initialWeights: ['500000000000000000', '500000000000000000'], // 50/50
      swapFeeBps: 30, // 0.3%
      initialLiquidity: ['100000000000000000000000', '10000000000'], // 100k JEJU, 10k USDC (6 decimals)
    },
  ]

  for (const poolConfig of poolConfigs) {
    console.log(`  Deploying ${poolConfig.name}...`)

    // Deploy TFMMPool contract
    // Constructor: (name, symbol, tokens, initialWeights, swapFeeBps, owner)
    const tokensArray = `[${poolConfig.tokens.map((t) => `"${t}"`).join(',')}]`
    const weightsArray = `[${poolConfig.initialWeights.join(',')}]`

    let poolAddress: string
    try {
      // Build constructor args
      const constructorTypes =
        'string,string,address[],uint256[],uint256,address'
      const constructorValues = `"${poolConfig.name}" "${poolConfig.symbol}" ${tokensArray} ${weightsArray} ${poolConfig.swapFeeBps} ${deployer}`

      // Get bytecode
      const artifactPath = join(CONTRACTS_DIR, 'out/TFMMPool.sol/TFMMPool.json')
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'))
      let bytecode = artifact.bytecode.object as string

      // Encode constructor args
      const encoded = exec(
        `cast abi-encode "constructor(${constructorTypes})" ${constructorValues}`,
      )
      bytecode = bytecode + encoded.slice(2)

      // Deploy
      const cmd = `cast send --rpc-url ${rpcUrl} --private-key ${privateKey} --create "${bytecode}" --json`
      const output = exec(cmd)
      const result = JSON.parse(output)
      poolAddress = result.contractAddress

      if (!poolAddress) {
        throw new Error(`Deployment failed: ${result.transactionHash}`)
      }

      console.log(`    ${poolConfig.name}: ${poolAddress}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const warning = `TFMM pool ${poolConfig.name} deployment failed: ${msg.slice(0, 100)}`
      console.log(`    WARNING: ${warning}`)
      deploymentWarnings.push(warning)
      continue
    }

    // Approve tokens and add initial liquidity
    console.log('    Approving tokens...')
    for (let i = 0; i < poolConfig.tokens.length; i++) {
      sendTx(
        rpcUrl,
        privateKey,
        poolConfig.tokens[i],
        'approve(address,uint256)',
        [poolAddress, poolConfig.initialLiquidity[i]],
        `    Approved ${i === 0 ? 'JEJU' : 'USDC'}`,
      )
    }

    // Add initial liquidity
    console.log('    Adding initial liquidity...')
    const amountsArray = `"[${poolConfig.initialLiquidity.join(',')}]"`
    const addLiquidityCmd = `cast send ${poolAddress} "addLiquidity(uint256[],uint256)" ${amountsArray} 0 --rpc-url ${rpcUrl} --private-key ${privateKey}`

    try {
      exec(addLiquidityCmd)
      console.log('    Liquidity added.')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const warning = `TFMM ${poolConfig.name} liquidity failed: ${msg.slice(0, 80)}`
      console.log(`    WARNING: ${warning}`)
      deploymentWarnings.push(warning)
    }

    pools.push({
      address: poolAddress,
      name: poolConfig.name,
      symbol: poolConfig.symbol,
      tokens: poolConfig.tokens,
    })
  }

  return pools
}

function saveDeployment(result: DeploymentResult, networkName: string): void {
  // Save full deployment to deployments folder
  const deployPath = join(
    CONTRACTS_DIR,
    `deployments/bazaar-${networkName}.json`,
  )
  writeFileSync(deployPath, JSON.stringify(result, null, 2))
  console.log(`\nSaved: ${deployPath}`)

  // Also save marketplace-specific deployment file for contracts package
  const marketplaceDeployment = {
    marketplace: result.contracts.nftMarketplace,
    at: result.contracts.nftMarketplace,
    goldToken: result.contracts.jeju,
    usdcToken: result.contracts.usdc,
    Owner: result.deployer,
    Recipient: result.deployer,
    chainId: result.chainId,
    network: result.network,
    deployedAt: result.deployedAt,
  }
  const marketplacePath = join(
    CONTRACTS_DIR,
    `deployments/bazaar-marketplace-${result.chainId}.json`,
  )
  writeFileSync(marketplacePath, JSON.stringify(marketplaceDeployment, null, 2))
  console.log(`Saved: ${marketplacePath}`)

  // Update contracts.json
  const configPath = join(CONFIG_DIR, 'contracts.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))

  // Update network config
  const netKey = networkName as 'localnet' | 'testnet'
  if (!config[netKey]) config[netKey] = {}
  if (!config[netKey].tokens) config[netKey].tokens = {}
  if (!config[netKey].bazaar) config[netKey].bazaar = {}
  if (!config[netKey].perps) config[netKey].perps = {}

  config[netKey].tokens.jeju = result.contracts.jeju
  if (!config[netKey].tokens.usdc || config[netKey].tokens.usdc === '') {
    config[netKey].tokens.usdc = result.contracts.usdc
  }

  config[netKey].bazaar.tokenFactory = result.contracts.tokenFactory
  config[netKey].bazaar.predictionMarket = result.contracts.predictionMarket
  config[netKey].bazaar.predictionOracle = result.contracts.predictionOracle
  config[netKey].bazaar.simpleCollectible = result.contracts.simpleCollectible
  config[netKey].bazaar.marketplace = result.contracts.nftMarketplace

  // Also update commerce.nftMarketplace for compatibility
  if (!config[netKey].commerce) config[netKey].commerce = {}
  config[netKey].commerce.nftMarketplace = result.contracts.nftMarketplace

  config[netKey].perps = {
    market: result.contracts.perpetualMarket,
    marginManager: result.contracts.marginManager,
    insuranceFund: result.contracts.insuranceFund,
    priceOracle: result.contracts.priceOracle,
  }

  // Save TFMM pools as flat addresses in amm category
  if (!config[netKey].amm) config[netKey].amm = {}
  for (const pool of result.contracts.tfmmPools) {
    const key = `TFMMPool_${pool.symbol.replace('TFMM-', '').replace('-', '_')}`
    config[netKey].amm[key] = pool.address
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2))
  console.log(`Updated: ${configPath}`)

  // Also save TFMM-specific deployment file
  if (result.contracts.tfmmPools.length > 0) {
    const tfmmDeployPath = join(
      CONTRACTS_DIR,
      `deployments/tfmm-${networkName}.json`,
    )
    writeFileSync(
      tfmmDeployPath,
      JSON.stringify(
        {
          pools: result.contracts.tfmmPools,
          deployedAt: result.deployedAt,
        },
        null,
        2,
      ),
    )
    console.log(`Saved: ${tfmmDeployPath}`)
  }
}

function printSummary(result: DeploymentResult): void {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`BAZAAR ${result.network.toUpperCase()} DEPLOYMENT COMPLETE`)
  console.log('='.repeat(60))

  console.log('\nTokens:')
  console.log(`  JEJU:  ${result.contracts.jeju}`)
  console.log(`  USDC:  ${result.contracts.usdc}`)

  console.log('\nToken Factory:')
  console.log(`  TokenFactory:  ${result.contracts.tokenFactory}`)

  console.log('\nPrediction Markets:')
  console.log(`  Oracle:  ${result.contracts.predictionOracle}`)
  console.log(`  Market:  ${result.contracts.predictionMarket}`)
  console.log(`  Markets Created: ${result.markets.predictions.length}`)
  for (const m of result.markets.predictions) {
    console.log(`    - ${m.question.slice(0, 40)}...`)
  }

  console.log('\nPerpetual Trading:')
  console.log(`  Market:          ${result.contracts.perpetualMarket}`)
  console.log(`  Margin Manager:  ${result.contracts.marginManager}`)
  console.log(`  Insurance Fund:  ${result.contracts.insuranceFund}`)
  console.log(`  Price Oracle:    ${result.contracts.priceOracle}`)
  console.log(`  Markets Created: ${result.markets.perps.length}`)
  for (const m of result.markets.perps) {
    console.log(`    - ${m.symbol}`)
  }

  console.log('\nNFT:')
  console.log(`  Simple Collectible: ${result.contracts.simpleCollectible}`)
  console.log(`  NFT Marketplace:    ${result.contracts.nftMarketplace}`)

  console.log('\nTFMM Liquidity Pools:')
  if (result.contracts.tfmmPools.length === 0) {
    console.log('  No pools deployed')
  } else {
    for (const pool of result.contracts.tfmmPools) {
      console.log(`  ${pool.name}: ${pool.address}`)
    }
  }

  // Show warnings if any
  if (result.warnings.length > 0) {
    console.log('\nWarnings:')
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`)
    }
  }

  if (result.network === 'testnet') {
    console.log('\nNext Steps:')
    console.log('  1. Visit: https://bazaar.testnet.jejunetwork.org')
    console.log('  2. Connect wallet with testnet ETH')
    console.log('  3. Get testnet JEJU from faucet')
  } else {
    console.log('\nNext Steps:')
    console.log('  1. Start the dev server: bun run dev')
    console.log('  2. Visit: http://localhost:5173')
  }

  // Exit with error if there were warnings
  if (result.warnings.length > 0) {
    console.log(
      `\nDeployment completed with ${result.warnings.length} warning(s).\n`,
    )
  } else {
    console.log('\nDeployment completed successfully.\n')
  }
}

async function main(): Promise<void> {
  const { network, forceDeploy } = parseArgs()
  const config = NETWORKS[network]

  console.log(
    `Bazaar ${network.charAt(0).toUpperCase() + network.slice(1)} Deployment`,
  )
  console.log('='.repeat(50))
  console.log(`Network: ${config.name}`)
  console.log(`RPC URL: ${config.rpcUrl}`)
  console.log(`Chain ID: ${config.chainId}`)

  // Check chain health first (skip if --force-deploy is set)
  if (forceDeploy) {
    console.log('\n--force-deploy: Skipping chain health check')
  } else {
    await checkChainHealth(config.rpcUrl, config)
  }

  // Get deployer
  const privateKey = getDeployerKeyForNetwork(network)
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const deployer = account.address

  console.log(`\nDeployer: ${deployer}`)

  // Check balance
  await checkDeployerBalance(config.rpcUrl, deployer)

  // Ensure contracts are built
  const artifactPath = join(
    CONTRACTS_DIR,
    'out/PredictionMarket.sol/PredictionMarket.json',
  )
  if (!existsSync(artifactPath)) {
    console.log('\nBuilding contracts...')
    exec('forge build', { cwd: CONTRACTS_DIR })
  }
  console.log('Contracts built')

  // Deploy all contracts
  const tokens = await deployTokens(config.rpcUrl, privateKey, deployer)
  const tokenFactory = await deployTokenFactory(config.rpcUrl, privateKey)
  const predictions = await deployPredictionMarkets(
    config.rpcUrl,
    privateKey,
    deployer,
    tokens,
  )
  const perps = await deployPerps(config.rpcUrl, privateKey, deployer, tokens)
  const simpleCollectible = await deployNFT(config.rpcUrl, privateKey, deployer)
  const nftMarketplace = await deployNFTMarketplace(
    config.rpcUrl,
    privateKey,
    deployer,
    tokens,
  )
  const tfmmPools = await deployTFMMPools(
    config.rpcUrl,
    privateKey,
    deployer,
    tokens,
  )

  const result: DeploymentResult = {
    chainId: config.chainId,
    network: config.name,
    deployedAt: new Date().toISOString(),
    deployer,
    contracts: {
      jeju: tokens.jeju,
      usdc: tokens.usdc,
      tokenFactory,
      predictionOracle: predictions.predictionOracle,
      predictionMarket: predictions.predictionMarket,
      perpetualMarket: perps.perpetualMarket,
      marginManager: perps.marginManager,
      insuranceFund: perps.insuranceFund,
      priceOracle: perps.priceOracle,
      simpleCollectible,
      nftMarketplace,
      tfmmPools,
    },
    markets: {
      predictions: predictions.markets,
      perps: perps.markets,
    },
    warnings: deploymentWarnings,
  }

  saveDeployment(result, network)
  printSummary(result)
}

main().catch((error) => {
  console.error('\nDeployment failed:', error.message || error)
  process.exit(1)
})
