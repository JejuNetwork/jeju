#!/usr/bin/env bun
/**
 * Deploy Git Registry Contracts
 * Deploys RepoRegistry to localnet/testnet/mainnet
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry } from 'viem/chains'

// Contract compilation - we'll use forge for this
async function compileContract(): Promise<{
  abi: readonly object[]
  bytecode: Hex
}> {
  const proc = Bun.spawn(['forge', 'build', '--root', 'packages/contracts'], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  })

  await proc.exited

  // Read compiled artifact
  const artifactPath =
    'packages/contracts/out/RepoRegistry.sol/RepoRegistry.json'
  const artifact = await Bun.file(artifactPath).json()

  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
  }
}

interface DeployConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  rpcUrl: string
  privateKey: Hex
  identityRegistryAddress?: Address
}

async function deployRepoRegistry(config: DeployConfig): Promise<Address> {
  console.log(`[Deploy] Deploying RepoRegistry to ${config.network}...`)

  const chain =
    config.network === 'localnet'
      ? { ...foundry, rpcUrls: { default: { http: [config.rpcUrl] } } }
      : config.network === 'testnet'
        ? baseSepolia
        : base

  const account = privateKeyToAccount(config.privateKey)

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  })

  console.log(`[Deploy] Deployer address: ${account.address}`)

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`[Deploy] Deployer balance: ${balance / 10n ** 18n} ETH`)

  if (balance < 10n ** 16n) {
    throw new Error(
      'Insufficient balance for deployment (need at least 0.01 ETH)',
    )
  }

  // Compile contract
  console.log('[Deploy] Compiling contracts...')
  const { abi, bytecode } = await compileContract()

  // Deploy
  console.log('[Deploy] Deploying RepoRegistry...')

  const identityRegistry =
    config.identityRegistryAddress ||
    '0x0000000000000000000000000000000000000000'

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [account.address, identityRegistry],
  })

  console.log(`[Deploy] Transaction hash: ${hash}`)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  if (!receipt.contractAddress) {
    throw new Error(
      'Contract deployment failed - no contract address in receipt',
    )
  }

  console.log(`[Deploy] RepoRegistry deployed at: ${receipt.contractAddress}`)
  console.log(`[Deploy] Gas used: ${receipt.gasUsed}`)

  // Verify the deployment
  const code = await publicClient.getCode({ address: receipt.contractAddress })
  if (!code || code === '0x') {
    throw new Error('Contract deployment failed - no code at address')
  }

  console.log('[Deploy] Contract verified.')

  return receipt.contractAddress
}

async function main() {
  const network = (process.argv[2] || 'localnet') as DeployConfig['network']

  let config: DeployConfig

  switch (network) {
    case 'localnet':
      config = {
        network: 'localnet',
        rpcUrl: process.env.RPC_URL || 'http://localhost:9545',
        privateKey: (process.env.DEPLOYER_PRIVATE_KEY ||
          '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex,
        identityRegistryAddress: process.env
          .IDENTITY_REGISTRY_ADDRESS as Address,
      }
      break

    case 'testnet':
      if (!process.env.DEPLOYER_PRIVATE_KEY) {
        throw new Error('DEPLOYER_PRIVATE_KEY required for testnet deployment')
      }
      config = {
        network: 'testnet',
        rpcUrl: process.env.TESTNET_RPC_URL || 'https://sepolia.base.org',
        privateKey: process.env.DEPLOYER_PRIVATE_KEY as Hex,
        identityRegistryAddress: process.env
          .IDENTITY_REGISTRY_ADDRESS as Address,
      }
      break

    case 'mainnet':
      if (!process.env.DEPLOYER_PRIVATE_KEY) {
        throw new Error('DEPLOYER_PRIVATE_KEY required for mainnet deployment')
      }
      config = {
        network: 'mainnet',
        rpcUrl: process.env.MAINNET_RPC_URL || 'https://mainnet.base.org',
        privateKey: process.env.DEPLOYER_PRIVATE_KEY as Hex,
        identityRegistryAddress: process.env
          .IDENTITY_REGISTRY_ADDRESS as Address,
      }
      break

    default:
      throw new Error(`Unknown network: ${network}`)
  }

  const contractAddress = await deployRepoRegistry(config)

  // Save deployment info
  const deployment = {
    network,
    contractAddress,
    deployedAt: new Date().toISOString(),
    deployer: privateKeyToAccount(config.privateKey).address,
  }

  const deploymentPath = `apps/dws/deployment-${network}.json`
  await Bun.write(deploymentPath, JSON.stringify(deployment, null, 2))
  console.log(`[Deploy] Deployment info saved to ${deploymentPath}`)

  // Update .env suggestion
  console.log('\n[Deploy] To use this deployment, set:')
  console.log(`REPO_REGISTRY_ADDRESS=${contractAddress}`)
}

main().catch((err) => {
  console.error('[Deploy] Error:', err)
  process.exit(1)
})
