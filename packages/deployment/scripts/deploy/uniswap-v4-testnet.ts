#!/usr/bin/env bun
/**
 * Deploy Uniswap V4 to Jeju Testnet (chain 420690)
 *
 * This script deploys:
 * - PoolManager (core Uniswap V4 contract)
 * - WETH9 (Wrapped ETH)
 *
 * The PoolManager is the singleton that manages all V4 pools.
 *
 * Usage:
 *   PRIVATE_KEY=0x... bun run scripts/deploy/uniswap-v4-testnet.ts
 *
 * Or via Forge:
 *   PRIVATE_KEY=0x... forge script script/DeployUniswapV4Core.s.sol:DeployUniswapV4Core \
 *     --rpc-url jeju_testnet --broadcast --legacy
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Chain,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  formatEther,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const TESTNET_RPC = 'https://testnet-rpc.jejunetwork.org'
const TESTNET_CHAIN_ID = 420690

const jejuTestnet: Chain = {
  id: TESTNET_CHAIN_ID,
  name: 'Jeju Testnet',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [TESTNET_RPC] },
  },
}
const CONTRACTS_DIR = join(import.meta.dir, '../../../../packages/contracts')
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, 'deployments')

interface UniswapV4Deployment {
  poolManager: string
  weth: string
  stateView?: string
  quoterV4?: string
  swapRouter?: string
  positionManager?: string
  chainId: number
  deployer: string
  timestamp: number
  network: string
}

function getPrivateKey(): `0x${string}` {
  const key = process.env.PRIVATE_KEY
  if (!key) {
    throw new Error('PRIVATE_KEY environment variable is required')
  }
  if (!key.startsWith('0x')) {
    return `0x${key}` as `0x${string}`
  }
  return key as `0x${string}`
}

function loadArtifact(name: string): {
  abi: object[]
  bytecode: `0x${string}`
} {
  const artifactPath = join(CONTRACTS_DIR, 'out', `${name}.sol`, `${name}.json`)
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Artifact not found: ${artifactPath}. Run 'forge build' first.`,
    )
  }
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'))
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as `0x${string}`,
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('Deploying Uniswap V4 to Jeju Testnet')
  console.log('='.repeat(60))
  console.log('')

  const privateKey = getPrivateKey()
  const account = privateKeyToAccount(privateKey)

  const publicClient = createPublicClient({
    chain: jejuTestnet,
    transport: http(TESTNET_RPC),
  })

  const walletClient = createWalletClient({
    account,
    chain: jejuTestnet,
    transport: http(TESTNET_RPC),
  })

  const chainId = await publicClient.getChainId()
  if (chainId !== TESTNET_CHAIN_ID) {
    throw new Error(`Expected chain ${TESTNET_CHAIN_ID}, got ${chainId}`)
  }

  console.log('Chain ID:', chainId)
  console.log('Deployer:', account.address)

  const balance = await publicClient.getBalance({ address: account.address })
  console.log('Balance:', formatEther(balance), 'ETH')

  if (balance < parseEther('0.1')) {
    throw new Error(
      'Insufficient balance. Need at least 0.1 ETH for deployment.',
    )
  }

  console.log('')
  console.log('Building contracts...')

  // Build first
  const { execSync } = await import('node:child_process')
  execSync('forge build', { cwd: CONTRACTS_DIR, stdio: 'inherit' })

  // Load artifacts
  console.log('Loading artifacts...')
  const poolManagerArtifact = loadArtifact('PoolManager')
  const weth9Artifact = loadArtifact('WETH9')

  // 1. Deploy WETH9
  console.log('')
  console.log('1. Deploying WETH9...')

  const wethData = encodeDeployData({
    abi: weth9Artifact.abi,
    bytecode: weth9Artifact.bytecode,
    args: [],
  })

  const wethHash = await walletClient.sendTransaction({
    chain: jejuTestnet,
    data: wethData,
  })

  console.log('   TX:', wethHash)
  const wethReceipt = await publicClient.waitForTransactionReceipt({
    hash: wethHash,
  })
  const wethAddress = wethReceipt.contractAddress

  if (!wethAddress) {
    throw new Error('WETH9 deployment failed')
  }

  console.log('   WETH9:', wethAddress)

  // 2. Deploy PoolManager
  console.log('')
  console.log('2. Deploying PoolManager...')

  const poolManagerData = encodeDeployData({
    abi: poolManagerArtifact.abi,
    bytecode: poolManagerArtifact.bytecode,
    args: [account.address], // owner
  })

  const poolManagerHash = await walletClient.sendTransaction({
    chain: jejuTestnet,
    data: poolManagerData,
  })

  console.log('   TX:', poolManagerHash)
  const poolManagerReceipt = await publicClient.waitForTransactionReceipt({
    hash: poolManagerHash,
  })
  const poolManagerAddress = poolManagerReceipt.contractAddress

  if (!poolManagerAddress) {
    throw new Error('PoolManager deployment failed')
  }

  console.log('   PoolManager:', poolManagerAddress)

  // Save deployment
  const deployment: UniswapV4Deployment = {
    poolManager: poolManagerAddress,
    weth: wethAddress,
    chainId,
    deployer: account.address,
    timestamp: Date.now(),
    network: 'testnet',
  }

  const deploymentPath = join(DEPLOYMENTS_DIR, `uniswap-v4-${chainId}.json`)
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2))

  console.log('')
  console.log('='.repeat(60))
  console.log('DEPLOYMENT COMPLETE')
  console.log('='.repeat(60))
  console.log('PoolManager:', poolManagerAddress)
  console.log('WETH:', wethAddress)
  console.log('')
  console.log('Saved to:', deploymentPath)
}

main().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
