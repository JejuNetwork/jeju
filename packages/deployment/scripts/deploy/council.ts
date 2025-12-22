#!/usr/bin/env bun

/**
 * Deploy Council Contracts
 *
 * Deploys the AI Council DAO contracts:
 * - Council.sol - Main governance contract
 * - CEOAgent.sol - AI CEO management
 *
 * Usage:
 *   DEPLOYER_KEY=0x... bun scripts/deploy-council.ts [network]
 *
 * Networks: localnet, testnet, mainnet
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  type Abi,
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
import { waitForTransactionReceipt } from 'viem/actions'
import type { ConstructorArg, RawArtifactJson } from '../shared/contract-types'

// Contract ABIs and bytecode will be loaded after compilation
const CONTRACTS_DIR = join(import.meta.dir, '../packages/contracts')
const OUT_DIR = join(CONTRACTS_DIR, 'out')

interface NetworkConfig {
  name: string
  chainId: number
  rpcUrl: string
  governanceToken: string
  identityRegistry: string
  reputationRegistry: string
}

const NETWORKS: Record<string, NetworkConfig> = {
  localnet: {
    name: 'Localnet',
    chainId: 8545,
    rpcUrl: process.env.RPC_URL ?? 'http://localhost:9545',
    governanceToken:
      process.env.GOVERNANCE_TOKEN ??
      '0x0000000000000000000000000000000000000000',
    identityRegistry:
      process.env.IDENTITY_REGISTRY ??
      '0x0000000000000000000000000000000000000000',
    reputationRegistry:
      process.env.REPUTATION_REGISTRY ??
      '0x0000000000000000000000000000000000000000',
  },
  testnet: {
    name: 'Testnet',
    chainId: 84532,
    rpcUrl: process.env.RPC_URL ?? 'https://sepolia.base.org',
    governanceToken:
      process.env.GOVERNANCE_TOKEN ??
      '0x0000000000000000000000000000000000000000',
    identityRegistry:
      process.env.IDENTITY_REGISTRY ??
      '0x0000000000000000000000000000000000000000',
    reputationRegistry:
      process.env.REPUTATION_REGISTRY ??
      '0x0000000000000000000000000000000000000000',
  },
  mainnet: {
    name: 'Mainnet',
    chainId: 8453,
    rpcUrl: process.env.RPC_URL ?? 'https://mainnet.base.org',
    governanceToken: process.env.GOVERNANCE_TOKEN ?? '',
    identityRegistry: process.env.IDENTITY_REGISTRY ?? '',
    reputationRegistry: process.env.REPUTATION_REGISTRY ?? '',
  },
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function success(msg: string) {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`)
}

function error(msg: string) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`)
}

function loadContractArtifact(contractName: string): {
  abi: Abi
  bytecode: Hex
} {
  const artifactPath = join(
    OUT_DIR,
    `${contractName}.sol`,
    `${contractName}.json`,
  )

  if (!existsSync(artifactPath)) {
    throw new Error(
      `Contract artifact not found: ${artifactPath}. Run 'forge build' first.`,
    )
  }

  const artifact = JSON.parse(
    readFileSync(artifactPath, 'utf-8'),
  ) as RawArtifactJson
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
  }
}

async function deployContract(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  account: PrivateKeyAccount,
  contractName: string,
  constructorArgs: ConstructorArg[],
): Promise<Address> {
  log(`Deploying ${contractName}...`)

  const { abi, bytecode } = loadContractArtifact(contractName)

  const deployData = encodeDeployData({
    abi,
    bytecode,
    args: constructorArgs,
  })

  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  })

  const txHash = await walletClient.sendTransaction({
    data: deployData,
    account,
  })

  const receipt = await waitForTransactionReceipt(publicClient, {
    hash: txHash,
    timeout: 120_000,
  })

  if (receipt.status !== 'success') {
    throw new Error(`Deployment failed: ${contractName} (tx: ${txHash})`)
  }

  let address: Address
  if (receipt.contractAddress) {
    address = receipt.contractAddress
  } else {
    address = getContractAddress({
      from: account.address,
      nonce: BigInt(nonce),
    })
  }

  await new Promise((resolve) => setTimeout(resolve, 2000))

  const code = await publicClient.getCode({ address })
  if (!code || code === '0x') {
    throw new Error(
      `Contract not found at expected address: ${address} (tx: ${txHash})`,
    )
  }

  success(`${contractName} deployed at: ${address}`)
  return address
}

async function main() {
  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║     JEJU AI COUNCIL CONTRACT DEPLOYMENT   ║')
  console.log('╚══════════════════════════════════════════╝\n')

  const network = process.argv[2] ?? 'localnet'
  const config = NETWORKS[network]

  if (!config) {
    error(`Unknown network: ${network}`)
    console.log('Available networks: localnet, testnet, mainnet')
    process.exit(1)
  }

  const deployerKey = process.env.DEPLOYER_KEY
  if (!deployerKey) {
    error('DEPLOYER_KEY environment variable not set')
    console.log(
      '\nUsage: DEPLOYER_KEY=0x... bun scripts/deploy-council.ts [network]',
    )
    process.exit(1)
  }

  log(`Network: ${config.name} (Chain ID: ${config.chainId})`)
  log(`RPC: ${config.rpcUrl}`)

  log('Compiling contracts...')
  const compileResult =
    await $`cd ${CONTRACTS_DIR} && forge build --contracts src/council/ 2>&1`.text()
  if (compileResult.includes('Error')) {
    error('Compilation failed')
    console.log(compileResult)
    process.exit(1)
  }
  success('Contracts compiled')
  const chain = { id: config.chainId, name: config.name } as Chain
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  })
  const account = privateKeyToAccount(deployerKey as `0x${string}`)
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  })

  log(`Deployer: ${account.address}`)

  const balance = await publicClient.getBalance({ address: account.address })
  log(`Balance: ${formatEther(balance)} ETH`)

  if (balance < parseEther('0.01')) {
    error('Insufficient balance for deployment')
    process.exit(1)
  }

  let governanceToken = config.governanceToken
  let identityRegistry = config.identityRegistry
  let reputationRegistry = config.reputationRegistry

  if (network === 'localnet') {
    if (governanceToken === '0x0000000000000000000000000000000000000000') {
      governanceToken = account.address
      log(`Using deployer as mock governance token: ${governanceToken}`)
    }
    if (identityRegistry === '0x0000000000000000000000000000000000000000') {
      identityRegistry = account.address
      log(`Using deployer as mock identity registry: ${identityRegistry}`)
    }
    if (reputationRegistry === '0x0000000000000000000000000000000000000000') {
      reputationRegistry = account.address
      log(`Using deployer as mock reputation registry: ${reputationRegistry}`)
    }
  }

  const councilAddress = await deployContract(
    publicClient,
    walletClient,
    account,
    'Council',
    [governanceToken, identityRegistry, reputationRegistry, account.address],
  )

  const ceoAgentAddress = await deployContract(
    publicClient,
    walletClient,
    account,
    'CEOAgent',
    [
      governanceToken,
      councilAddress,
      'claude-opus-4-5-20250514',
      account.address,
    ],
  )

  log('Configuring Council with CEO agent...')
  const councilArtifact = loadContractArtifact('Council')
  const { abi } = councilArtifact

  const hash = await walletClient.writeContract({
    address: councilAddress,
    abi,
    functionName: 'setCEOAgent',
    args: [ceoAgentAddress, 1],
    account,
  })
  await waitForTransactionReceipt(publicClient, { hash })
  success('CEO agent configured')
  const deployment = {
    network,
    chainId: config.chainId,
    timestamp: new Date().toISOString(),
    deployer: account.address,
    contracts: {
      Council: councilAddress,
      CEOAgent: ceoAgentAddress,
    },
    dependencies: {
      governanceToken,
      identityRegistry,
      reputationRegistry,
    },
  }

  const deploymentPath = join(
    import.meta.dir,
    `../apps/autocrat/deployment-${network}.json`,
  )
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2))
  success(`Deployment info saved to ${deploymentPath}`)

  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║          DEPLOYMENT COMPLETE              ║')
  console.log('╚══════════════════════════════════════════╝\n')

  console.log('Deployed Contracts:')
  console.log(`  Council:   ${councilAddress}`)
  console.log(`  CEOAgent:  ${ceoAgentAddress}`)

  console.log('\nNext steps:')
  console.log('1. Set council agent addresses using council.setCouncilAgent()')
  console.log(
    '2. Configure research operators using council.setResearchOperator()',
  )
  console.log('3. Update apps/autocrat/.env with contract addresses')
  console.log(`\nEnvironment variables for apps/autocrat:
COUNCIL_ADDRESS=${councilAddress}
CEO_AGENT_ADDRESS=${ceoAgentAddress}
`)
}

main().catch((err) => {
  error(err.message)
  process.exit(1)
})
