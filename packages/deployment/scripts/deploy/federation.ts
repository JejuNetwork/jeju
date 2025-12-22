#!/usr/bin/env bun

/**
 * Deploy Federation Contracts
 *
 * Deploys the federation stack:
 * - NetworkRegistry (on hub chain)
 * - FederatedIdentity (on local chain)
 * - FederatedSolver (on local chain)
 * - FederatedLiquidity (on local chain)
 *
 * Usage:
 *   bun run scripts/deploy/federation.ts [network]
 *   NETWORK=testnet bun run scripts/deploy/federation.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  formatEther,
  getContractAddress,
  type Hex,
  http,
  parseEther,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { getBalance, waitForTransactionReceipt } from 'viem/actions'
import { expectJson, RawArtifactJsonSchema } from '../../schemas'
import type { ConstructorArg } from '../shared/contract-types'

const ROOT = join(import.meta.dir, '../..')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')

type NetworkType = 'localnet' | 'testnet' | 'mainnet'

const NETWORK = (process.env.NETWORK ||
  process.argv[2] ||
  'localnet') as NetworkType

interface ChainConfig {
  chainId: number
  rpcUrl: string
}

interface FederationDeployment {
  network: string
  chainId: number
  hub: {
    chainId: number
    networkRegistry: string
  }
  local: {
    federatedIdentity: string
    federatedSolver: string
    federatedLiquidity: string
  }
  deployedAt: string
}

const CHAIN_CONFIGS: Record<
  NetworkType,
  { local: ChainConfig; hub: ChainConfig }
> = {
  localnet: {
    local: { chainId: 1337, rpcUrl: 'http://localhost:6546' },
    hub: { chainId: 31337, rpcUrl: 'http://localhost:6546' },
  },
  testnet: {
    local: { chainId: 420690, rpcUrl: 'https://testnet-rpc.jejunetwork.org' },
    hub: {
      chainId: 11155111,
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    },
  },
  mainnet: {
    local: { chainId: 420691, rpcUrl: 'https://rpc.jejunetwork.org' },
    hub: { chainId: 1, rpcUrl: 'https://eth.llamarpc.com' },
  },
}

async function getPrivateKey(): Promise<string> {
  const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  if (key) return key

  if (NETWORK === 'localnet') {
    return '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  }

  throw new Error('DEPLOYER_PRIVATE_KEY required')
}

async function deployContract(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  account: PrivateKeyAccount,
  name: string,
  args: ConstructorArg[] = [],
): Promise<Address> {
  const abiPath = join(CONTRACTS_DIR, `out/${name}.sol/${name}.json`)

  if (!existsSync(abiPath)) {
    console.log(`Building contracts...`)
    await $`cd ${CONTRACTS_DIR} && forge build`.quiet()
  }

  const artifact = expectJson(
    readFileSync(abiPath, 'utf-8'),
    RawArtifactJsonSchema,
    `artifact ${name}`,
  )

  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
    args,
  })

  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  })

  const hash = await walletClient.sendTransaction({
    data: deployData,
    account,
  })

  const receipt = await waitForTransactionReceipt(publicClient, { hash })

  if (receipt.status !== 'success') {
    throw new Error(`Deployment failed: ${name} (tx: ${hash})`)
  }

  const address =
    receipt.contractAddress ||
    getContractAddress({
      from: account.address,
      nonce: BigInt(nonce),
    })

  console.log(`  ${name}: ${address}`)
  return address
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  FEDERATION DEPLOYMENT: ${NETWORK.toUpperCase()}`)
  console.log(`${'='.repeat(60)}\n`)

  const config = CHAIN_CONFIGS[NETWORK]
  const privateKey = await getPrivateKey()
  const account = privateKeyToAccount(privateKey as `0x${string}`)

  const hubChain: Chain = {
    id: config.hub.chainId,
    name: 'Hub',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.hub.rpcUrl] } },
  }
  const localChain: Chain = {
    id: config.local.chainId,
    name: 'Local',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.local.rpcUrl] } },
  }

  const hubPublicClient = createPublicClient({
    chain: hubChain,
    transport: http(config.hub.rpcUrl),
  })
  const hubWalletClient = createWalletClient({
    account,
    chain: hubChain,
    transport: http(config.hub.rpcUrl),
  })
  const localPublicClient = createPublicClient({
    chain: localChain,
    transport: http(config.local.rpcUrl),
  })
  const localWalletClient = createWalletClient({
    account,
    chain: localChain,
    transport: http(config.local.rpcUrl),
  })

  console.log(`Deployer: ${account.address}`)
  console.log(`Hub Chain: ${config.hub.chainId}`)
  console.log(`Local Chain: ${config.local.chainId}\n`)

  const hubBalance = await getBalance(hubPublicClient, {
    address: account.address,
  })
  const localBalance = await getBalance(localPublicClient, {
    address: account.address,
  })

  console.log(`Hub Balance: ${formatEther(hubBalance)} ETH`)
  console.log(`Local Balance: ${formatEther(localBalance)} ETH\n`)

  if (hubBalance < parseEther('0.1')) {
    throw new Error('Insufficient hub chain balance')
  }

  if (localBalance < parseEther('0.1')) {
    throw new Error('Insufficient local chain balance')
  }

  console.log('Deploying Hub Contracts...\n')

  const networkRegistry = await deployContract(
    hubPublicClient,
    hubWalletClient,
    account,
    'NetworkRegistry',
    [account.address],
  )

  console.log('\nDeploying Local Contracts...\n')

  const federatedIdentity = await deployContract(
    localPublicClient,
    localWalletClient,
    account,
    'FederatedIdentity',
    [
      BigInt(config.local.chainId),
      account.address,
      account.address,
      networkRegistry,
      '0x0000000000000000000000000000000000000000' as Address,
    ],
  )

  const federatedSolver = await deployContract(
    localPublicClient,
    localWalletClient,
    account,
    'FederatedSolver',
    [
      BigInt(config.local.chainId),
      account.address,
      account.address,
      networkRegistry,
      '0x0000000000000000000000000000000000000000' as Address,
    ],
  )

  const federatedLiquidity = await deployContract(
    localPublicClient,
    localWalletClient,
    account,
    'FederatedLiquidity',
    [
      BigInt(config.local.chainId),
      account.address,
      account.address,
      networkRegistry,
      '0x0000000000000000000000000000000000000000' as Address,
    ],
  )

  const deployment: FederationDeployment = {
    network: NETWORK,
    chainId: config.local.chainId,
    hub: {
      chainId: config.hub.chainId,
      networkRegistry,
    },
    local: {
      federatedIdentity,
      federatedSolver,
      federatedLiquidity,
    },
    deployedAt: new Date().toISOString(),
  }

  const outputPath = join(
    CONTRACTS_DIR,
    `deployments/federation-${NETWORK}.json`,
  )
  writeFileSync(outputPath, JSON.stringify(deployment, null, 2))

  console.log(`\n${'='.repeat(60)}`)
  console.log('  DEPLOYMENT COMPLETE')
  console.log(`${'='.repeat(60)}\n`)

  console.log('Hub Contracts:')
  console.log(`  NetworkRegistry: ${networkRegistry}`)

  console.log('\nLocal Contracts:')
  console.log(`  FederatedIdentity: ${federatedIdentity}`)
  console.log(`  FederatedSolver: ${federatedSolver}`)
  console.log(`  FederatedLiquidity: ${federatedLiquidity}`)

  console.log(`\nSaved to: ${outputPath}\n`)
}

main().catch((err) => {
  console.error('\nDeployment failed:', err.message)
  process.exit(1)
})
