#!/usr/bin/env bun

/**
 * Deploy Messaging Contracts to the network L2
 *
 * Deploys KeyRegistry and MessageNodeRegistry contracts for decentralized messaging.
 *
 * Usage:
 *   bun run scripts/deploy-messaging-contracts.ts --network testnet
 *   bun run scripts/deploy-messaging-contracts.ts --network mainnet --verify
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import {
  getNetworkRpcUrl,
  NETWORK_RPC_CONFIGS,
  NetworkSchema,
  type NetworkType,
} from './shared'

interface DeploymentResult {
  network: string
  keyRegistry: Address
  nodeRegistry: Address
  deployer: Address
  timestamp: string
  blockNumber: number
}

const DeploymentResultSchema = z.object({
  network: z.string(),
  keyRegistry: z.string(),
  nodeRegistry: z.string(),
  deployer: z.string(),
  timestamp: z.string(),
  blockNumber: z.number(),
})

const DeploymentAddressesSchema = z.record(z.string(), DeploymentResultSchema)

function getRequiredPrivateKey(): Hex {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY environment variable is required')
  }
  return privateKey as Hex
}

function parseArgs(): { network: NetworkType; verify: boolean } {
  const args = process.argv.slice(2)
  let network: NetworkType = 'testnet'
  let verify = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--network' && args[i + 1]) {
      const result = NetworkSchema.safeParse(args[i + 1])
      if (!result.success) {
        console.error(`Unknown network: ${args[i + 1]}`)
        console.error(`Available networks: localnet, testnet, mainnet`)
        process.exit(1)
      }
      network = result.data
      i++
    } else if (args[i] === '--verify') {
      verify = true
    }
  }

  return { network, verify }
}

async function runForgeCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('forge', args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    }) as ChildProcess

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
      process.stdout.write(data)
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
      process.stderr.write(data)
    })

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`Forge command failed with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', reject)
  })
}

function extractContractAddress(output: string): Address {
  const match = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/)
  if (!match) {
    throw new Error('Failed to extract contract address from deployment output')
  }
  return match[1] as Address
}

async function deployContracts(
  network: NetworkType,
  verify: boolean,
): Promise<DeploymentResult> {
  const config = NETWORK_RPC_CONFIGS[network]
  const rpcUrl = getNetworkRpcUrl(network)
  const privateKey = getRequiredPrivateKey()

  const account = privateKeyToAccount(privateKey)
  const contractsDir = join(process.cwd(), '../../contracts')

  console.log(`\n🚀 Deploying Messaging Contracts to ${config.name}`)
  console.log(`   RPC: ${rpcUrl}`)
  console.log(`   Deployer: ${account.address}`)
  console.log('')

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  })

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`   Balance: ${Number(balance) / 1e18} ETH`)

  if (balance < parseEther('0.01')) {
    throw new Error(
      'Insufficient balance for deployment (need at least 0.01 ETH)',
    )
  }

  console.log('\n📦 Building contracts...')
  await runForgeCommand(['build'], contractsDir)

  console.log('\n📝 Deploying KeyRegistry...')
  const keyRegistryArgs = [
    'create',
    'src/messaging/KeyRegistry.sol:KeyRegistry',
    '--rpc-url',
    rpcUrl,
    '--private-key',
    privateKey,
    '--broadcast',
    '--json',
  ]

  if (verify) {
    keyRegistryArgs.push('--verify')
  }

  const keyRegistryOutput = await runForgeCommand(keyRegistryArgs, contractsDir)
  const keyRegistryAddress = extractContractAddress(keyRegistryOutput)
  console.log(`   ✅ KeyRegistry deployed at: ${keyRegistryAddress}`)

  console.log('\n📝 Deploying MessageNodeRegistry...')
  const nodeRegistryArgs = [
    'create',
    'src/messaging/MessageNodeRegistry.sol:MessageNodeRegistry',
    '--rpc-url',
    rpcUrl,
    '--private-key',
    privateKey,
    '--broadcast',
    '--json',
  ]

  if (verify) {
    nodeRegistryArgs.push('--verify')
  }

  const nodeRegistryOutput = await runForgeCommand(
    nodeRegistryArgs,
    contractsDir,
  )
  const nodeRegistryAddress = extractContractAddress(nodeRegistryOutput)
  console.log(`   ✅ MessageNodeRegistry deployed at: ${nodeRegistryAddress}`)

  const blockNumber = await publicClient.getBlockNumber()

  const result: DeploymentResult = {
    network,
    keyRegistry: keyRegistryAddress,
    nodeRegistry: nodeRegistryAddress,
    deployer: account.address,
    timestamp: new Date().toISOString(),
    blockNumber: Number(blockNumber),
  }

  const deploymentsFile = join(
    process.cwd(),
    '../../contracts/deployments/messaging.json',
  )
  let deployments: Record<string, DeploymentResult> = {}

  if (existsSync(deploymentsFile)) {
    const existing = JSON.parse(readFileSync(deploymentsFile, 'utf-8'))
    const parsed = DeploymentAddressesSchema.parse(existing)
    deployments = parsed as Record<string, DeploymentResult>
  }

  deployments[network] = result
  writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2))
  console.log(`\n💾 Saved deployment addresses to ${deploymentsFile}`)

  return result
}

async function main(): Promise<void> {
  const { network, verify } = parseArgs()

  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
  console.log('          JEJU MESSAGING CONTRACTS DEPLOYMENT')
  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )

  const result = await deployContracts(network, verify)

  console.log(
    '\n═══════════════════════════════════════════════════════════════════',
  )
  console.log('                    DEPLOYMENT COMPLETE')
  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
  console.log(`
  Network:           ${result.network}
  KeyRegistry:       ${result.keyRegistry}
  NodeRegistry:      ${result.nodeRegistry}
  Deployer:          ${result.deployer}
  Block Number:      ${result.blockNumber}
  Timestamp:         ${result.timestamp}

  Next Steps:
  1. Update app .env with contract addresses:
     KEY_REGISTRY_ADDRESS=${result.keyRegistry}
     NODE_REGISTRY_ADDRESS=${result.nodeRegistry}

  2. Deploy apps via DWS (permissionless):
     NETWORK=testnet bun run packages/deployment/scripts/deploy/dws-bootstrap.ts
`)
  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
}

main().catch((error: Error) => {
  console.error('Deployment failed:', error.message)
  process.exit(1)
})
