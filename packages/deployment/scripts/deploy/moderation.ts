/**
 * Deploy Moderation System to Testnet
 *
 * Deploys:
 * - BanManager
 * - ModerationMarketplace
 * - EvidenceRegistry
 * - ReportingSystem
 * - ReputationLabelManager
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

// ============ Configuration ============

const CONTRACTS_DIR = join(import.meta.dir, '../../packages/contracts')
const DEPLOYMENT_FILE = join(
  CONTRACTS_DIR,
  'deployments/testnet/deployment.json',
)

interface DeploymentConfig {
  network: string
  chainId: number
  deployer: Address | null
  moderation: {
    banManager: Address | null
    moderationMarketplace: Address | null
    evidenceRegistry: Address | null
    reportingSystem: Address | null
    reputationLabelManager: Address | null
  }
  registry?: {
    identityRegistry: Address | null
  }
  infrastructure?: {
    priceOracle: Address | null
  }
}

// ============ Contract ABIs (deploy functions) ============

const DEPLOY_ABIS = {
  BanManager: [
    {
      type: 'constructor',
      inputs: [
        { name: '_governance', type: 'address' },
        { name: 'initialOwner', type: 'address' },
      ],
    },
  ],
  ModerationMarketplace: [
    {
      type: 'constructor',
      inputs: [
        { name: '_banManager', type: 'address' },
        { name: '_stakingToken', type: 'address' },
        { name: '_treasury', type: 'address' },
        { name: '_owner', type: 'address' },
      ],
    },
  ],
  EvidenceRegistry: [
    {
      type: 'constructor',
      inputs: [
        { name: '_marketplace', type: 'address' },
        { name: '_repProvider', type: 'address' },
        { name: '_treasury', type: 'address' },
        { name: '_owner', type: 'address' },
      ],
    },
  ],
  ReportingSystem: [
    {
      type: 'constructor',
      inputs: [
        { name: '_banManager', type: 'address' },
        { name: '_labelManager', type: 'address' },
        { name: '_predimarket', type: 'address' },
        { name: '_identityRegistry', type: 'address' },
        { name: '_owner', type: 'address' },
      ],
    },
  ],
  ReputationLabelManager: [
    {
      type: 'constructor',
      inputs: [
        { name: '_banManager', type: 'address' },
        { name: '_identityRegistry', type: 'address' },
        { name: '_predimarket', type: 'address' },
        { name: '_owner', type: 'address' },
      ],
    },
  ],
} as const

// ============ Load compiled contracts ============

function loadContractBytecode(contractName: string): Hex {
  // Try forge out directory first
  const forgePath = join(
    CONTRACTS_DIR,
    `out/${contractName}.sol/${contractName}.json`,
  )
  if (existsSync(forgePath)) {
    const artifact = JSON.parse(readFileSync(forgePath, 'utf8'))
    return artifact.bytecode.object as Hex
  }

  throw new Error(
    `Contract bytecode not found for ${contractName}. Run 'forge build' first.`,
  )
}

// ============ Main Deploy Function ============

async function deployModeration() {
  console.log('🚀 Deploying Moderation System to Testnet...\n')

  // Load private key
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY not set')
  }

  const account = privateKeyToAccount(privateKey as Hex)
  console.log(`📍 Deployer: ${account.address}`)

  // Setup clients
  const rpcUrl = process.env.TESTNET_RPC_URL || 'https://sepolia.base.org'
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  })

  // Load existing deployment
  let deployment: DeploymentConfig
  if (existsSync(DEPLOYMENT_FILE)) {
    deployment = JSON.parse(readFileSync(DEPLOYMENT_FILE, 'utf8'))
  } else {
    deployment = {
      network: 'testnet',
      chainId: 84532,
      deployer: null,
      moderation: {
        banManager: null,
        moderationMarketplace: null,
        evidenceRegistry: null,
        reportingSystem: null,
        reputationLabelManager: null,
      },
    }
  }

  deployment.deployer = account.address

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`💰 Balance: ${Number(balance) / 1e18} ETH\n`)

  if (balance < parseEther('0.1')) {
    throw new Error(
      'Insufficient balance. Need at least 0.1 ETH for deployment.',
    )
  }

  // Treasury address (deployer for now)
  const treasury = account.address
  const governance = account.address

  // Get dependencies
  const identityRegistry =
    deployment.registry?.identityRegistry || account.address
  const predimarket = account.address // Placeholder - needs actual Predimarket address

  // Deploy BanManager
  if (!deployment.moderation.banManager) {
    console.log('📦 Deploying BanManager...')
    const bytecode = loadContractBytecode('BanManager')

    const hash = await walletClient.deployContract({
      abi: DEPLOY_ABIS.BanManager,
      bytecode,
      args: [governance, account.address],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    deployment.moderation.banManager = receipt.contractAddress as Address
    console.log(`   ✅ BanManager: ${deployment.moderation.banManager}\n`)
  } else {
    console.log(
      `   ⏭️  BanManager already deployed: ${deployment.moderation.banManager}\n`,
    )
  }

  // Deploy ReputationLabelManager (needs BanManager)
  if (!deployment.moderation.reputationLabelManager) {
    console.log('📦 Deploying ReputationLabelManager...')
    const bytecode = loadContractBytecode('ReputationLabelManager')

    const hash = await walletClient.deployContract({
      abi: DEPLOY_ABIS.ReputationLabelManager,
      bytecode,
      args: [
        deployment.moderation.banManager,
        identityRegistry,
        predimarket,
        account.address,
      ],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    deployment.moderation.reputationLabelManager =
      receipt.contractAddress as Address
    console.log(
      `   ✅ ReputationLabelManager: ${deployment.moderation.reputationLabelManager}\n`,
    )
  } else {
    console.log(
      `   ⏭️  ReputationLabelManager already deployed: ${deployment.moderation.reputationLabelManager}\n`,
    )
  }

  // Deploy ModerationMarketplace (needs BanManager)
  if (!deployment.moderation.moderationMarketplace) {
    console.log('📦 Deploying ModerationMarketplace...')
    const bytecode = loadContractBytecode('ModerationMarketplace')

    // address(0) for stakingToken = ETH staking
    const stakingToken = '0x0000000000000000000000000000000000000000'

    const hash = await walletClient.deployContract({
      abi: DEPLOY_ABIS.ModerationMarketplace,
      bytecode,
      args: [
        deployment.moderation.banManager,
        stakingToken,
        treasury,
        account.address,
      ],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    deployment.moderation.moderationMarketplace =
      receipt.contractAddress as Address
    console.log(
      `   ✅ ModerationMarketplace: ${deployment.moderation.moderationMarketplace}\n`,
    )
  } else {
    console.log(
      `   ⏭️  ModerationMarketplace already deployed: ${deployment.moderation.moderationMarketplace}\n`,
    )
  }

  // Deploy EvidenceRegistry (needs ModerationMarketplace)
  if (!deployment.moderation.evidenceRegistry) {
    console.log('📦 Deploying EvidenceRegistry...')
    const bytecode = loadContractBytecode('EvidenceRegistry')

    // No reputation provider initially
    const repProvider = '0x0000000000000000000000000000000000000000'

    const hash = await walletClient.deployContract({
      abi: DEPLOY_ABIS.EvidenceRegistry,
      bytecode,
      args: [
        deployment.moderation.moderationMarketplace,
        repProvider,
        treasury,
        account.address,
      ],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    deployment.moderation.evidenceRegistry = receipt.contractAddress as Address
    console.log(
      `   ✅ EvidenceRegistry: ${deployment.moderation.evidenceRegistry}\n`,
    )
  } else {
    console.log(
      `   ⏭️  EvidenceRegistry already deployed: ${deployment.moderation.evidenceRegistry}\n`,
    )
  }

  // Deploy ReportingSystem (needs BanManager, LabelManager, Predimarket, IdentityRegistry)
  if (!deployment.moderation.reportingSystem) {
    console.log('📦 Deploying ReportingSystem...')
    const bytecode = loadContractBytecode('ReportingSystem')

    const hash = await walletClient.deployContract({
      abi: DEPLOY_ABIS.ReportingSystem,
      bytecode,
      args: [
        deployment.moderation.banManager,
        deployment.moderation.reputationLabelManager,
        predimarket,
        identityRegistry,
        account.address,
      ],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    deployment.moderation.reportingSystem = receipt.contractAddress as Address
    console.log(
      `   ✅ ReportingSystem: ${deployment.moderation.reportingSystem}\n`,
    )
  } else {
    console.log(
      `   ⏭️  ReportingSystem already deployed: ${deployment.moderation.reportingSystem}\n`,
    )
  }

  // Save deployment
  writeFileSync(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2))
  console.log(`\n📝 Deployment saved to ${DEPLOYMENT_FILE}`)

  // Configure contracts
  console.log('\n⚙️  Configuring contracts...\n')

  // Set ModerationMarketplace as authorized moderator on BanManager
  console.log('   Setting ModerationMarketplace as moderator on BanManager...')
  const setModeratorAbi = [
    {
      name: 'setModerator',
      type: 'function',
      inputs: [
        { name: 'moderator', type: 'address' },
        { name: 'authorized', type: 'bool' },
      ],
      outputs: [],
    },
  ] as const

  await walletClient.writeContract({
    address: deployment.moderation.banManager as Address,
    abi: setModeratorAbi,
    functionName: 'setModerator',
    args: [deployment.moderation.moderationMarketplace as Address, true],
  })
  console.log('   ✅ ModerationMarketplace authorized\n')

  // Set ReputationLabelManager as moderator on BanManager
  console.log('   Setting ReputationLabelManager as moderator on BanManager...')
  await walletClient.writeContract({
    address: deployment.moderation.banManager as Address,
    abi: setModeratorAbi,
    functionName: 'setModerator',
    args: [deployment.moderation.reputationLabelManager as Address, true],
  })
  console.log('   ✅ ReputationLabelManager authorized\n')

  console.log('✅ Moderation system deployment complete.\n')
  console.log('Deployed contracts:')
  console.log(`  BanManager: ${deployment.moderation.banManager}`)
  console.log(
    `  ModerationMarketplace: ${deployment.moderation.moderationMarketplace}`,
  )
  console.log(`  EvidenceRegistry: ${deployment.moderation.evidenceRegistry}`)
  console.log(`  ReportingSystem: ${deployment.moderation.reportingSystem}`)
  console.log(
    `  ReputationLabelManager: ${deployment.moderation.reputationLabelManager}`,
  )

  return deployment
}

// Run if called directly
if (import.meta.main) {
  deployModeration()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Deployment failed:', error)
      process.exit(1)
    })
}

export { deployModeration }
