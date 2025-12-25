/**
 * Configure Superchain Interop for all OP Stack chains
 *
 * Pre-configures SuperchainOracle with all OP Stack L2s for native interop.
 * When Superchain native interop goes live, our OIF will be ready for
 * instant L2↔L2 messaging without third-party bridges.
 *
 * Usage:
 *   bun run scripts/deploy/configure-superchain-interop.ts --network mainnet
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, mode, optimism, zora } from 'viem/chains'

interface SuperchainL2 {
  name: string
  chainId: number
  rpcUrl: string
  chain: Chain
  superchainMember: boolean
}

// Define custom chains for newer Superchain members
const fraxtal = defineChain({
  id: 252,
  name: 'Fraxtal',
  nativeCurrency: { name: 'frxETH', symbol: 'frxETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.frax.com'] } },
})

const cyber = defineChain({
  id: 7560,
  name: 'Cyber',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://cyber.alt.technology'] } },
})

const mint = defineChain({
  id: 185,
  name: 'Mint',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mintchain.io'] } },
})

const redstone = defineChain({
  id: 690,
  name: 'Redstone',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.redstonechain.com'] } },
})

const lisk = defineChain({
  id: 1135,
  name: 'Lisk',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.api.lisk.com'] } },
})

const worldChain = defineChain({
  id: 480,
  name: 'World Chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://worldchain-mainnet.g.alchemy.com/public'] },
  },
})

const jeju = defineChain({
  id: 420691,
  name: 'Jeju',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.jejunetwork.org'] } },
})

// Current and upcoming Superchain members
const SUPERCHAIN_L2S: SuperchainL2[] = [
  {
    name: 'Optimism',
    chainId: 10,
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    chain: optimism,
    superchainMember: true,
  },
  {
    name: 'Base',
    chainId: 8453,
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    chain: base,
    superchainMember: true,
  },
  {
    name: 'Zora',
    chainId: 7777777,
    rpcUrl: process.env.ZORA_RPC_URL || 'https://rpc.zora.energy',
    chain: zora,
    superchainMember: true,
  },
  {
    name: 'Mode',
    chainId: 34443,
    rpcUrl: process.env.MODE_RPC_URL || 'https://mainnet.mode.network',
    chain: mode,
    superchainMember: true,
  },
  {
    name: 'Fraxtal',
    chainId: 252,
    rpcUrl: process.env.FRAXTAL_RPC_URL || 'https://rpc.frax.com',
    chain: fraxtal,
    superchainMember: true,
  },
  {
    name: 'Cyber',
    chainId: 7560,
    rpcUrl: process.env.CYBER_RPC_URL || 'https://cyber.alt.technology',
    chain: cyber,
    superchainMember: true,
  },
  {
    name: 'Mint',
    chainId: 185,
    rpcUrl: process.env.MINT_RPC_URL || 'https://rpc.mintchain.io',
    chain: mint,
    superchainMember: true,
  },
  {
    name: 'Redstone',
    chainId: 690,
    rpcUrl: process.env.REDSTONE_RPC_URL || 'https://rpc.redstonechain.com',
    chain: redstone,
    superchainMember: true,
  },
  {
    name: 'Lisk',
    chainId: 1135,
    rpcUrl: process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com',
    chain: lisk,
    superchainMember: true,
  },
  {
    name: 'World Chain',
    chainId: 480,
    rpcUrl:
      process.env.WORLDCHAIN_RPC_URL ||
      'https://worldchain-mainnet.g.alchemy.com/public',
    chain: worldChain,
    superchainMember: true,
  },
  {
    name: 'Jeju',
    chainId: 420691,
    rpcUrl: process.env.JEJU_RPC_URL || 'https://rpc.jejunetwork.org',
    chain: jeju,
    superchainMember: true,
  },
]
const SUPERCHAIN_ORACLE_ABI = [
  {
    type: 'function',
    name: 'setSourceChain',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'valid', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setTrustedOutputSettler',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'settler', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'validSourceChains',
    inputs: [{ name: 'chainId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'trustedOutputSettlers',
    inputs: [{ name: 'chainId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setRequireInboxVerification',
    inputs: [{ name: '_require', type: 'bool' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const
interface ChainDeployment {
  chainId: number
  superchainOracle: Address
  outputSettler: Address
}

// Load from deployment files
function loadDeployments(): Map<number, ChainDeployment> {
  const deployments = new Map<number, ChainDeployment>()

  // These would be loaded from actual deployment files
  // For now, using environment variables
  for (const l2 of SUPERCHAIN_L2S) {
    const oracleEnv = process.env[`SUPERCHAIN_ORACLE_${l2.chainId}`]
    const settlerEnv = process.env[`OUTPUT_SETTLER_${l2.chainId}`]

    if (oracleEnv && settlerEnv) {
      deployments.set(l2.chainId, {
        chainId: l2.chainId,
        superchainOracle: oracleEnv as Address,
        outputSettler: settlerEnv as Address,
      })
    }
  }

  return deployments
}
async function configureSuperchainInterop() {
  console.log('🔗 Configuring Superchain Interop...\n')

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY not set')
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)
  console.log(`   Deployer: ${account.address}\n`)

  const deployments = loadDeployments()

  if (deployments.size === 0) {
    console.log('⚠️  No deployments found. Set environment variables:')
    console.log('   SUPERCHAIN_ORACLE_{chainId}=0x...')
    console.log('   OUTPUT_SETTLER_{chainId}=0x...')
    console.log('\n   Or deploy contracts first with deploy-oif.ts\n')

    // Print what would be configured
    console.log('📋 Planned Superchain Configuration:\n')
    for (const l2 of SUPERCHAIN_L2S) {
      console.log(`   ${l2.name} (${l2.chainId}):`)
      console.log(`      - RPC: ${l2.rpcUrl}`)
      console.log(`      - Superchain Member: ${l2.superchainMember}`)
    }
    return
  }

  // Configure each chain's SuperchainOracle
  for (const [chainId, deployment] of deployments) {
    const l2Config = SUPERCHAIN_L2S.find((l) => l.chainId === chainId)
    if (!l2Config) continue

    console.log(`\n📡 Configuring ${l2Config.name} (${chainId})...`)

    const publicClient = createPublicClient({
      chain: l2Config.chain,
      transport: http(l2Config.rpcUrl),
    })

    const walletClient = createWalletClient({
      account,
      chain: l2Config.chain,
      transport: http(l2Config.rpcUrl),
    })

    // Configure other chains as valid sources
    for (const [otherChainId, otherDeployment] of deployments) {
      if (otherChainId === chainId) continue

      const otherL2 = SUPERCHAIN_L2S.find((l) => l.chainId === otherChainId)
      if (!otherL2?.superchainMember) continue

      // Check if already configured
      const isValid = await publicClient.readContract({
        address: deployment.superchainOracle,
        abi: SUPERCHAIN_ORACLE_ABI,
        functionName: 'validSourceChains',
        args: [BigInt(otherChainId)],
      })

      const trustedSettler = await publicClient.readContract({
        address: deployment.superchainOracle,
        abi: SUPERCHAIN_ORACLE_ABI,
        functionName: 'trustedOutputSettlers',
        args: [BigInt(otherChainId)],
      })

      if (isValid && trustedSettler === otherDeployment.outputSettler) {
        console.log(`   ✓ ${otherL2.name} already configured`)
        continue
      }

      // Set as valid source chain
      if (!isValid) {
        console.log(`   Setting ${otherL2.name} as valid source chain...`)
        const hash1 = await walletClient.writeContract({
          address: deployment.superchainOracle,
          abi: SUPERCHAIN_ORACLE_ABI,
          functionName: 'setSourceChain',
          args: [BigInt(otherChainId), true],
        })
        await publicClient.waitForTransactionReceipt({ hash: hash1 })
      }

      // Set trusted output settler
      if (trustedSettler !== otherDeployment.outputSettler) {
        console.log(`   Setting trusted OutputSettler for ${otherL2.name}...`)
        const hash2 = await walletClient.writeContract({
          address: deployment.superchainOracle,
          abi: SUPERCHAIN_ORACLE_ABI,
          functionName: 'setTrustedOutputSettler',
          args: [BigInt(otherChainId), otherDeployment.outputSettler],
        })
        await publicClient.waitForTransactionReceipt({ hash: hash2 })
      }

      console.log(`   ✓ ${otherL2.name} configured`)
    }
  }

  console.log('\n✅ Superchain interop configuration complete')
  console.log('\n📊 Configured chains:')
  for (const l2 of SUPERCHAIN_L2S) {
    const deployed = deployments.has(l2.chainId)
    console.log(`   ${deployed ? '✓' : '○'} ${l2.name} (${l2.chainId})`)
  }
}
function generateSuperchainConfig() {
  const config = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    superchainMembers: SUPERCHAIN_L2S.map((l2) => ({
      name: l2.name,
      chainId: l2.chainId,
      rpcUrl: l2.rpcUrl,
      superchainMember: l2.superchainMember,
      predeploys: {
        crossL2Inbox: '0x4200000000000000000000000000000000000022',
        l2ToL2Messenger: '0x4200000000000000000000000000000000000023',
      },
    })),
    interopSettings: {
      // Disable inbox verification until Superchain interop is live
      requireInboxVerification: false,
      // Enable for testing between our own chains
      allowTestnetInterop: true,
    },
  }

  return config
}
const args = process.argv.slice(2)
const command = args[0]

if (command === '--generate-config') {
  const config = generateSuperchainConfig()
  console.log(JSON.stringify(config, null, 2))
} else {
  configureSuperchainInterop().catch(console.error)
}

export { SUPERCHAIN_L2S, configureSuperchainInterop, generateSuperchainConfig }
