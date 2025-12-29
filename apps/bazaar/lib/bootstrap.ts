import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isLocalnet } from '@jejunetwork/config/ports'

const ANVIL_DEFAULT_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

interface BootstrapConfig {
  rpcUrl: string
  privateKey: string
  contractsDir: string
}

interface PredictionMarketResult {
  predictionOracle: string
  predictionMarket: string
  markets: Array<{
    sessionId: string
    question: string
    liquidity: string
  }>
}

interface PerpsResult {
  priceOracle: string
  marginManager: string
  insuranceFund: string
  perpetualMarket: string
  markets: Array<{
    marketId: string
    symbol: string
    baseAsset: string
  }>
}

function getDeployerKey(rpcUrl: string): string {
  const envKey = process.env.PRIVATE_KEY
  if (envKey) return envKey

  if (!isLocalnet(rpcUrl)) {
    throw new Error(
      'PRIVATE_KEY environment variable required for non-local deployments.',
    )
  }

  return ANVIL_DEFAULT_KEY
}

function exec(cmd: string, options?: { cwd?: string }): string {
  return execSync(cmd, {
    encoding: 'utf-8',
    cwd: options?.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
  }).trim()
}

function getDeployerAddress(privateKey: string): string {
  return exec(`cast wallet address ${privateKey}`)
}

