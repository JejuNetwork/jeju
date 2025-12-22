#!/usr/bin/env bun

/**
 * Deploy Governance Infrastructure
 *
 * Deploys:
 * 1. DelegationRegistry - Vote delegation and security council
 * 2. CircuitBreaker - Emergency pause system
 * 3. CouncilSafeModule - AI CEO signing module
 * 4. Gnosis Safe - Multi-sig treasury
 *
 * Usage:
 *   bun scripts/deploy-governance.ts --network localnet
 *   bun scripts/deploy-governance.ts --network testnet
 *   bun scripts/deploy-governance.ts --network mainnet
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getAddress,
  getContractAddress,
  http,
  parseAbi,
  parseEther,
  zeroAddress,
  zeroHash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  decodeEventLog,
  getBalance,
  getLogs,
  waitForTransactionReceipt,
} from 'viem/actions'

// Configuration
interface NetworkConfig {
  rpcUrl: string
  chainId: number
  safeFactory: string
  safeSingleton: string
  safeFallbackHandler: string
  explorerUrl: string
}

interface DeployedAddresses {
  delegationRegistry: string
  circuitBreaker: string
  councilSafeModule: string
  safe: string
  council: string
  identityRegistry: string
  reputationRegistry: string
  governanceToken: string
}

const NETWORKS: Record<string, NetworkConfig> = {
  localnet: {
    rpcUrl: process.env.LOCALNET_RPC_URL ?? 'http://localhost:9545',
    chainId: 31337,
    safeFactory: '0x0000000000000000000000000000000000000000',
    safeSingleton: '0x0000000000000000000000000000000000000000',
    safeFallbackHandler: '0x0000000000000000000000000000000000000000',
    explorerUrl: '',
  },
  testnet: {
    rpcUrl:
      process.env.JEJU_TESTNET_RPC_URL ?? 'https://testnet-rpc.jejunetwork.org',
    chainId: 420690,
    safeFactory: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
    safeSingleton: '0x3E5c63644E683549055b9Be8653de26E0B4CD36E',
    safeFallbackHandler: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  mainnet: {
    rpcUrl: process.env.JEJU_RPC_URL ?? 'https://rpc.jejunetwork.org',
    chainId: 420691,
    safeFactory: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
    safeSingleton: '0x3E5c63644E683549055b9Be8653de26E0B4CD36E',
    safeFallbackHandler: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4',
    explorerUrl: 'https://basescan.org',
  },
}

// Contract ABIs (minimal for deployment)
const DELEGATION_REGISTRY_ABI = parseAbi([
  'constructor(address governanceToken, address identityRegistry, address reputationRegistry, address initialOwner)',
  'function version() view returns (string)',
])

const CIRCUIT_BREAKER_ABI = parseAbi([
  'constructor(address safe, address delegationRegistry, address initialOwner)',
  'function version() view returns (string)',
  'function registerContract(address target, string name, uint256 priority)',
])

const COUNCIL_SAFE_MODULE_ABI = parseAbi([
  'constructor(address safe, address council, address teeOperator, bytes32 trustedMeasurement, address initialOwner)',
  'function version() view returns (string)',
])

const SAFE_FACTORY_ABI = parseAbi([
  'function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) returns (address proxy)',
  'event ProxyCreation(address proxy, address singleton)',
])

const SAFE_ABI = parseAbi([
  'function setup(address[] calldata owners, uint256 threshold, address to, bytes calldata data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver)',
  'function enableModule(address module)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
])

// Parse arguments
const args = process.argv.slice(2)
const networkArg =
  args.find((a) => a.startsWith('--network='))?.split('=')[1] ?? 'localnet'
const dryRun = args.includes('--dry-run')

if (!NETWORKS[networkArg]) {
  console.error(`Unknown network: ${networkArg}`)
  console.error('Available networks:', Object.keys(NETWORKS).join(', '))
  process.exit(1)
}

const network = NETWORKS[networkArg]

async function main() {
  console.log(`\n🏛️  Deploying Governance Infrastructure to ${networkArg}`)
  console.log('='.repeat(60))

  // Load private key
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required')
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const chain: Chain = {
    id: network.chainId,
    name: networkArg,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  }
  const publicClient = createPublicClient({
    chain,
    transport: http(network.rpcUrl),
  })
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(network.rpcUrl),
  })

  console.log(`\nDeployer: ${account.address}`)
  const balance = await getBalance(publicClient, { address: account.address })
  console.log(`Balance: ${formatEther(balance)} ETH`)

  if (balance < parseEther('0.1')) {
    console.warn('⚠️  Low balance, deployment may fail')
  }

  // Load existing addresses
  const addressesPath = join(
    process.cwd(),
    'config',
    'addresses',
    `${networkArg}.json`,
  )
  let existingAddresses: Partial<DeployedAddresses> = {}

  if (existsSync(addressesPath)) {
    existingAddresses = JSON.parse(
      readFileSync(addressesPath, 'utf-8'),
    ) as Partial<DeployedAddresses>
    console.log('\nLoaded existing addresses:')
    console.log(JSON.stringify(existingAddresses, null, 2))
  }

  // Get required addresses
  const governanceToken =
    existingAddresses.governanceToken ?? process.env.GOVERNANCE_TOKEN_ADDRESS
  const identityRegistry =
    existingAddresses.identityRegistry ?? process.env.IDENTITY_REGISTRY_ADDRESS
  const reputationRegistry =
    existingAddresses.reputationRegistry ??
    process.env.REPUTATION_REGISTRY_ADDRESS
  const council = existingAddresses.council ?? process.env.COUNCIL_ADDRESS

  if (
    !governanceToken ||
    !identityRegistry ||
    !reputationRegistry ||
    !council
  ) {
    console.error('\nMissing required contract addresses:')
    if (!governanceToken) console.error('  - GOVERNANCE_TOKEN_ADDRESS')
    if (!identityRegistry) console.error('  - IDENTITY_REGISTRY_ADDRESS')
    if (!reputationRegistry) console.error('  - REPUTATION_REGISTRY_ADDRESS')
    if (!council) console.error('  - COUNCIL_ADDRESS')
    console.error('\nSet these in environment or deploy base contracts first.')
    process.exit(1)
  }

  const deployedAddresses: DeployedAddresses = {
    governanceToken,
    identityRegistry,
    reputationRegistry,
    council,
    delegationRegistry: '',
    circuitBreaker: '',
    councilSafeModule: '',
    safe: '',
  }

  if (dryRun) {
    console.log('\n🔍 DRY RUN - No transactions will be sent')
  }

  // Step 1: Deploy Safe (multi-sig)
  console.log('\n📦 Step 1: Deploying Gnosis Safe...')

  if (network.safeFactory !== '0x0000000000000000000000000000000000000000') {
    // Initial owners: deployer + 2 additional signers from env
    const signer2 = (process.env.SAFE_SIGNER_2 ?? account.address) as Address
    const signer3 = (process.env.SAFE_SIGNER_3 ?? account.address) as Address
    const owners = [account.address, signer2, signer3].filter(
      (v, i, a) => a.indexOf(v) === i,
    ) as Address[]
    const threshold = BigInt(Math.min(2, owners.length))

    console.log(`  Owners (${owners.length}):`, owners)
    console.log(`  Threshold: ${threshold}`)

    // Encode setup call
    const setupData = encodeFunctionData({
      abi: SAFE_ABI,
      functionName: 'setup',
      args: [
        owners,
        threshold,
        zeroAddress, // to
        '0x' as `0x${string}`, // data
        network.safeFallbackHandler as Address,
        zeroAddress, // paymentToken
        0n, // payment
        zeroAddress, // paymentReceiver
      ],
    })

    const saltNonce = BigInt(Date.now())

    if (!dryRun) {
      const hash = await walletClient.writeContract({
        address: network.safeFactory as Address,
        abi: SAFE_FACTORY_ABI,
        functionName: 'createProxyWithNonce',
        args: [network.safeSingleton as Address, setupData, saltNonce],
        account,
      })
      const receipt = await waitForTransactionReceipt(publicClient, { hash })

      // Parse ProxyCreation event
      const logs = await getLogs(publicClient, {
        address: network.safeFactory as Address,
        event: SAFE_FACTORY_ABI[1],
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      })
      if (logs.length > 0) {
        const decoded = decodeEventLog({
          abi: SAFE_FACTORY_ABI,
          data: logs[0].data,
          topics: logs[0].topics,
        })
        if (decoded.eventName === 'ProxyCreation' && 'proxy' in decoded.args) {
          deployedAddresses.safe = getAddress(decoded.args.proxy as string)
        }
      }

      console.log(`  ✅ Safe deployed: ${deployedAddresses.safe}`)
    } else {
      console.log('  [DRY RUN] Would deploy Safe with owners:', owners)
    }
  } else {
    console.log('  ⚠️  Skipping Safe deployment on localnet (no factory)')
    deployedAddresses.safe = account.address // Use deployer as "Safe" for localnet
  }

  // Step 2: Deploy DelegationRegistry
  console.log('\n📦 Step 2: Deploying DelegationRegistry...')

  const delegationBytecode = await loadBytecode('DelegationRegistry')

  if (!dryRun) {
    const deployData = encodeDeployData({
      abi: DELEGATION_REGISTRY_ABI,
      bytecode: delegationBytecode as `0x${string}`,
      args: [
        governanceToken as Address,
        identityRegistry as Address,
        reputationRegistry as Address,
        account.address,
      ],
    })

    const nonce = await publicClient.getTransactionCount({
      address: account.address,
    })
    const hash = await walletClient.sendTransaction({
      data: deployData,
      account,
    })
    const receipt = await waitForTransactionReceipt(publicClient, { hash })

    const address =
      receipt.contractAddress ||
      getContractAddress({ from: account.address, nonce: BigInt(nonce) })
    deployedAddresses.delegationRegistry = address
    console.log(
      `  ✅ DelegationRegistry: ${deployedAddresses.delegationRegistry}`,
    )
  } else {
    console.log('  [DRY RUN] Would deploy DelegationRegistry')
  }

  // Step 3: Deploy CircuitBreaker
  console.log('\n📦 Step 3: Deploying CircuitBreaker...')

  const circuitBreakerBytecode = await loadBytecode('CircuitBreaker')

  if (!dryRun) {
    const deployData = encodeDeployData({
      abi: CIRCUIT_BREAKER_ABI,
      bytecode: circuitBreakerBytecode as `0x${string}`,
      args: [
        deployedAddresses.safe as Address,
        deployedAddresses.delegationRegistry as Address,
        account.address,
      ],
    })

    const nonce = await publicClient.getTransactionCount({
      address: account.address,
    })
    const hash = await walletClient.sendTransaction({
      data: deployData,
      account,
    })
    const receipt = await waitForTransactionReceipt(publicClient, { hash })

    const address =
      receipt.contractAddress ||
      getContractAddress({ from: account.address, nonce: BigInt(nonce) })
    deployedAddresses.circuitBreaker = address
    console.log(`  ✅ CircuitBreaker: ${deployedAddresses.circuitBreaker}`)

    // Register Council contract for protection
    const registerHash = await walletClient.writeContract({
      address: deployedAddresses.circuitBreaker as Address,
      abi: CIRCUIT_BREAKER_ABI,
      functionName: 'registerContract',
      args: [council as Address, 'Council', 1n],
      account,
    })
    await waitForTransactionReceipt(publicClient, { hash: registerHash })
    console.log('  ✅ Registered Council for circuit breaker protection')
  } else {
    console.log('  [DRY RUN] Would deploy CircuitBreaker')
  }

  // Step 4: Deploy CouncilSafeModule
  console.log('\n📦 Step 4: Deploying CouncilSafeModule...')

  const teeOperator = (process.env.TEE_OPERATOR_ADDRESS ??
    account.address) as Address
  const trustedMeasurement = (process.env.TRUSTED_MEASUREMENT ??
    zeroHash) as `0x${string}`

  const councilModuleBytecode = await loadBytecode('CouncilSafeModule')

  if (!dryRun) {
    const deployData = encodeDeployData({
      abi: COUNCIL_SAFE_MODULE_ABI,
      bytecode: councilModuleBytecode as `0x${string}`,
      args: [
        deployedAddresses.safe as Address,
        council as Address,
        teeOperator,
        trustedMeasurement,
        account.address,
      ],
    })

    const nonce = await publicClient.getTransactionCount({
      address: account.address,
    })
    const hash = await walletClient.sendTransaction({
      data: deployData,
      account,
    })
    const receipt = await waitForTransactionReceipt(publicClient, { hash })

    const address =
      receipt.contractAddress ||
      getContractAddress({ from: account.address, nonce: BigInt(nonce) })
    deployedAddresses.councilSafeModule = address
    console.log(
      `  ✅ CouncilSafeModule: ${deployedAddresses.councilSafeModule}`,
    )
  } else {
    console.log('  [DRY RUN] Would deploy CouncilSafeModule')
  }

  // Step 5: Enable module on Safe
  if (!dryRun && deployedAddresses.safe !== account.address) {
    console.log('\n📦 Step 5: Enabling module on Safe...')
    console.log('  ⚠️  Manual step required: Call enableModule on Safe')
    console.log(`     Safe: ${deployedAddresses.safe}`)
    console.log(`     Module: ${deployedAddresses.councilSafeModule}`)
    console.log('     Use Safe UI or CLI to add the module')
  }

  // Save addresses
  if (!dryRun) {
    const outputDir = join(process.cwd(), 'config', 'addresses')
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    writeFileSync(addressesPath, JSON.stringify(deployedAddresses, null, 2))
    console.log(`\n📝 Saved addresses to ${addressesPath}`)
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`)
  console.log('📋 DEPLOYMENT SUMMARY')
  console.log('='.repeat(60))
  console.log(`Network: ${networkArg} (Chain ID: ${network.chainId})`)
  console.log('\nDeployed Contracts:')
  console.log(`  Safe:               ${deployedAddresses.safe}`)
  console.log(`  DelegationRegistry: ${deployedAddresses.delegationRegistry}`)
  console.log(`  CircuitBreaker:     ${deployedAddresses.circuitBreaker}`)
  console.log(`  CouncilSafeModule:  ${deployedAddresses.councilSafeModule}`)

  if (network.explorerUrl) {
    console.log('\nExplorer Links:')
    if (deployedAddresses.safe)
      console.log(
        `  Safe: ${network.explorerUrl}/address/${deployedAddresses.safe}`,
      )
    if (deployedAddresses.delegationRegistry)
      console.log(
        `  Delegation: ${network.explorerUrl}/address/${deployedAddresses.delegationRegistry}`,
      )
    if (deployedAddresses.circuitBreaker)
      console.log(
        `  CircuitBreaker: ${network.explorerUrl}/address/${deployedAddresses.circuitBreaker}`,
      )
    if (deployedAddresses.councilSafeModule)
      console.log(
        `  SafeModule: ${network.explorerUrl}/address/${deployedAddresses.councilSafeModule}`,
      )
  }

  console.log('\n✅ Governance deployment complete!')

  if (!dryRun) {
    console.log('\n📌 NEXT STEPS:')
    console.log('1. Enable CouncilSafeModule on Safe via Safe UI')
    console.log('2. Add additional Safe signers if needed')
    console.log('3. Register delegates in DelegationRegistry')
    console.log('4. Update security council via updateSecurityCouncil()')
    console.log('5. Configure TEE operator and trusted measurement')
  }
}

async function loadBytecode(contractName: string): Promise<string> {
  // Try to load from forge artifacts
  const artifactPaths = [
    join(
      process.cwd(),
      'packages',
      'contracts',
      'out',
      `${contractName}.sol`,
      `${contractName}.json`,
    ),
    join(process.cwd(), 'out', `${contractName}.sol`, `${contractName}.json`),
  ]

  for (const path of artifactPaths) {
    if (existsSync(path)) {
      const artifact = JSON.parse(readFileSync(path, 'utf-8')) as {
        bytecode: { object: string }
      }
      return artifact.bytecode.object
    }
  }

  throw new Error(
    `Bytecode not found for ${contractName}. Run 'forge build' in packages/contracts first.`,
  )
}

main().catch((error) => {
  console.error('\n❌ Deployment failed:', error)
  process.exit(1)
})
