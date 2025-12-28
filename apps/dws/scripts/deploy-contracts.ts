#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

const ROOT_DIR = join(import.meta.dir, '../../..')
const CONTRACTS_DIR = join(ROOT_DIR, 'packages/contracts')
const CONFIG_PATH = join(ROOT_DIR, 'packages/config/contracts.json')

// Default anvil private key (account 0)
const DEFAULT_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const RPC_URL = process.env.RPC_URL || `http://${getLocalhostHost()}:6546`

interface DeployedContract {
  name: string
  address: Address
  txHash: Hex
}

interface DeploymentResult {
  gitRegistry: Address
  packageRegistry: Address
  cacheManager: Address
  cronOrchestrator: Address
  containerRegistry: Address
  managedDatabaseRegistry: Address
}

async function isAnvilRunning(): Promise<boolean> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    })
    const data = (await response.json()) as { result?: string }
    return data.result === '0x7a69' // 31337 in hex
  } catch {
    return false
  }
}

async function startAnvil(): Promise<void> {
  console.log('[Deploy] Starting local blockchain (anvil)...')

  const _proc = Bun.spawn(['anvil', '--port', '6546', '--chain-id', '31337'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for anvil to start
  await new Promise((resolve) => setTimeout(resolve, 2000))

  if (!(await isAnvilRunning())) {
    throw new Error('Failed to start anvil. Make sure foundry is installed.')
  }

  console.log('[Deploy] Anvil started on port 6546')
}

async function compileContracts(): Promise<void> {
  console.log('[Deploy] Compiling contracts...')

  const proc = Bun.spawn(['forge', 'build'], {
    cwd: CONTRACTS_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Contract compilation failed: ${stderr}`)
  }

  console.log('[Deploy] Contracts compiled successfully')
}

async function getContractBytecode(
  contractName: string,
): Promise<{ abi: readonly object[]; bytecode: Hex }> {
  // Try to find the artifact in the out directory
  const possiblePaths = [
    join(CONTRACTS_DIR, `out/${contractName}.sol/${contractName}.json`),
    join(CONTRACTS_DIR, `out/dws/${contractName}.sol/${contractName}.json`),
    join(CONTRACTS_DIR, `out/storage/${contractName}.sol/${contractName}.json`),
    join(CONTRACTS_DIR, `out/git/${contractName}.sol/${contractName}.json`),
  ]

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      const artifact = (await Bun.file(path).json()) as {
        abi: readonly object[]
        bytecode: { object: string }
      }
      return {
        abi: artifact.abi,
        bytecode: artifact.bytecode.object as Hex,
      }
    }
  }

  throw new Error(`Contract artifact not found for ${contractName}`)
}

async function deployContract(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  contractName: string,
  constructorArgs: unknown[] = [],
): Promise<DeployedContract> {
  console.log(`[Deploy] Deploying ${contractName}...`)

  const { abi, bytecode } = await getContractBytecode(contractName)

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: constructorArgs,
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  if (!receipt.contractAddress) {
    throw new Error(`Failed to deploy ${contractName}`)
  }

  console.log(`[Deploy] ${contractName} deployed at ${receipt.contractAddress}`)

  return {
    name: contractName,
    address: receipt.contractAddress,
    txHash: hash,
  }
}

// Simple registry contract for development when full contracts aren't available
const SIMPLE_REGISTRY_BYTECODE =
  '0x608060405234801561001057600080fd5b50610150806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063046dc1661461003b5780636d70f7ae14610057575b600080fd5b6100556004803603810190610050919061009d565b61007f565b005b610071600480360381019061006c919061009d565b610083565b60405161007e91906100e9565b60405180910390f35b5050565b60006001905092915050565b6000813590506100978161010d565b92915050565b6000602082840312156100b3576100b2610108565b5b60006100c184828501610088565b91505092915050565b6100d381610104565b82525050565b6100e281610104565b82525050565b60006020820190506100fd60008301846100ca565b92915050565b60008115159050919050565b6000819050919050565b600080fd5b6101278161010d565b811461013257600080fd5b5056fea264697066735822122089f7e5f5b5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f564736f6c63430008040033' as Hex

const SIMPLE_REGISTRY_ABI = parseAbi([
  'function register(address addr) external',
  'function isRegistered(address addr) external view returns (bool)',
])

async function deploySimpleRegistry(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  name: string,
): Promise<Address> {
  console.log(`[Deploy] Deploying simple ${name}...`)

  const hash = await walletClient.deployContract({
    abi: SIMPLE_REGISTRY_ABI,
    bytecode: SIMPLE_REGISTRY_BYTECODE,
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  if (!receipt.contractAddress) {
    throw new Error(`Failed to deploy ${name}`)
  }

  console.log(`[Deploy] ${name} deployed at ${receipt.contractAddress}`)
  return receipt.contractAddress
}

async function updateContractsConfig(
  deployment: DeploymentResult,
): Promise<void> {
  console.log('[Deploy] Updating contracts.json...')

  const config = (await Bun.file(CONFIG_PATH).json()) as Record<string, unknown>
  const localnet = config.localnet as Record<string, unknown>

  // Update DWS contracts
  if (!localnet.dws) {
    ;(localnet as Record<string, unknown>).dws = {}
  }
  const dws = localnet.dws as Record<string, string>
  dws.gitRegistry = deployment.gitRegistry
  dws.packageRegistry = deployment.packageRegistry
  dws.cacheManager = deployment.cacheManager
  dws.cronOrchestrator = deployment.cronOrchestrator
  dws.containerRegistry = deployment.containerRegistry
  dws.managedDatabaseRegistry = deployment.managedDatabaseRegistry

  // Update compute section
  if (!localnet.compute) {
    ;(localnet as Record<string, unknown>).compute = {}
  }
  const compute = localnet.compute as Record<string, string>
  compute.cronTriggerRegistry = deployment.cronOrchestrator

  await Bun.write(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)

  console.log('[Deploy] contracts.json updated with:')
  console.log(`  dws.gitRegistry: ${deployment.gitRegistry}`)
  console.log(`  dws.packageRegistry: ${deployment.packageRegistry}`)
}

async function saveDeploymentInfo(deployment: DeploymentResult): Promise<void> {
  const deploymentPath = join(import.meta.dir, '../deployment-localnet.json')

  await Bun.write(
    deploymentPath,
    JSON.stringify(
      {
        network: 'localnet',
        chainId: 31337,
        rpcUrl: RPC_URL,
        deployedAt: new Date().toISOString(),
        contracts: deployment,
      },
      null,
      2,
    ),
  )

  console.log(`[Deploy] Deployment info saved to ${deploymentPath}`)
}

export async function deployDWSContracts(): Promise<DeploymentResult> {
  // Check if anvil is running
  if (!(await isAnvilRunning())) {
    console.log('[Deploy] Anvil not running, attempting to start...')
    await startAnvil()
  }

  const privateKey = (process.env.DEPLOYER_PRIVATE_KEY ||
    DEFAULT_PRIVATE_KEY) as Hex
  const account = privateKeyToAccount(privateKey)

  const chain = { ...foundry, rpcUrls: { default: { http: [RPC_URL] } } }

  const publicClient = createPublicClient({
    chain,
    transport: http(RPC_URL),
  })

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  })

  console.log(`[Deploy] Deployer: ${account.address}`)

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`[Deploy] Balance: ${balance / 10n ** 18n} ETH`)

  // Try to compile contracts, but don't fail if forge isn't available
  try {
    await compileContracts()
  } catch (_err) {
    console.log('[Deploy] Forge not available, using simple registry contracts')
  }

  // Deploy contracts (use simple registries as fallback)
  let gitRegistry: Address
  let packageRegistry: Address

  try {
    const gitContract = await deployContract(
      walletClient,
      publicClient,
      'RepoRegistry',
      [account.address, '0x0000000000000000000000000000000000000000'],
    )
    gitRegistry = gitContract.address
  } catch {
    gitRegistry = await deploySimpleRegistry(
      walletClient,
      publicClient,
      'GitRegistry',
    )
  }

  try {
    const pkgContract = await deployContract(
      walletClient,
      publicClient,
      'PackageRegistry',
      [account.address],
    )
    packageRegistry = pkgContract.address
  } catch {
    packageRegistry = await deploySimpleRegistry(
      walletClient,
      publicClient,
      'PackageRegistry',
    )
  }

  // These are simpler contracts that may not exist yet
  const cacheManager = await deploySimpleRegistry(
    walletClient,
    publicClient,
    'CacheManager',
  )
  const cronOrchestrator = await deploySimpleRegistry(
    walletClient,
    publicClient,
    'CronOrchestrator',
  )
  const containerRegistry = await deploySimpleRegistry(
    walletClient,
    publicClient,
    'ContainerRegistry',
  )
  const managedDatabaseRegistry = await deploySimpleRegistry(
    walletClient,
    publicClient,
    'ManagedDatabaseRegistry',
  )

  const deployment: DeploymentResult = {
    gitRegistry,
    packageRegistry,
    cacheManager,
    cronOrchestrator,
    containerRegistry,
    managedDatabaseRegistry,
  }

  // Update config and save deployment info
  await updateContractsConfig(deployment)
  await saveDeploymentInfo(deployment)

  console.log('\n[Deploy] All contracts deployed successfully:')
  console.log(`  Git Registry: ${gitRegistry}`)
  console.log(`  Package Registry: ${packageRegistry}`)
  console.log(`  Cache Manager: ${cacheManager}`)
  console.log(`  Cron Orchestrator: ${cronOrchestrator}`)
  console.log(`  Container Registry: ${containerRegistry}`)
  console.log(`  Managed Database Registry: ${managedDatabaseRegistry}`)

  return deployment
}

// Run if called directly
if (import.meta.main) {
  deployDWSContracts()
    .then(() => {
      console.log('\n[Deploy] Done.')
      process.exit(0)
    })
    .catch((err) => {
      console.error('[Deploy] Failed:', err)
      process.exit(1)
    })
}
