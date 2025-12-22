/**
 * OAuth3 Contract Deployment Script
 *
 * Deploys the complete OAuth3 infrastructure:
 * - OAuth3TEEVerifier
 * - OAuth3IdentityRegistry
 * - OAuth3AppRegistry
 * - AccountFactory
 *
 * Also registers default OAuth3 apps for Jeju, Babylon, and Eliza councils.
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const ENTRYPOINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address

interface OAuth3Deployment {
  teeVerifier: Address
  identityRegistry: Address
  appRegistry: Address
  accountFactory: Address
  chainId: number
  deployer: Address
  timestamp: number
}

interface CouncilAppConfig {
  name: string
  description: string
  council: Address
  redirectUris: string[]
}

const DEFAULT_COUNCILS: Record<string, CouncilAppConfig> = {
  jeju: {
    name: 'Jeju Network',
    description: 'Official OAuth3 app for Jeju Network governance',
    council: '0x0000000000000000000000000000000000000000' as Address,
    redirectUris: [
      'https://jejunetwork.org/auth/callback',
      'https://council.jejunetwork.org/auth/callback',
      'http://localhost:3000/auth/callback',
    ],
  },
  babylon: {
    name: 'Babylon Game',
    description: 'Official OAuth3 app for Babylon game platform',
    council: '0x0000000000000000000000000000000000000000' as Address,
    redirectUris: [
      'https://babylon.jejunetwork.org/auth/callback',
      'https://play.babylon.jejunetwork.org/auth/callback',
      'http://localhost:3001/auth/callback',
    ],
  },
  eliza: {
    name: 'ElizaOS',
    description: 'Official OAuth3 app for ElizaOS AI agent framework',
    council: '0x0000000000000000000000000000000000000000' as Address,
    redirectUris: [
      'https://eliza.jejunetwork.org/auth/callback',
      'https://agents.eliza.jejunetwork.org/auth/callback',
      'http://localhost:3002/auth/callback',
    ],
  },
}

async function deployOAuth3(): Promise<OAuth3Deployment> {
  const rpcUrl = process.env.RPC_URL ?? 'http://localhost:6546'
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY

  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY environment variable required')
  }

  const account = privateKeyToAccount(privateKey as Hex)

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  })

  const chainId = await publicClient.getChainId()

  console.log(`
╔════════════════════════════════════════════════════════════╗
║                OAuth3 Infrastructure Deployment             ║
╠════════════════════════════════════════════════════════════╣
║  Chain ID:    ${String(chainId).padEnd(42)}║
║  RPC URL:     ${rpcUrl.slice(0, 42).padEnd(42)}║
║  Deployer:    ${account.address.padEnd(42)}║
╚════════════════════════════════════════════════════════════╝
`)

  console.log('Deploying OAuth3TEEVerifier...')
  const teeVerifierTx = await walletClient.deployContract({
    abi: OAuth3TEEVerifierABI,
    bytecode: OAuth3TEEVerifierBytecode,
    args: ['0x0000000000000000000000000000000000000000'],
  })

  const teeVerifierReceipt = await publicClient.waitForTransactionReceipt({
    hash: teeVerifierTx,
  })
  const teeVerifier = teeVerifierReceipt.contractAddress
  if (!teeVerifier)
    throw new Error('Failed to get TEE verifier contract address')
  console.log(`  ✓ OAuth3TEEVerifier deployed at: ${teeVerifier}`)

  console.log('Deploying AccountFactory...')
  const accountFactoryTx = await walletClient.deployContract({
    abi: AccountFactoryABI,
    bytecode: AccountFactoryBytecode,
    args: [
      ENTRYPOINT_V07,
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
    ],
  })

  const accountFactoryReceipt = await publicClient.waitForTransactionReceipt({
    hash: accountFactoryTx,
  })
  const accountFactory = accountFactoryReceipt.contractAddress
  if (!accountFactory)
    throw new Error('Failed to get account factory contract address')
  console.log(`  ✓ AccountFactory deployed at: ${accountFactory}`)

  console.log('Deploying OAuth3IdentityRegistry...')
  const identityRegistryTx = await walletClient.deployContract({
    abi: OAuth3IdentityRegistryABI,
    bytecode: OAuth3IdentityRegistryBytecode,
    args: [teeVerifier, accountFactory],
  })

  const identityRegistryReceipt = await publicClient.waitForTransactionReceipt({
    hash: identityRegistryTx,
  })
  const identityRegistry = identityRegistryReceipt.contractAddress
  if (!identityRegistry)
    throw new Error('Failed to get identity registry contract address')
  console.log(`  ✓ OAuth3IdentityRegistry deployed at: ${identityRegistry}`)

  console.log('Deploying OAuth3AppRegistry...')
  const appRegistryTx = await walletClient.deployContract({
    abi: OAuth3AppRegistryABI,
    bytecode: OAuth3AppRegistryBytecode,
    args: [identityRegistry, teeVerifier],
  })

  const appRegistryReceipt = await publicClient.waitForTransactionReceipt({
    hash: appRegistryTx,
  })
  const appRegistry = appRegistryReceipt.contractAddress
  if (!appRegistry)
    throw new Error('Failed to get app registry contract address')
  console.log(`  ✓ OAuth3AppRegistry deployed at: ${appRegistry}`)

  console.log('\nUpdating TEE Verifier identity registry...')
  await walletClient.writeContract({
    address: teeVerifier,
    abi: OAuth3TEEVerifierABI,
    functionName: 'setIdentityRegistry',
    args: [identityRegistry],
  })
  console.log('  ✓ TEE Verifier updated')

  console.log('\nRegistering default council OAuth3 apps...')
  for (const [councilName, config] of Object.entries(DEFAULT_COUNCILS)) {
    const tx = await walletClient.writeContract({
      address: appRegistry,
      abi: OAuth3AppRegistryABI,
      functionName: 'registerApp',
      args: [
        config.name,
        config.description,
        config.council,
        {
          redirectUris: config.redirectUris,
          allowedProviders: [0, 1, 2, 3, 4, 5, 6],
          requireTEEAttestation: true,
          sessionDuration: BigInt(86400),
          maxSessionsPerUser: 10,
        },
      ],
    })

    await publicClient.waitForTransactionReceipt({ hash: tx })
    console.log(`  ✓ ${councilName} app registered`)
  }

  const deployment: OAuth3Deployment = {
    teeVerifier,
    identityRegistry,
    appRegistry,
    accountFactory,
    chainId,
    deployer: account.address,
    timestamp: Date.now(),
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║              OAuth3 Deployment Complete                     ║
╠════════════════════════════════════════════════════════════╣
║  TEE Verifier:      ${teeVerifier.padEnd(38)}║
║  Identity Registry: ${identityRegistry.padEnd(38)}║
║  App Registry:      ${appRegistry.padEnd(38)}║
║  Account Factory:   ${accountFactory.padEnd(38)}║
╚════════════════════════════════════════════════════════════╝
`)

  const deploymentPath = `./deployments/oauth3-${chainId}-${Date.now()}.json`
  await Bun.write(deploymentPath, JSON.stringify(deployment, null, 2))
  console.log(`Deployment saved to: ${deploymentPath}`)

  return deployment
}

const OAuth3TEEVerifierABI = [
  {
    type: 'constructor',
    inputs: [{ name: '_identityRegistry', type: 'address' }],
  },
  {
    type: 'function',
    name: 'setIdentityRegistry',
    inputs: [{ name: '_identityRegistry', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const OAuth3IdentityRegistryABI = [
  {
    type: 'constructor',
    inputs: [
      { name: '_teeVerifier', type: 'address' },
      { name: '_accountFactory', type: 'address' },
    ],
  },
] as const

const OAuth3AppRegistryABI = [
  {
    type: 'constructor',
    inputs: [
      { name: '_identityRegistry', type: 'address' },
      { name: '_teeVerifier', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'registerApp',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'council', type: 'address' },
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'redirectUris', type: 'string[]' },
          { name: 'allowedProviders', type: 'uint8[]' },
          { name: 'requireTEEAttestation', type: 'bool' },
          { name: 'sessionDuration', type: 'uint256' },
          { name: 'maxSessionsPerUser', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'appId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
] as const

const AccountFactoryABI = [
  {
    type: 'constructor',
    inputs: [
      { name: '_entryPoint', type: 'address' },
      { name: '_identityRegistry', type: 'address' },
      { name: '_defaultValidator', type: 'address' },
    ],
  },
] as const

const OAuth3TEEVerifierBytecode = '0x' as Hex
const OAuth3IdentityRegistryBytecode = '0x' as Hex
const OAuth3AppRegistryBytecode = '0x' as Hex
const AccountFactoryBytecode = '0x' as Hex

if (import.meta.main) {
  deployOAuth3().catch(console.error)
}

export { deployOAuth3, type OAuth3Deployment }
