#!/usr/bin/env bun
/**
 * Update Testnet Contract Addresses
 *
 * Parses Foundry deployment output and updates packages/config/contracts.json
 *
 * Usage:
 *   bun run scripts/deploy/update-testnet-contracts.ts --file broadcast/DeployDWS.s.sol/420690/run-latest.json
 *   bun run scripts/deploy/update-testnet-contracts.ts --parse-output "output.txt"
 *   bun run scripts/deploy/update-testnet-contracts.ts --manual IdentityRegistry=0x...
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { Address } from 'viem'

const ROOT = join(import.meta.dir, '../../../..')
const CONFIG_DIR = join(ROOT, 'packages/config')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')

interface ContractConfig {
  version: string
  lastUpdated: string
  description: string
  constants: Record<string, string>
  localnet: Record<string, Record<string, string>>
  testnet: Record<string, Record<string, string>>
  mainnet: Record<string, Record<string, string>>
  external: Record<string, Record<string, unknown>>
}

interface FoundryBroadcast {
  transactions: Array<{
    transactionType: string
    contractName: string
    contractAddress: string
    function?: string
    arguments?: string[]
  }>
  receipts?: Array<{
    contractAddress: string
    status: string
  }>
}

// Contract name to category mapping
const CONTRACT_CATEGORIES: Record<string, string> = {
  // Tokens
  JejuToken: 'tokens.jeju',
  MockUSDC: 'tokens.usdc',

  // Registry
  IdentityRegistry: 'registry.identity',
  AppRegistry: 'registry.app',
  NodeRegistry: 'registry.node',
  TokenRegistry: 'payments.tokenRegistry',
  ReputationRegistry: 'registry.reputation',
  ValidationRegistry: 'registry.validation',
  GithubReputationProvider: 'registry.githubReputationProvider',

  // RPC
  RPCStaking: 'rpc.staking',

  // Moderation
  BanManager: 'moderation.banManager',
  ModerationMarketplace: 'moderation.moderationMarketplace',
  ReportingSystem: 'moderation.reportingSystem',
  ReputationLabelManager: 'moderation.reputationLabelManager',

  // Bazaar
  BazaarMarketplace: 'bazaar.marketplace',
  PredictionMarket: 'bazaar.predictionMarket',
  SimpleCollectible: 'bazaar.simpleCollectible',
  TokenFactory: 'bazaar.tokenFactory',

  // Security
  BountyRegistry: 'security.bountyRegistry',

  // Node Staking
  NodeStakingManager: 'nodeStaking.manager',
  NodePerformanceOracle: 'nodeStaking.performanceOracle',
  AutoSlasher: 'nodeStaking.autoSlasher',

  // JNS
  JNSRegistry: 'jns.registry',
  JNSResolver: 'jns.resolver',
  JNSRegistrar: 'jns.registrar',
  JNSReverseRegistrar: 'jns.reverseRegistrar',

  // OAuth3
  TEEVerifier: 'oauth3.teeVerifier',

  // DWS
  StorageManager: 'dws.storageManager',
  WorkerRegistry: 'dws.workerRegistry',
  RepoRegistry: 'dws.gitRegistry',
  PackageRegistry: 'dws.packageRegistry',
  ManagedDatabaseRegistry: 'dws.managedDatabaseRegistry',
  CacheManager: 'dws.cacheManager',
  ContainerRegistry: 'dws.containerRegistry',
  CronOrchestrator: 'dws.cronOrchestrator',

  // Payments
  PaymasterFactory: 'payments.paymasterFactory',
  PriceOracle: 'payments.priceOracle',
  CreditManager: 'payments.creditManager',
  ServiceRegistry: 'payments.serviceRegistry',
  MultiTokenPaymaster: 'payments.multiTokenPaymaster',
  X402Facilitator: 'payments.x402Facilitator',
  X402IntentBridge: 'payments.x402IntentBridge',

  // Commerce
  AuthCaptureEscrow: 'commerce.authCaptureEscrow',
  CommerceOperator: 'commerce.commerceOperator',

  // DeFi
  PoolManager: 'defi.poolManager',
  PositionManager: 'defi.positionManager',
  SwapRouter: 'defi.swapRouter',
  QuoterV4: 'defi.quoterV4',
  StateView: 'defi.stateView',

  // Compute
  ComputeRegistry: 'compute.registry',
  LedgerManager: 'compute.ledgerManager',
  InferenceServing: 'compute.inferenceServing',
  ComputeStaking: 'compute.staking',
  CronTriggerRegistry: 'compute.cronTriggerRegistry',

  // Governance
  Governor: 'governance.governor',
  TimelockController: 'governance.timelock',
  FutarchyGovernor: 'governance.futarchyGovernor',
  RegistryGovernance: 'governance.registryGovernance',
  Autocrat: 'governance.autocrat',

  // OIF
  SolverRegistry: 'oif.solverRegistry',
  InputSettler: 'oif.inputSettler',
  OutputSettler: 'oif.outputSettler',
  OracleAdapter: 'oif.oracleAdapter',

  // EIL
  L1StakeManager: 'eil.l1StakeManager',
  CrossChainPaymaster: 'eil.crossChainPaymaster',
  LiquidityPaymaster: 'eil.liquidityPaymaster',

  // Liquidity
  RiskSleeve: 'liquidity.riskSleeve',
  LiquidityRouter: 'liquidity.liquidityRouter',
  MultiServiceStakeManager: 'liquidity.multiServiceStakeManager',
  LiquidityVault: 'liquidity.liquidityVault',
  FederatedLiquidity: 'liquidity.federatedLiquidity',

  // Fees
  FeeConfig: 'fees.feeConfig',
  FeeDistributor: 'fees.feeDistributor',
  FeeGovernance: 'fees.feeGovernance',

  // Oracle
  FeedRegistry: 'oracle.feedRegistry',
  ReportVerifier: 'oracle.reportVerifier',
  AttestationVerifier: 'oracle.attestationVerifier',
  RewardManager: 'oracle.rewardManager',
  OracleNetworkConnector: 'oracle.oracleNetworkConnector',

  // Chainlink
  VRFCoordinatorV2_5: 'chainlink.vrfCoordinator',
  AutomationRegistry: 'chainlink.automationRegistry',
  LinkToken: 'chainlink.linkToken',

  // CDN
  CDNRegistry: 'cdn.registry',
  CDNBilling: 'cdn.billing',

  // Training
  TrainingCoordinator: 'training.coordinator',
  TrainingRewards: 'training.rewards',
  ModelRegistry: 'training.modelRegistry',
  TEERegistry: 'training.teeRegistry',
  AICeo: 'training.aiCeo',

  // Agents
  Agent0Registry: 'agents.agent0Registry',
}

function log(
  message: string,
  level: 'info' | 'success' | 'error' | 'warn' = 'info',
): void {
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' }
  console.log(`${icons[level]}  ${message}`)
}

function loadContractsConfig(): ContractConfig {
  const configPath = join(CONFIG_DIR, 'contracts.json')
  if (!existsSync(configPath)) {
    throw new Error(`Contracts config not found: ${configPath}`)
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'))
}

function saveContractsConfig(config: ContractConfig): void {
  const configPath = join(CONFIG_DIR, 'contracts.json')
  config.lastUpdated = new Date().toISOString().split('T')[0]
  writeFileSync(configPath, JSON.stringify(config, null, 2))
  log(`Config saved to ${configPath}`, 'success')
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: string,
): void {
  const parts = path.split('.')
  let current = obj as Record<string, unknown>

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]] = value
}

function parseFoundryBroadcast(filePath: string): Map<string, Address> {
  if (!existsSync(filePath)) {
    throw new Error(`Broadcast file not found: ${filePath}`)
  }

  const broadcast: FoundryBroadcast = JSON.parse(
    readFileSync(filePath, 'utf-8'),
  )
  const contracts = new Map<string, Address>()

  for (const tx of broadcast.transactions) {
    if (
      tx.transactionType === 'CREATE' &&
      tx.contractName &&
      tx.contractAddress
    ) {
      contracts.set(tx.contractName, tx.contractAddress as Address)
      log(`Found: ${tx.contractName} at ${tx.contractAddress}`, 'info')
    }
  }

  return contracts
}

function parseConsoleOutput(output: string): Map<string, Address> {
  const contracts = new Map<string, Address>()
  const addressPattern = /([A-Za-z0-9_]+):\s*(0x[a-fA-F0-9]{40})/g

  let match = addressPattern.exec(output)
  while (match !== null) {
    const [, name, address] = match
    contracts.set(name, address as Address)
    log(`Found: ${name} at ${address}`, 'info')
    match = addressPattern.exec(output)
  }

  return contracts
}

function parseManualInput(inputs: string[]): Map<string, Address> {
  const contracts = new Map<string, Address>()

  for (const input of inputs) {
    const [name, address] = input.split('=')
    if (name && address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
      contracts.set(name.trim(), address as Address)
      log(`Parsed: ${name} = ${address}`, 'info')
    } else {
      log(`Invalid input: ${input}`, 'warn')
    }
  }

  return contracts
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      'parse-output': { type: 'string', short: 'p' },
      manual: { type: 'boolean', short: 'm' },
      network: { type: 'string', short: 'n', default: 'testnet' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })

  if (values.help) {
    console.log(`
Update Testnet Contract Addresses

Usage:
  bun run scripts/deploy/update-testnet-contracts.ts [options] [contracts...]

Options:
  -f, --file <path>          Parse Foundry broadcast JSON file
  -p, --parse-output <path>  Parse console output file for addresses
  -m, --manual               Parse contract=address from positional args
  -n, --network <name>       Target network (default: testnet)
  --dry-run                  Preview changes without saving
  -h, --help                 Show this help

Examples:
  # Parse Foundry broadcast
  bun run scripts/deploy/update-testnet-contracts.ts --file broadcast/DeployDWS.s.sol/420690/run-latest.json

  # Parse console output
  forge script ... 2>&1 | tee output.txt
  bun run scripts/deploy/update-testnet-contracts.ts --parse-output output.txt

  # Manual update
  bun run scripts/deploy/update-testnet-contracts.ts --manual IdentityRegistry=0x... JNSRegistry=0x...
`)
    process.exit(0)
  }

  const network = values.network as 'localnet' | 'testnet' | 'mainnet'
  if (!['localnet', 'testnet', 'mainnet'].includes(network)) {
    throw new Error(`Invalid network: ${network}`)
  }

  let contracts = new Map<string, Address>()

  // Parse input source
  if (values.file) {
    const filePath = values.file.startsWith('/')
      ? values.file
      : join(CONTRACTS_DIR, values.file)
    contracts = parseFoundryBroadcast(filePath)
  } else if (values['parse-output']) {
    const content = readFileSync(values['parse-output'], 'utf-8')
    contracts = parseConsoleOutput(content)
  } else if (values.manual || positionals.length > 0) {
    contracts = parseManualInput(positionals)
  } else {
    // Try to find latest broadcast files
    const broadcastDirs = [
      join(
        CONTRACTS_DIR,
        `broadcast/DeployDWS.s.sol/${network === 'testnet' ? '420690' : network === 'mainnet' ? '420691' : '31337'}`,
      ),
      join(
        CONTRACTS_DIR,
        `broadcast/DeployX402.s.sol/${network === 'testnet' ? '420690' : network === 'mainnet' ? '420691' : '31337'}`,
      ),
    ]

    for (const dir of broadcastDirs) {
      const runLatest = join(dir, 'run-latest.json')
      if (existsSync(runLatest)) {
        log(`Found broadcast: ${runLatest}`, 'info')
        const parsed = parseFoundryBroadcast(runLatest)
        for (const [name, addr] of parsed) {
          contracts.set(name, addr)
        }
      }
    }
  }

  if (contracts.size === 0) {
    log('No contracts found to update', 'error')
    process.exit(1)
  }

  // Load and update config
  const config = loadContractsConfig()
  let updated = 0

  for (const [contractName, address] of contracts) {
    const categoryPath = CONTRACT_CATEGORIES[contractName]
    if (categoryPath) {
      const fullPath = `${network}.${categoryPath}`
      log(`Setting ${fullPath} = ${address}`, 'info')
      setNestedValue(
        config as unknown as Record<string, unknown>,
        fullPath,
        address,
      )
      updated++
    } else {
      log(`Unknown contract: ${contractName} (skipping)`, 'warn')
    }
  }

  // Save config
  if (values['dry-run']) {
    log(`[DRY RUN] Would update ${updated} contracts`, 'info')
    console.log('\nPreview:')
    console.log(JSON.stringify(config[network], null, 2))
  } else {
    saveContractsConfig(config)
    log(`Updated ${updated} contract addresses for ${network}`, 'success')
  }

  // Also update deployment files
  const deploymentFile = join(
    CONTRACTS_DIR,
    `deployments/${network}/deployment.json`,
  )
  if (!values['dry-run']) {
    const deploymentDir = join(CONTRACTS_DIR, `deployments/${network}`)
    if (!existsSync(deploymentDir)) {
      const { mkdirSync } = await import('node:fs')
      mkdirSync(deploymentDir, { recursive: true })
    }

    const existingDeployment = existsSync(deploymentFile)
      ? JSON.parse(readFileSync(deploymentFile, 'utf-8'))
      : {
          network,
          chainId:
            network === 'testnet'
              ? 420690
              : network === 'mainnet'
                ? 420691
                : 31337,
        }

    // Update with new addresses
    for (const [contractName, address] of contracts) {
      const categoryPath = CONTRACT_CATEGORIES[contractName]
      if (categoryPath) {
        setNestedValue(existingDeployment, categoryPath, address)
      }
    }

    existingDeployment.deployedAt = new Date().toISOString()
    writeFileSync(deploymentFile, JSON.stringify(existingDeployment, null, 2))
    log(`Updated deployment file: ${deploymentFile}`, 'success')
  }
}

main().catch((error) => {
  console.error('❌ Failed:', error.message)
  process.exit(1)
})
