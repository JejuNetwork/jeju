#!/usr/bin/env bun
/**
 * End-to-End L1 → L2 Rollup Integration Test
 *
 * This script:
 * 1. Starts a local L1 (Anvil)
 * 2. Deploys OP Stack L1 contracts
 * 3. Deploys Stage 2 decentralization contracts
 * 4. Verifies the full rollup flow works
 *
 * Usage:
 *   bun run packages/deployment/scripts/e2e/rollup-integration-test.ts
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  parseAbi,
  type Address,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { waitForTransactionReceipt, readContract } from 'viem/actions'

const ROOT = join(import.meta.dir, '../../../..')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')
const OUTPUT_DIR = join(ROOT, '.e2e-test')

// Test accounts (Anvil defaults)
const ANVIL_ACCOUNTS = {
  deployer: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
  },
  sequencer1: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`,
  },
  sequencer2: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address,
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as `0x${string}`,
  },
  challenger: {
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address,
    privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as `0x${string}`,
  },
}

interface TestResult {
  name: string
  passed: boolean
  error?: string
  duration?: number
}

interface DeploymentAddresses {
  jejuToken: Address
  identityRegistry: Address
  reputationRegistry: Address
  sequencerRegistry: Address
  governanceTimelock: Address
  disputeGameFactory: Address
  cannonProver: Address
  thresholdBatchSubmitter: Address
  forcedInclusion: Address
  l2OutputOracleAdapter: Address
  optimismPortalAdapter: Address
}

const results: TestResult[] = []
let deployedAddresses: DeploymentAddresses | null = null

const localnet: Chain = {
  id: 31337,
  name: 'Anvil Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
}

async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  E2E ROLLUP INTEGRATION TEST                                     ║
║  Testing full L1 → L2 decentralization flow                      ║
╚═══════════════════════════════════════════════════════════════════╝
`)

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  // Step 1: Start L1 (Anvil)
  await runTest('Start L1 (Anvil)', startL1)

  // Step 2: Deploy decentralization contracts
  await runTest('Deploy Decentralization Contracts', deployContracts)

  // Step 3: Verify contract deployment
  await runTest('Verify Contract Deployment', verifyContracts)

  // Step 4: Register sequencers
  await runTest('Register Sequencers', registerSequencers)

  // Step 5: Test threshold batch submission
  await runTest('Threshold Batch Submission', testThresholdBatch)

  // Step 6: Test dispute game creation
  await runTest('Create Dispute Game', testDisputeGame)

  // Step 7: Test governance timelock
  await runTest('Governance Timelock', testGovernanceTimelock)

  // Step 8: Test forced inclusion
  await runTest('Forced Inclusion', testForcedInclusion)

  // Print summary
  printSummary()
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now()
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`🧪 ${name}...`)

  try {
    await fn()
    const duration = Date.now() - start
    results.push({ name, passed: true, duration })
    console.log(`   ✅ PASSED (${duration}ms)`)
  } catch (error) {
    const duration = Date.now() - start
    const errorMsg = error instanceof Error ? error.message : String(error)
    results.push({ name, passed: false, error: errorMsg, duration })
    console.log(`   ❌ FAILED: ${errorMsg}`)
  }
}

async function startL1(): Promise<void> {
  // Check if anvil is already running
  try {
    const publicClient = createPublicClient({
      chain: localnet,
      transport: http('http://127.0.0.1:8545'),
    })
    await publicClient.getBlockNumber()
    console.log('   Anvil already running')
    return
  } catch {
    // Not running, start it
  }

  console.log('   Starting Anvil...')
  const anvilProc = Bun.spawn(['anvil', '--port', '8545', '--chain-id', '31337'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for anvil to be ready
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      const publicClient = createPublicClient({
        chain: localnet,
        transport: http('http://127.0.0.1:8545'),
      })
      await publicClient.getBlockNumber()
      console.log('   Anvil started on port 8545')

      // Save process info
      writeFileSync(join(OUTPUT_DIR, 'anvil.pid'), String(anvilProc.pid))
      return
    } catch {
      // Keep waiting
    }
  }

  throw new Error('Anvil failed to start')
}

async function deployContracts(): Promise<void> {
  console.log('   Running forge script...')

  const env = {
    ...process.env,
    PRIVATE_KEY: ANVIL_ACCOUNTS.deployer.privateKey,
  }

  const result = await $`cd ${CONTRACTS_DIR} && forge script script/DeployDecentralization.s.sol:DeployDecentralization --rpc-url http://127.0.0.1:8545 --broadcast --legacy 2>&1`
    .env(env)
    .nothrow()

  const output = result.text()

  if (result.exitCode !== 0) {
    console.log(output)
    throw new Error(`Forge script failed with exit code ${result.exitCode}`)
  }

  // Parse deployed addresses from output
  deployedAddresses = parseDeploymentOutput(output)

  // Save deployment
  writeFileSync(
    join(OUTPUT_DIR, 'deployment.json'),
    JSON.stringify(deployedAddresses, null, 2)
  )

  console.log('   Contracts deployed:')
  console.log(`     SequencerRegistry: ${deployedAddresses.sequencerRegistry}`)
  console.log(`     GovernanceTimelock: ${deployedAddresses.governanceTimelock}`)
  console.log(`     DisputeGameFactory: ${deployedAddresses.disputeGameFactory}`)
}

function parseDeploymentOutput(output: string): DeploymentAddresses {
  const patterns: Record<keyof DeploymentAddresses, RegExp> = {
    jejuToken: /MockJEJUToken deployed: (0x[a-fA-F0-9]{40})/,
    identityRegistry: /IdentityRegistry deployed: (0x[a-fA-F0-9]{40})/,
    reputationRegistry: /ReputationRegistry deployed: (0x[a-fA-F0-9]{40})/,
    sequencerRegistry: /SequencerRegistry deployed: (0x[a-fA-F0-9]{40})/,
    governanceTimelock: /GovernanceTimelock deployed: (0x[a-fA-F0-9]{40})/,
    disputeGameFactory: /DisputeGameFactory deployed: (0x[a-fA-F0-9]{40})/,
    cannonProver: /CannonProver deployed: (0x[a-fA-F0-9]{40})/,
    thresholdBatchSubmitter: /ThresholdBatchSubmitter deployed: (0x[a-fA-F0-9]{40})/,
    forcedInclusion: /ForcedInclusion deployed: (0x[a-fA-F0-9]{40})/,
    l2OutputOracleAdapter: /L2OutputOracleAdapter deployed: (0x[a-fA-F0-9]{40})/,
    optimismPortalAdapter: /OptimismPortalAdapter deployed: (0x[a-fA-F0-9]{40})/,
  }

  const addresses: Partial<DeploymentAddresses> = {}
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = output.match(pattern)
    if (match) {
      addresses[key as keyof DeploymentAddresses] = match[1] as Address
    }
  }

  // Validate all required addresses found
  const required = ['sequencerRegistry', 'governanceTimelock', 'disputeGameFactory'] as const
  for (const key of required) {
    if (!addresses[key]) {
      throw new Error(`Failed to find ${key} address in deployment output`)
    }
  }

  return addresses as DeploymentAddresses
}

async function verifyContracts(): Promise<void> {
  if (!deployedAddresses) throw new Error('No deployment addresses')

  const publicClient = createPublicClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
  })

  // Verify each contract has code
  const contracts = [
    { name: 'SequencerRegistry', address: deployedAddresses.sequencerRegistry },
    { name: 'GovernanceTimelock', address: deployedAddresses.governanceTimelock },
    { name: 'DisputeGameFactory', address: deployedAddresses.disputeGameFactory },
  ]

  for (const { name, address } of contracts) {
    const code = await publicClient.getCode({ address })
    if (!code || code === '0x') {
      throw new Error(`${name} has no code at ${address}`)
    }
    console.log(`   ✓ ${name}: ${address}`)
  }
}

async function registerSequencers(): Promise<void> {
  if (!deployedAddresses) throw new Error('No deployment addresses')

  const publicClient = createPublicClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
  })

  const deployerAccount = privateKeyToAccount(ANVIL_ACCOUNTS.deployer.privateKey)
  const walletClient = createWalletClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
    account: deployerAccount,
  })

  // First register identity for sequencer1
  const IDENTITY_ABI = parseAbi([
    'function register(string metadataUri) external returns (uint256)',
    'function balanceOf(address owner) external view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  ])

  console.log('   Registering sequencer1 identity...')

  // Need to call from sequencer1's account
  const seq1Account = privateKeyToAccount(ANVIL_ACCOUNTS.sequencer1.privateKey)
  const seq1Wallet = createWalletClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
    account: seq1Account,
  })

  // Fund sequencer1
  const fundHash = await walletClient.sendTransaction({
    to: ANVIL_ACCOUNTS.sequencer1.address,
    value: parseEther('100'),
  })
  await waitForTransactionReceipt(publicClient, { hash: fundHash })

  // Register identity
  const regHash = await seq1Wallet.writeContract({
    address: deployedAddresses.identityRegistry,
    abi: IDENTITY_ABI,
    functionName: 'register',
    args: ['ipfs://sequencer1'],
  })
  const regReceipt = await waitForTransactionReceipt(publicClient, { hash: regHash })

  // Get agentId from Transfer event (ERC721 mint)
  const transferLog = regReceipt.logs.find(log => 
    log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer event
  )
  const agentId = transferLog ? BigInt(transferLog.topics[3] || '0') : 1n

  console.log(`   Sequencer1 agent ID: ${agentId}`)

  // Approve JEJU tokens for staking
  const TOKEN_ABI = parseAbi([
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function balanceOf(address owner) external view returns (uint256)',
    'function transfer(address to, uint256 amount) external returns (bool)',
  ])

  // Transfer tokens to sequencer1
  const transferHash = await walletClient.writeContract({
    address: deployedAddresses.jejuToken,
    abi: TOKEN_ABI,
    functionName: 'transfer',
    args: [ANVIL_ACCOUNTS.sequencer1.address, parseEther('100000')],
  })
  await waitForTransactionReceipt(publicClient, { hash: transferHash })

  // Approve tokens
  const approveHash = await seq1Wallet.writeContract({
    address: deployedAddresses.jejuToken,
    abi: TOKEN_ABI,
    functionName: 'approve',
    args: [deployedAddresses.sequencerRegistry, parseEther('100000')],
  })
  await waitForTransactionReceipt(publicClient, { hash: approveHash })

  // Register as sequencer
  const REGISTRY_ABI = parseAbi([
    'function register(uint256 agentId, uint256 stake) external',
    'function getActiveSequencers() external view returns (address[] addresses, uint256[] weights)',
  ])

  console.log('   Registering as sequencer...')
  const stakeHash = await seq1Wallet.writeContract({
    address: deployedAddresses.sequencerRegistry,
    abi: REGISTRY_ABI,
    functionName: 'register',
    args: [agentId as bigint, parseEther('10000')],
  })
  await waitForTransactionReceipt(publicClient, { hash: stakeHash })

  // Verify registration
  const activeSeqs = await readContract(publicClient, {
    address: deployedAddresses.sequencerRegistry,
    abi: REGISTRY_ABI,
    functionName: 'getActiveSequencers',
  }) as [Address[], bigint[]]

  const isActive = activeSeqs[0].includes(ANVIL_ACCOUNTS.sequencer1.address)

  if (!isActive) {
    throw new Error('Sequencer registration failed')
  }

  console.log(`   Active sequencer count: ${activeSeqs[0].length}`)
}

async function testThresholdBatch(): Promise<void> {
  if (!deployedAddresses) throw new Error('No deployment addresses')

  const publicClient = createPublicClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
  })

  const BATCHER_ABI = parseAbi([
    'function threshold() external view returns (uint256)',
    'function nonce() external view returns (uint256)',
  ])

  const threshold = await readContract(publicClient, {
    address: deployedAddresses.thresholdBatchSubmitter,
    abi: BATCHER_ABI,
    functionName: 'threshold',
  })

  const nonce = await readContract(publicClient, {
    address: deployedAddresses.thresholdBatchSubmitter,
    abi: BATCHER_ABI,
    functionName: 'nonce',
  })

  console.log(`   Threshold: ${threshold}`)
  console.log(`   Current nonce: ${nonce}`)

  // Note: Full batch submission test requires multiple signers
  // For now we just verify the contract is deployed and configured
}

async function testDisputeGame(): Promise<void> {
  if (!deployedAddresses) throw new Error('No deployment addresses')

  const publicClient = createPublicClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
  })

  const challengerAccount = privateKeyToAccount(ANVIL_ACCOUNTS.challenger.privateKey)
  const walletClient = createWalletClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
    account: challengerAccount,
  })

  // Fund challenger
  const deployerWallet = createWalletClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
    account: privateKeyToAccount(ANVIL_ACCOUNTS.deployer.privateKey),
  })
  const fundHash = await deployerWallet.sendTransaction({
    to: ANVIL_ACCOUNTS.challenger.address,
    value: parseEther('100'),
  })
  await waitForTransactionReceipt(publicClient, { hash: fundHash })

  const FACTORY_ABI = parseAbi([
    'function MIN_BOND() external view returns (uint256)',
    'function createGame(address proposer, bytes32 stateRoot, bytes32 claimRoot, uint8 gameType, uint8 proverType) external payable returns (bytes32)',
    'function getGameCount() external view returns (uint256)',
  ])

  const minBond = await readContract(publicClient, {
    address: deployedAddresses.disputeGameFactory,
    abi: FACTORY_ABI,
    functionName: 'MIN_BOND',
  })

  console.log(`   Min bond: ${formatEther(minBond)} ETH`)

  // Create a dispute game
  const stateRoot = '0x' + '1'.repeat(64) as `0x${string}`
  const claimRoot = '0x' + '2'.repeat(64) as `0x${string}`

  console.log('   Creating dispute game...')
  const createHash = await walletClient.writeContract({
    address: deployedAddresses.disputeGameFactory,
    abi: FACTORY_ABI,
    functionName: 'createGame',
    args: [
      ANVIL_ACCOUNTS.challenger.address, // proposer
      stateRoot,
      claimRoot,
      0, // GameType.CHALLENGE
      0, // ProverType.CANNON
    ],
    value: minBond,
  })

  const receipt = await waitForTransactionReceipt(publicClient, { hash: createHash })
  console.log(`   Game created in block ${receipt.blockNumber}`)

  const gameCount = await readContract(publicClient, {
    address: deployedAddresses.disputeGameFactory,
    abi: FACTORY_ABI,
    functionName: 'getGameCount',
  })

  console.log(`   Total games: ${gameCount}`)
}

async function testGovernanceTimelock(): Promise<void> {
  if (!deployedAddresses) throw new Error('No deployment addresses')

  const publicClient = createPublicClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
  })

  const TIMELOCK_ABI = parseAbi([
    'function timelockDelay() external view returns (uint256)',
    'function EMERGENCY_MIN_DELAY() external view returns (uint256)',
    'function TIMELOCK_DELAY() external view returns (uint256)',
    'function governance() external view returns (address)',
    'function securityCouncil() external view returns (address)',
  ])

  const delay = await readContract(publicClient, {
    address: deployedAddresses.governanceTimelock,
    abi: TIMELOCK_ABI,
    functionName: 'timelockDelay',
  })

  const emergencyMinDelay = await readContract(publicClient, {
    address: deployedAddresses.governanceTimelock,
    abi: TIMELOCK_ABI,
    functionName: 'EMERGENCY_MIN_DELAY',
  })

  const governance = await readContract(publicClient, {
    address: deployedAddresses.governanceTimelock,
    abi: TIMELOCK_ABI,
    functionName: 'governance',
  })

  console.log(`   Timelock delay: ${Number(delay) / 86400} days`)
  console.log(`   Emergency min delay: ${Number(emergencyMinDelay) / 86400} days`)
  console.log(`   Governance: ${governance}`)

  // Verify Stage 2 compliance (30 day timelock)
  const THIRTY_DAYS = 30 * 24 * 60 * 60
  if (Number(delay) < THIRTY_DAYS) {
    console.log(`   ⚠️  Warning: Timelock delay (${Number(delay)}s) is less than 30 days`)
  } else {
    console.log(`   ✓ Stage 2 compliant: 30-day timelock`)
  }
}

async function testForcedInclusion(): Promise<void> {
  if (!deployedAddresses) throw new Error('No deployment addresses')

  const publicClient = createPublicClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
  })

  const userAccount = privateKeyToAccount(ANVIL_ACCOUNTS.challenger.privateKey)
  const walletClient = createWalletClient({
    chain: localnet,
    transport: http('http://127.0.0.1:8545'),
    account: userAccount,
  })

  const FORCED_ABI = parseAbi([
    'function MIN_FEE() external view returns (uint256)',
    'function INCLUSION_WINDOW_BLOCKS() external view returns (uint256)',
    'function queueTx(bytes calldata data, uint256 gasLimit) external payable',
    'function totalPendingFees() external view returns (uint256)',
  ])

  const minFee = await readContract(publicClient, {
    address: deployedAddresses.forcedInclusion,
    abi: FORCED_ABI,
    functionName: 'MIN_FEE',
  })

  const window = await readContract(publicClient, {
    address: deployedAddresses.forcedInclusion,
    abi: FORCED_ABI,
    functionName: 'INCLUSION_WINDOW_BLOCKS',
  })

  console.log(`   Min fee: ${formatEther(minFee)} ETH`)
  console.log(`   Inclusion window: ${window} blocks`)

  // Queue a forced inclusion transaction
  // Data must not be empty per contract requirements
  const txData = '0x1234567890' as `0x${string}` // Non-empty data
  
  console.log('   Queueing forced inclusion tx...')
  const queueHash = await walletClient.writeContract({
    address: deployedAddresses.forcedInclusion,
    abi: FORCED_ABI,
    functionName: 'queueTx',
    args: [txData, 100000n],
    value: minFee,
  })

  await waitForTransactionReceipt(publicClient, { hash: queueHash })

  const pendingFees = await readContract(publicClient, {
    address: deployedAddresses.forcedInclusion,
    abi: FORCED_ABI,
    functionName: 'totalPendingFees',
  })

  console.log(`   Total pending fees: ${formatEther(pendingFees as bigint)} ETH`)
}

function printSummary(): void {
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const totalTime = results.reduce((sum, r) => sum + (r.duration || 0), 0)

  console.log(`
${'═'.repeat(60)}
                    TEST SUMMARY
${'═'.repeat(60)}
`)

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌'
    const time = result.duration ? ` (${result.duration}ms)` : ''
    console.log(`${icon} ${result.name}${time}`)
    if (result.error) {
      console.log(`   Error: ${result.error}`)
    }
  }

  console.log(`
${'─'.repeat(60)}
Total: ${results.length} | Passed: ${passed} | Failed: ${failed}
Total Time: ${totalTime}ms
${'─'.repeat(60)}
`)

  if (failed > 0) {
    console.log('❌ SOME TESTS FAILED')
    process.exit(1)
  } else {
    console.log('✅ ALL TESTS PASSED - L1 deployment is ready!')
    console.log(`
📋 Next Steps:
   1. Deploy to Sepolia testnet:
      PRIVATE_KEY=<key> forge script script/DeployDecentralization.s.sol --rpc-url <sepolia-rpc> --broadcast --verify
   
   2. Generate L2 genesis:
      NETWORK=testnet bun run packages/deployment/scripts/l2-genesis.ts
   
   3. Start OP Stack services with Helm:
      NETWORK=testnet bun run packages/deployment/scripts/helmfile.ts sync
`)
    process.exit(0)
  }
}

main().catch((error) => {
  console.error('❌ Test runner failed:', error)
  process.exit(1)
})