function deployContract(
  config: BootstrapConfig,
  path: string,
  args: string[],
  name: string,
): string {
  console.log(`  Deploying ${name}...`)

  const argsStr = args.map((a) => `"${a}"`).join(' ')
  const cmd = `cd ${config.contractsDir} && forge create ${path} \
    --rpc-url ${config.rpcUrl} \
    --private-key ${config.privateKey} \
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
  config: BootstrapConfig,
  to: string,
  sig: string,
  args: string[],
  label: string,
): void {
  const argsStr = args.map((a) => `"${a}"`).join(' ')
  const cmd = `cast send ${to} "${sig}" ${argsStr} --rpc-url ${config.rpcUrl} --private-key ${config.privateKey}`
  exec(cmd)
  console.log(`    ${label}`)
}

function loadExistingContracts(
  contractsDir: string,
): { usdc: string; jeju: string; weth?: string } | null {
  const localnetPath = join(contractsDir, 'deployments/localnet-complete.json')

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
    weth: data.contracts.weth,
  }
}

/**
 * Bootstrap prediction market contracts
 */
export async function bootstrapPredictionMarkets(
  rpcUrl: string,
  contractsDir: string,
): Promise<PredictionMarketResult | null> {
  console.log('\n=== Deploying Prediction Market System ===\n')

  const privateKey = getDeployerKey(rpcUrl)
  const config: BootstrapConfig = { rpcUrl, privateKey, contractsDir }
  const deployer = getDeployerAddress(privateKey)

  console.log(`Deployer: ${deployer}`)

  const tokens = loadExistingContracts(contractsDir)
  if (!tokens) {
    console.error('No token contracts found. Run: jeju dev --bootstrap first')
    return null
  }

  console.log(`Using USDC: ${tokens.usdc}`)
  console.log(`Using JEJU: ${tokens.jeju}`)

  // Deploy PredictionOracle
  console.log('\n1. Deploying PredictionOracle...')
  const predictionOracle = deployContract(
    config,
    'src/prediction/PredictionOracle.sol:PredictionOracle',
    [deployer],
    'PredictionOracle',
  )

  // Deploy PredictionMarket
  console.log('\n2. Deploying PredictionMarket...')
  const predictionMarket = deployContract(
    config,
    'src/prediction/PredictionMarket.sol:PredictionMarket',
    [tokens.usdc, predictionOracle, deployer, deployer],
    'PredictionMarket',
  )

  // Enable JEJU as supported token
  console.log('\n3. Configuring supported tokens...')
  sendTx(
    config,
    predictionMarket,
    'setTokenSupport(address,bool)',
    [tokens.jeju, 'true'],
    'JEJU token enabled for betting',
  )

  // Create sample markets
  console.log('\n4. Creating sample prediction markets...')
  const markets = await createSamplePredictionMarkets(
    config,
    predictionMarket,
    predictionOracle,
  )

  return { predictionOracle, predictionMarket, markets }
}

async function createSamplePredictionMarkets(
  config: BootstrapConfig,
  predictionMarket: string,
  predictionOracle: string,
): Promise<PredictionMarketResult['markets']> {
  const markets: PredictionMarketResult['markets'] = []

  const sampleMarkets = [
    {
      question: 'Will Bitcoin hit $150,000 by end of 2025?',
      liquidity: '1000000000000000000000',
    },
    {
      question: 'Will Ethereum 3.0 launch in Q1 2026?',
      liquidity: '1000000000000000000000',
    },
    {
      question: 'Will a major AI lab release AGI by 2027?',
      liquidity: '500000000000000000000',
    },
    {
      question: 'Will the US Federal Reserve cut rates in January 2026?',
      liquidity: '1000000000000000000000',
    },
    {
      question: 'Will Jeju Network reach 10,000 daily active users?',
      liquidity: '2000000000000000000000',
    },
  ]

  for (let i = 0; i < sampleMarkets.length; i++) {
    const market = sampleMarkets[i]
    const sessionIdHex = `0x${(i + 1).toString(16).padStart(64, '0')}`

    const commitmentCmd = `cast keccak256 $(cast abi-encode "f(bool,bytes32)" true ${sessionIdHex})`
    const commitment = exec(commitmentCmd)

    try {
      sendTx(
        config,
        predictionOracle,
        'commitGame(bytes32,string,bytes32)',
        [sessionIdHex, market.question, commitment],
        `Oracle: Committed game ${i + 1}`,
      )

      sendTx(
        config,
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
      console.log(`    Skipped market ${i + 1}: ${msg.slice(0, 50)}`)
    }
  }

  return markets
}

/**
 * Bootstrap perpetual trading contracts
 */
export async function bootstrapPerps(
  rpcUrl: string,
  contractsDir: string,
): Promise<PerpsResult | null> {
  console.log('\n=== Deploying Perpetual Trading System ===\n')

  const privateKey = getDeployerKey(rpcUrl)
  const config: BootstrapConfig = { rpcUrl, privateKey, contractsDir }
  const deployer = getDeployerAddress(privateKey)

  console.log(`Deployer: ${deployer}`)

  const tokens = loadExistingContracts(contractsDir)
  if (!tokens) {
    console.error('No token contracts found. Run: jeju dev --bootstrap first')
    return null
  }

  console.log(`Using USDC: ${tokens.usdc}`)
  console.log(`Using JEJU: ${tokens.jeju}`)

  // Deploy PerpsPriceOracle
  console.log('\n1. Deploying PerpsPriceOracle...')
  const priceOracle = deployContract(
    config,
    'src/perps/PerpsPriceOracle.sol:PerpsPriceOracle',
    [
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      deployer,
    ],
    'PerpsPriceOracle',
  )

  // Deploy MarginManager
  console.log('\n2. Deploying MarginManager...')
  const marginManager = deployContract(
    config,
    'src/perps/MarginManager.sol:MarginManager',
    [priceOracle, deployer],
    'MarginManager',
  )

  // Deploy InsuranceFund
  console.log('\n3. Deploying InsuranceFund...')
  const insuranceFund = deployContract(
    config,
    'src/perps/InsuranceFund.sol:InsuranceFund',
    [priceOracle, deployer],
    'InsuranceFund',
  )

  // Deploy PerpetualMarket
  console.log('\n4. Deploying PerpetualMarket...')
  const perpetualMarket = deployContract(
    config,
    'src/perps/PerpetualMarket.sol:PerpetualMarket',
    [marginManager, insuranceFund, priceOracle, deployer],
    'PerpetualMarket',
  )

  // Configure contracts
  console.log('\n5. Configuring contracts...')
  sendTx(
    config,
    marginManager,
    'addAcceptedToken(address,uint256)',
    [tokens.usdc, '10000'],
    'USDC added as collateral (100% factor)',
  )

  sendTx(
    config,
    marginManager,
    'addAcceptedToken(address,uint256)',
    [tokens.jeju, '8000'],
    'JEJU added as collateral (80% factor)',
  )

  // Set up price feeds
  console.log('\n6. Setting up price feeds...')
  sendTx(
    config,
    priceOracle,
    'setManualPrice(address,uint256)',
    [tokens.jeju, '10000000000'],
    'JEJU price set to $100',
  )

  sendTx(
    config,
    priceOracle,
    'setManualPrice(address,uint256)',
    [tokens.usdc, '100000000'],
    'USDC price set to $1',
  )

  sendTx(
    config,
    priceOracle,
    'setAssetFeed(address,bytes32,address,address,uint256,uint8)',
    [
      tokens.jeju,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '86400',
      '8',
    ],
    'JEJU asset feed configured',
  )

  sendTx(
    config,
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

  // Create markets
  console.log('\n7. Creating perpetual markets...')
  const markets = await createPerpMarkets(
    config,
    perpetualMarket,
    priceOracle,
    {
      usdc: tokens.usdc,
      jeju: tokens.jeju,
      weth: tokens.weth || tokens.jeju,
    },
  )

  return { priceOracle, marginManager, insuranceFund, perpetualMarket, markets }
}

async function createPerpMarkets(
  config: BootstrapConfig,
  perpetualMarket: string,
  priceOracle: string,
  tokens: { usdc: string; jeju: string; weth: string },
): Promise<PerpsResult['markets']> {
  const markets: PerpsResult['markets'] = []

  const marketConfigs = [
    {
      symbol: 'JEJU-USD',
      baseAsset: tokens.jeju,
      quoteAsset: tokens.usdc,
      maxLeverage: 20,
      maintenanceMarginBps: 50,
      initialMarginBps: 100,
      takerFeeBps: 5,
      makerFeeBps: 2,
      maxOpenInterest: '10000000000000000000000000',
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

  for (const mc of marketConfigs) {
    const tupleArgs = `"(0x0000000000000000000000000000000000000000000000000000000000000000,${mc.symbol},${mc.baseAsset},${mc.quoteAsset},${priceOracle},${mc.maxLeverage},${mc.maintenanceMarginBps},${mc.initialMarginBps},${mc.takerFeeBps},${mc.makerFeeBps},${mc.maxOpenInterest},3600,true)"`

    const cmd = `cast send ${perpetualMarket} "createMarket((bytes32,string,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool))" ${tupleArgs} --rpc-url ${config.rpcUrl} --private-key ${config.privateKey}`

    try {
      const output = exec(cmd)
      const logMatch = output.match(
        /topics:\s*\[\s*0x[a-fA-F0-9]+,\s*(0x[a-fA-F0-9]+)/,
      )
      const marketId = logMatch ? logMatch[1] : `market-${markets.length}`

      console.log(`    Market ${mc.symbol}: created`)

      sendTx(
        config,
        priceOracle,
        'setMarketFeed(bytes32,address,address,int256,bool)',
        [marketId, mc.baseAsset, mc.quoteAsset, '0', 'false'],
        `    Price feed for ${mc.symbol} configured`,
      )

      markets.push({
        marketId,
        symbol: mc.symbol,
        baseAsset: mc.baseAsset,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.log(`    Skipped ${mc.symbol}: ${msg.slice(0, 100)}`)
    }
  }

  return markets
}

/**
 * Save prediction market deployment results
 */
export function savePredictionMarketDeployment(
  contractsDir: string,
  result: PredictionMarketResult,
): void {
  const deployPath = join(contractsDir, 'deployments/bazaar-localnet.json')
  writeFileSync(
    deployPath,
    JSON.stringify(
      { ...result, deployedAt: new Date().toISOString() },
      null,
      2,
    ),
  )
  console.log(`Saved: ${deployPath}`)

  // Update main localnet deployment
  const localnetPath = join(contractsDir, 'deployments/localnet-complete.json')
  if (existsSync(localnetPath)) {
    const data = JSON.parse(readFileSync(localnetPath, 'utf-8'))
    if (!data.contracts) data.contracts = {}
    data.contracts.predictionOracle = result.predictionOracle
    data.contracts.predictionMarket = result.predictionMarket
    writeFileSync(localnetPath, JSON.stringify(data, null, 2))
    console.log(`Updated: ${localnetPath}`)
  }
}

/**
 * Save perps deployment results
 */
export function savePerpsDeployment(
  contractsDir: string,
  result: PerpsResult,
): void {
  const deployPath = join(contractsDir, 'deployments/perps-localnet.json')
  writeFileSync(
    deployPath,
    JSON.stringify(
      { ...result, deployedAt: new Date().toISOString() },
      null,
      2,
    ),
  )
  console.log(`Saved: ${deployPath}`)

  // Update main localnet deployment
  const localnetPath = join(contractsDir, 'deployments/localnet-complete.json')
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
}
