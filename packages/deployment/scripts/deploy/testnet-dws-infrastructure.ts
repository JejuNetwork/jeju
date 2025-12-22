#!/usr/bin/env bun

/**
 * Testnet DWS Infrastructure Deployment
 *
 * Deploys all required contracts for the Decentralized Web Services:
 * 1. Core Registries (Identity, Reputation, Validation)
 * 2. Git Registry (RepoRegistry)
 * 3. Package Registry (PackageRegistry)
 * 4. Container Registry
 * 5. Model Registry
 * 6. JNS (Jeju Name Service)
 * 7. Storage Manager
 *
 * Then deploys DWS nodes to Kubernetes and configures them.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  keccak256,
  parseEther,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

// ============================================================================
// Configuration
// ============================================================================

interface ContractDeployment {
  name: string
  address: Address
  txHash: string
  blockNumber: number
  deployedAt: string
}

interface DeploymentResult {
  network: 'testnet'
  chainId: number
  deployer: Address
  timestamp: string
  contracts: {
    identityRegistry: ContractDeployment
    reputationRegistry: ContractDeployment
    validationRegistry: ContractDeployment
    repoRegistry: ContractDeployment
    packageRegistry: ContractDeployment
    containerRegistry: ContractDeployment
    modelRegistry: ContractDeployment
    jnsRegistry: ContractDeployment
    jnsRegistrar: ContractDeployment
    jnsResolver: ContractDeployment
    storageManager: ContractDeployment
  }
}

const ROOT_DIR = join(import.meta.dir, '../..')
const CONTRACTS_DIR = join(ROOT_DIR, 'packages/contracts')
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, 'deployments/testnet')

// ============================================================================
// Deployer Class
// ============================================================================

class DWSInfrastructureDeployer {
  private rpcUrl: string
  private privateKey: Hex
  private account: ReturnType<typeof privateKeyToAccount>
  private publicClient: ReturnType<typeof createPublicClient>
  private walletClient: ReturnType<typeof createWalletClient>
  private result: Partial<DeploymentResult>

  constructor() {
    this.rpcUrl = process.env.TESTNET_RPC_URL || 'https://sepolia.base.org'
    this.privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex

    if (!this.privateKey) {
      throw new Error('DEPLOYER_PRIVATE_KEY environment variable required')
    }

    this.account = privateKeyToAccount(this.privateKey)
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.rpcUrl),
    })
    this.walletClient = createWalletClient({
      account: this.account,
      chain: baseSepolia,
      transport: http(this.rpcUrl),
    })

    this.result = {
      network: 'testnet',
      chainId: baseSepolia.id,
      deployer: this.account.address,
      timestamp: new Date().toISOString(),
      contracts: {} as DeploymentResult['contracts'],
    }
  }

  async deploy(): Promise<DeploymentResult> {
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║       JEJU DWS INFRASTRUCTURE DEPLOYMENT - TESTNET                   ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')
    console.log(`RPC URL: ${this.rpcUrl}`)
    console.log(`Deployer: ${this.account.address}`)
    console.log('')

    // Check balance
    const balance = await this.publicClient.getBalance({
      address: this.account.address,
    })
    console.log(`Balance: ${formatEther(balance)} ETH`)
    if (balance < parseEther('0.5')) {
      throw new Error(
        'Insufficient balance. Need at least 0.5 ETH for deployment.',
      )
    }
    console.log('')

    // Compile contracts
    console.log('Compiling contracts...')
    this.compileContracts()
    console.log('')

    // Create deployments directory
    if (!existsSync(DEPLOYMENTS_DIR)) {
      mkdirSync(DEPLOYMENTS_DIR, { recursive: true })
    }

    // Deploy contracts in order
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Deploying Core Registries')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    const identityRegistry = await this.deployContract(
      'IdentityRegistry',
      'src/registry/IdentityRegistry.sol:IdentityRegistry',
      [this.account.address],
    )
    if (!this.result.contracts)
      throw new Error('Contracts object not initialized')
    this.result.contracts.identityRegistry = identityRegistry

    const reputationRegistry = await this.deployContract(
      'ReputationRegistry',
      'src/registry/ReputationRegistry.sol:ReputationRegistry',
      [this.account.address],
    )
    this.result.contracts.reputationRegistry = reputationRegistry

    const validationRegistry = await this.deployContract(
      'ValidationRegistry',
      'src/registry/ValidationRegistry.sol:ValidationRegistry',
      [this.account.address],
    )
    this.result.contracts.validationRegistry = validationRegistry

    console.log('')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Deploying DWS Registries')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    const repoRegistry = await this.deployContract(
      'RepoRegistry',
      'src/git/RepoRegistry.sol:RepoRegistry',
      [this.account.address, identityRegistry.address],
    )
    this.result.contracts.repoRegistry = repoRegistry

    const packageRegistry = await this.deployContract(
      'PackageRegistry',
      'src/pkg/PackageRegistry.sol:PackageRegistry',
      [this.account.address, identityRegistry.address],
    )
    this.result.contracts.packageRegistry = packageRegistry

    const containerRegistry = await this.deployContract(
      'ContainerRegistry',
      'src/containers/ContainerRegistry.sol:ContainerRegistry',
      [identityRegistry.address, this.account.address, this.account.address],
    )
    this.result.contracts.containerRegistry = containerRegistry

    const modelRegistry = await this.deployContract(
      'ModelRegistry',
      'src/models/ModelRegistry.sol:ModelRegistry',
      [identityRegistry.address, this.account.address, this.account.address],
    )
    this.result.contracts.modelRegistry = modelRegistry

    console.log('')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Deploying JNS (Jeju Name Service)')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    const jnsRegistry = await this.deployContract(
      'JNSRegistry',
      'src/names/JNSRegistry.sol:JNSRegistry',
      [],
    )
    this.result.contracts.jnsRegistry = jnsRegistry

    const jnsResolver = await this.deployContract(
      'JNSResolver',
      'src/names/JNSResolver.sol:JNSResolver',
      [jnsRegistry.address],
    )
    this.result.contracts.jnsResolver = jnsResolver

    const jnsRegistrar = await this.deployContract(
      'JNSRegistrar',
      'src/names/JNSRegistrar.sol:JNSRegistrar',
      [
        jnsRegistry.address,
        identityRegistry.address,
        jnsResolver.address,
        this.account.address,
      ],
    )
    this.result.contracts.jnsRegistrar = jnsRegistrar

    console.log('')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Deploying Storage Manager')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    const storageManager = await this.deployContract(
      'StorageManager',
      'src/storage/StorageManager.sol:StorageManager',
      [identityRegistry.address, this.account.address, this.account.address],
    )
    this.result.contracts.storageManager = storageManager

    console.log('')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Post-Deployment Configuration')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    // Configure JNS: Set .jeju TLD ownership to registrar
    console.log('Configuring JNS .jeju TLD...')
    await this.configureJNS(jnsRegistry.address, jnsRegistrar.address)

    // Save deployment result
    this.saveDeployment()

    // Print summary
    this.printSummary()

    return this.result as DeploymentResult
  }

  private compileContracts(): void {
    execSync('forge build', { cwd: CONTRACTS_DIR, stdio: 'inherit' })
  }

  private async deployContract(
    name: string,
    path: string,
    args: (string | Address)[],
  ): Promise<ContractDeployment> {
    console.log(`Deploying ${name}...`)

    const argsStr = args.map((a) => `"${a}"`).join(' ')
    const cmd = `forge create ${path} \
      --rpc-url ${this.rpcUrl} \
      --private-key ${this.privateKey} \
      ${args.length > 0 ? `--constructor-args ${argsStr}` : ''} \
      --json`

    const output = execSync(cmd, {
      cwd: CONTRACTS_DIR,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    })

    const result = JSON.parse(output)
    const address = result.deployedTo as Address
    const txHash = result.transactionHash

    // Get block number
    const receipt = await this.publicClient.getTransactionReceipt({
      hash: txHash,
    })
    const blockNumber = Number(receipt.blockNumber)

    console.log(`  ✅ ${name}: ${address}`)
    console.log(`     TX: ${txHash}`)

    return {
      name,
      address,
      txHash,
      blockNumber,
      deployedAt: new Date().toISOString(),
    }
  }

  private async configureJNS(
    registryAddress: Address,
    registrarAddress: Address,
  ): Promise<void> {
    // Set the .jeju TLD to be owned by the registrar
    // This requires calling setSubnodeOwner on the registry

    const JNS_REGISTRY_ABI = [
      {
        name: 'setSubnodeOwner',
        type: 'function',
        inputs: [
          { name: 'node', type: 'bytes32' },
          { name: 'label', type: 'bytes32' },
          { name: 'owner', type: 'address' },
        ],
        outputs: [{ name: '', type: 'bytes32' }],
        stateMutability: 'nonpayable',
      },
    ] as const

    // Root node is 0x0
    const ROOT_NODE =
      '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
    const JEJU_LABEL = this.labelHash('jeju')

    const hash = await this.walletClient.writeContract({
      address: registryAddress,
      abi: JNS_REGISTRY_ABI,
      functionName: 'setSubnodeOwner',
      args: [ROOT_NODE, JEJU_LABEL, registrarAddress],
    })

    await this.publicClient.waitForTransactionReceipt({ hash })
    console.log(`  ✅ .jeju TLD configured: ${hash}`)
  }

  private labelHash(label: string): Hex {
    return keccak256(toBytes(label))
  }

  private saveDeployment(): void {
    const deploymentPath = join(DEPLOYMENTS_DIR, 'deployment.json')
    writeFileSync(deploymentPath, JSON.stringify(this.result, null, 2))
    console.log(`Deployment saved to: ${deploymentPath}`)

    // Also create a simplified addresses file
    const addressesPath = join(DEPLOYMENTS_DIR, 'addresses.json')
    const addresses: Record<string, Address> = {}
    const contracts = this.result.contracts
    if (!contracts) throw new Error('Contracts not deployed')
    for (const [key, value] of Object.entries(contracts)) {
      addresses[key] = (value as ContractDeployment).address
    }
    writeFileSync(addressesPath, JSON.stringify(addresses, null, 2))
    console.log(`Addresses saved to: ${addressesPath}`)

    // Create environment file
    const envPath = join(ROOT_DIR, '.env.testnet')
    const envContent = `# Jeju Testnet Deployment
# Generated: ${this.result.timestamp}

# Network
NETWORK=testnet
TESTNET_RPC_URL=${this.rpcUrl}
CHAIN_ID=${baseSepolia.id}

# Core Registries
IDENTITY_REGISTRY_ADDRESS=${addresses.identityRegistry}
REPUTATION_REGISTRY_ADDRESS=${addresses.reputationRegistry}
VALIDATION_REGISTRY_ADDRESS=${addresses.validationRegistry}

# DWS Registries
REPO_REGISTRY_ADDRESS=${addresses.repoRegistry}
PACKAGE_REGISTRY_ADDRESS=${addresses.packageRegistry}
CONTAINER_REGISTRY_ADDRESS=${addresses.containerRegistry}
MODEL_REGISTRY_ADDRESS=${addresses.modelRegistry}

# JNS
JNS_REGISTRY_ADDRESS=${addresses.jnsRegistry}
JNS_REGISTRAR_ADDRESS=${addresses.jnsRegistrar}
JNS_RESOLVER_ADDRESS=${addresses.jnsResolver}

# Storage
STORAGE_MANAGER_ADDRESS=${addresses.storageManager}

# DWS Endpoints (to be set after deployment)
DWS_ENDPOINT=https://dws.testnet.jejunetwork.org
IPFS_GATEWAY=https://ipfs.testnet.jejunetwork.org
`
    writeFileSync(envPath, envContent)
    console.log(`Environment file saved to: ${envPath}`)
  }

  private printSummary(): void {
    console.log('')
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║                    DEPLOYMENT COMPLETE                               ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')

    const c = this.result.contracts
    if (!c) throw new Error('Contracts not deployed')

    console.log('📋 Core Registries:')
    console.log(`   IdentityRegistry:   ${c.identityRegistry.address}`)
    console.log(`   ReputationRegistry: ${c.reputationRegistry.address}`)
    console.log(`   ValidationRegistry: ${c.validationRegistry.address}`)
    console.log('')

    console.log('🗄️  DWS Registries:')
    console.log(`   RepoRegistry:       ${c.repoRegistry.address}`)
    console.log(`   PackageRegistry:    ${c.packageRegistry.address}`)
    console.log(`   ContainerRegistry:  ${c.containerRegistry.address}`)
    console.log(`   ModelRegistry:      ${c.modelRegistry.address}`)
    console.log('')

    console.log('🏷️  JNS (Jeju Name Service):')
    console.log(`   JNSRegistry:        ${c.jnsRegistry.address}`)
    console.log(`   JNSRegistrar:       ${c.jnsRegistrar.address}`)
    console.log(`   JNSResolver:        ${c.jnsResolver.address}`)
    console.log('')

    console.log('💾 Storage:')
    console.log(`   StorageManager:     ${c.storageManager.address}`)
    console.log('')

    console.log('📁 Files Created:')
    console.log(`   ${DEPLOYMENTS_DIR}/deployment.json`)
    console.log(`   ${DEPLOYMENTS_DIR}/addresses.json`)
    console.log(`   ${ROOT_DIR}/.env.testnet`)
    console.log('')

    console.log('🚀 Next Steps:')
    console.log('   1. Deploy DWS to Kubernetes:')
    console.log('      NETWORK=testnet bun run k8s:deploy')
    console.log('')
    console.log('   2. Run self-hosting bootstrap:')
    console.log('      bun run scripts/deploy/self-host-bootstrap.ts testnet')
    console.log('')
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const deployer = new DWSInfrastructureDeployer()
  await deployer.deploy()
}

main().catch((err) => {
  console.error('Deployment failed:', err)
  process.exit(1)
})

export { DWSInfrastructureDeployer, type DeploymentResult }
