/**
 * Deploy User Blocking System to Local Devnet (Anvil)
 *
 * Deploys:
 * - UserBlockRegistry (core blocking contract)
 *
 * Configures:
 * - Token, OTC, Marketplace, MessagingKeyRegistry, X402Facilitator,
 *   PlayerTradeEscrow, RoomRegistry, AuthCaptureEscrow
 *
 * Usage:
 *   bun scripts/deploy/blocking-localnet.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { ANVIL_KEYS } from '../../packages/config/test-keys'

// ============ Configuration ============

const RPC_URL = 'http://localhost:6545'
const CHAIN_ID = 31337

const CONTRACTS_DIR = join(import.meta.dir, '../../packages/contracts')
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, 'deployments')

interface BlockingDeployment {
  network: string
  chainId: number
  rpc: string
  deployedAt: string
  deployer: Address
  contracts: {
    identityRegistry: Address
    userBlockRegistry: Address
    token?: Address
    otc?: Address
    marketplace?: Address
    messagingKeyRegistry?: Address
    x402Facilitator?: Address
    playerTradeEscrow?: Address
    roomRegistry?: Address
    authCaptureEscrow?: Address
  }
}

// ============ Load compiled contracts ============

function loadContractBytecode(contractName: string): Hex {
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

function loadContractAbi(contractName: string): readonly object[] {
  const forgePath = join(
    CONTRACTS_DIR,
    `out/${contractName}.sol/${contractName}.json`,
  )
  if (existsSync(forgePath)) {
    const artifact = JSON.parse(readFileSync(forgePath, 'utf8'))
    return artifact.abi
  }
  throw new Error(
    `Contract ABI not found for ${contractName}. Run 'forge build' first.`,
  )
}

// ============ Main Deploy Function ============

async function deployBlocking() {
  console.log(
    '╔══════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║     USER BLOCKING SYSTEM - LOCAL DEVNET DEPLOYMENT               ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════════╝',
  )

  const account = privateKeyToAccount(ANVIL_KEYS.deployer.privateKey as Hex)
  console.log(`\nDeployer: ${account.address}`)
  console.log(`RPC: ${RPC_URL}`)

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  })

  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(RPC_URL),
  })

  // Check connection
  const blockNumber = await publicClient.getBlockNumber()
  console.log(`Block number: ${blockNumber}`)

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Balance: ${formatEther(balance)} ETH\n`)

  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true })
  }

  const deployment: BlockingDeployment = {
    network: 'localnet',
    chainId: CHAIN_ID,
    rpc: RPC_URL,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    contracts: {
      identityRegistry: '0x0000000000000000000000000000000000000000' as Address,
      userBlockRegistry:
        '0x0000000000000000000000000000000000000000' as Address,
    },
  }

  console.log('=== Deploying Core Contracts ===\n')

  // 1. Deploy IdentityRegistry
  console.log('Deploying IdentityRegistry...')
  const identityBytecode = loadContractBytecode('IdentityRegistry')
  const identityAbi = loadContractAbi('IdentityRegistry')

  const identityHash = await walletClient.deployContract({
    abi: identityAbi,
    bytecode: identityBytecode,
    args: [],
  })

  const identityReceipt = await publicClient.waitForTransactionReceipt({
    hash: identityHash,
  })
  deployment.contracts.identityRegistry =
    identityReceipt.contractAddress as Address
  console.log(`  IdentityRegistry: ${deployment.contracts.identityRegistry}\n`)

  // 2. Deploy UserBlockRegistry
  console.log('Deploying UserBlockRegistry...')
  const blockRegistryBytecode = loadContractBytecode('UserBlockRegistry')
  const blockRegistryAbi = loadContractAbi('UserBlockRegistry')

  const blockRegistryHash = await walletClient.deployContract({
    abi: blockRegistryAbi,
    bytecode: blockRegistryBytecode,
    args: [deployment.contracts.identityRegistry],
  })

  const blockRegistryReceipt = await publicClient.waitForTransactionReceipt({
    hash: blockRegistryHash,
  })
  deployment.contracts.userBlockRegistry =
    blockRegistryReceipt.contractAddress as Address
  console.log(
    `  UserBlockRegistry: ${deployment.contracts.userBlockRegistry}\n`,
  )

  // 3. Deploy Token
  console.log('Deploying Token...')
  const tokenBytecode = loadContractBytecode('Token')
  const tokenAbi = loadContractAbi('Token')

  const tokenConfig = {
    maxSupply: BigInt('1000000000000000000000000'), // 1M tokens
    maxWalletBps: 0,
    maxTxBps: 0,
    isHomeChain: true,
    banEnforcementEnabled: true,
    transfersPaused: false,
    faucetEnabled: false,
  }

  const tokenHash = await walletClient.deployContract({
    abi: tokenAbi,
    bytecode: tokenBytecode,
    args: [
      'TestToken',
      'TST',
      tokenConfig.maxSupply,
      account.address,
      tokenConfig,
    ],
  })

  const tokenReceipt = await publicClient.waitForTransactionReceipt({
    hash: tokenHash,
  })
  deployment.contracts.token = tokenReceipt.contractAddress as Address
  console.log(`  Token: ${deployment.contracts.token}\n`)

  // 4. Deploy PlayerTradeEscrow
  console.log('Deploying PlayerTradeEscrow...')
  const tradeEscrowBytecode = loadContractBytecode('PlayerTradeEscrow')
  const tradeEscrowAbi = loadContractAbi('PlayerTradeEscrow')

  const tradeEscrowHash = await walletClient.deployContract({
    abi: tradeEscrowAbi,
    bytecode: tradeEscrowBytecode,
    args: [account.address],
  })

  const tradeEscrowReceipt = await publicClient.waitForTransactionReceipt({
    hash: tradeEscrowHash,
  })
  deployment.contracts.playerTradeEscrow =
    tradeEscrowReceipt.contractAddress as Address
  console.log(
    `  PlayerTradeEscrow: ${deployment.contracts.playerTradeEscrow}\n`,
  )

  console.log('=== Configuring Block Registry Integrations ===\n')

  // Configure Token
  console.log('Configuring Token with BlockRegistry...')
  await walletClient.writeContract({
    address: deployment.contracts.token,
    abi: tokenAbi,
    functionName: 'setBlockRegistry',
    args: [deployment.contracts.userBlockRegistry],
  })
  console.log('  Token configured.\n')

  // Configure PlayerTradeEscrow
  console.log('Configuring PlayerTradeEscrow with BlockRegistry...')
  await walletClient.writeContract({
    address: deployment.contracts.playerTradeEscrow,
    abi: tradeEscrowAbi,
    functionName: 'setBlockRegistry',
    args: [deployment.contracts.userBlockRegistry],
  })
  console.log('  PlayerTradeEscrow configured.\n')

  // Save deployment
  const deploymentFile = join(DEPLOYMENTS_DIR, 'blocking-localnet.json')
  writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2))
  console.log(`Deployment saved to: ${deploymentFile}\n`)

  console.log('=== Deployment Complete ===\n')
  console.log('Contracts:')
  console.log(`  IdentityRegistry:   ${deployment.contracts.identityRegistry}`)
  console.log(`  UserBlockRegistry:  ${deployment.contracts.userBlockRegistry}`)
  console.log(`  Token:              ${deployment.contracts.token}`)
  console.log(`  PlayerTradeEscrow:  ${deployment.contracts.playerTradeEscrow}`)
  console.log('')

  return deployment
}

// Run
if (import.meta.main) {
  deployBlocking()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Deployment failed:', error)
      process.exit(1)
    })
}

export { deployBlocking }
