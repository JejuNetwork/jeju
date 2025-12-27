/**
 * Setup Token Moderation Integration
 *
 * Connects JejuToken to BanManager for transfer blocking
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const CONTRACTS_DIR = join(import.meta.dir, '../../packages/contracts')
const DEPLOYMENT_FILE = join(
  CONTRACTS_DIR,
  'deployments/testnet/deployment.json',
)

interface Deployment {
  moderation: {
    banManager: Address
  }
  tokens?: {
    jeju: Address
  }
}

const TOKEN_ABI = [
  {
    name: 'setBanManager',
    type: 'function',
    inputs: [{ name: '_banManager', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setConfig',
    type: 'function',
    inputs: [
      { name: 'maxWalletBps_', type: 'uint256' },
      { name: 'maxTxBps_', type: 'uint256' },
      { name: 'banEnabled_', type: 'bool' },
      { name: 'paused_', type: 'bool' },
      { name: 'faucetEnabled_', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'banManager',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'config',
    type: 'function',
    inputs: [],
    outputs: [
      { name: 'maxSupply', type: 'uint256' },
      { name: 'maxWalletBps', type: 'uint256' },
      { name: 'maxTxBps', type: 'uint256' },
      { name: 'isHomeChain', type: 'bool' },
      { name: 'banEnforcementEnabled', type: 'bool' },
      { name: 'transfersPaused', type: 'bool' },
      { name: 'faucetEnabled', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const

async function setupTokenModeration() {
  console.log('🔗 Setting up Token-Moderation Integration...\n')

  // Load private key
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY not set')
  }

  const account = privateKeyToAccount(privateKey as Hex)
  console.log(`📍 Account: ${account.address}`)

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

  // Load deployment
  if (!existsSync(DEPLOYMENT_FILE)) {
    throw new Error(
      'Deployment file not found. Run deploy-moderation.ts first.',
    )
  }

  const deployment: Deployment = JSON.parse(
    readFileSync(DEPLOYMENT_FILE, 'utf8'),
  )

  if (!deployment.moderation.banManager) {
    throw new Error('BanManager not deployed. Run deploy-moderation.ts first.')
  }

  console.log(`\n📋 BanManager: ${deployment.moderation.banManager}`)

  // Get token address
  const tokenAddress = deployment.tokens?.jeju || process.env.JEJU_TOKEN_ADDRESS
  if (!tokenAddress) {
    throw new Error(
      'JEJU token address not found. Set JEJU_TOKEN_ADDRESS or add to deployment.',
    )
  }

  console.log(`📋 JEJU Token: ${tokenAddress}`)

  // Check current config
  console.log('\n📊 Checking current token config...')

  const currentBanManager = await publicClient.readContract({
    address: tokenAddress as Address,
    abi: TOKEN_ABI,
    functionName: 'banManager',
  })

  const config = await publicClient.readContract({
    address: tokenAddress as Address,
    abi: TOKEN_ABI,
    functionName: 'config',
  })

  console.log(`   Current BanManager: ${currentBanManager}`)
  console.log(`   Ban Enforcement Enabled: ${config[4]}`)

  // Set BanManager if not already set
  if (currentBanManager !== deployment.moderation.banManager) {
    console.log('\n⚙️  Setting BanManager on Token...')

    const hash = await walletClient.writeContract({
      address: tokenAddress as Address,
      abi: TOKEN_ABI,
      functionName: 'setBanManager',
      args: [deployment.moderation.banManager],
    })

    console.log(`   Transaction: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
    console.log('   ✅ BanManager set')
  } else {
    console.log('   ⏭️  BanManager already set correctly')
  }

  // Enable ban enforcement if not enabled
  if (!config[4]) {
    // banEnforcementEnabled
    console.log('\n⚙️  Enabling ban enforcement on Token...')

    const hash = await walletClient.writeContract({
      address: tokenAddress as Address,
      abi: TOKEN_ABI,
      functionName: 'setConfig',
      args: [
        config[1], // maxWalletBps - keep current
        config[2], // maxTxBps - keep current
        true, // banEnabled - enable
        config[5], // transfersPaused - keep current
        config[6], // faucetEnabled - keep current
      ],
    })

    console.log(`   Transaction: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
    console.log('   ✅ Ban enforcement enabled')
  } else {
    console.log('   ⏭️  Ban enforcement already enabled')
  }

  // Verify setup
  console.log('\n🔍 Verifying setup...')

  const newBanManager = await publicClient.readContract({
    address: tokenAddress as Address,
    abi: TOKEN_ABI,
    functionName: 'banManager',
  })

  const newConfig = await publicClient.readContract({
    address: tokenAddress as Address,
    abi: TOKEN_ABI,
    functionName: 'config',
  })

  console.log(`   BanManager: ${newBanManager}`)
  console.log(`   Ban Enforcement: ${newConfig[4]}`)

  if (newBanManager === deployment.moderation.banManager && newConfig[4]) {
    console.log('\n✅ Token-Moderation integration complete.')
    console.log('   Banned addresses will now be blocked from JEJU transfers.')
  } else {
    throw new Error('Setup verification failed')
  }
}

if (import.meta.main) {
  setupTokenModeration()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Setup failed:', error)
      process.exit(1)
    })
}

export { setupTokenModeration }
