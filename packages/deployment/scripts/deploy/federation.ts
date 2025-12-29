#!/usr/bin/env bun
/**
 * Federation Deployment and Testing
 *
 * Deploys and tests federation between AWS and GCP Jeju networks.
 * Two separate chains that can communicate via a federation bridge.
 *
 * Architecture:
 * - AWS Chain: Primary sequencer, validator set A
 * - GCP Chain: Secondary sequencer, validator set B
 * - Federation Bridge: Cross-chain message passing
 * - Shared State: Synchronized via rollup proofs
 *
 * Usage:
 *   bun run scripts/deploy/federation.ts deploy
 *   bun run scripts/deploy/federation.ts test
 *   bun run scripts/deploy/federation.ts status
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseEther,
  toBytes,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const ROOT = join(import.meta.dir, '../../../..')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, 'deployments/federation')

// Chain Configuration
interface ChainConfig {
  name: string
  chainId: number
  rpcUrl: string
  wsUrl: string
  provider: 'aws' | 'gcp'
  region: string
  sequencerAddress: Address
  bridgeAddress: Address | null
}

interface FederationConfig {
  awsChain: ChainConfig
  gcpChain: ChainConfig
  bridgeContracts: {
    aws: Address | null
    gcp: Address | null
  }
  validators: {
    aws: Address[]
    gcp: Address[]
  }
}

// Default configuration for testnet
const DEFAULT_CONFIG: FederationConfig = {
  awsChain: {
    name: 'jeju-aws-testnet',
    chainId: 420690,
    rpcUrl: 'https://testnet-rpc.jejunetwork.org',
    wsUrl: 'wss://testnet-ws.jejunetwork.org',
    provider: 'aws',
    region: 'us-east-1',
    sequencerAddress: '0x0000000000000000000000000000000000000000' as Address,
    bridgeAddress: null,
  },
  gcpChain: {
    name: 'jeju-gcp-testnet',
    chainId: 420691,
    rpcUrl: 'https://gcp-testnet-rpc.jejunetwork.org',
    wsUrl: 'wss://gcp-testnet-ws.jejunetwork.org',
    provider: 'gcp',
    region: 'us-central1',
    sequencerAddress: '0x0000000000000000000000000000000000000000' as Address,
    bridgeAddress: null,
  },
  bridgeContracts: {
    aws: null,
    gcp: null,
  },
  validators: {
    aws: [],
    gcp: [],
  },
}

// Federation Bridge Contract ABI
const FEDERATION_BRIDGE_ABI = [
  {
    name: 'initialize',
    type: 'function',
    inputs: [
      { name: 'peerChainId', type: 'uint256' },
      { name: 'validators', type: 'address[]' },
      { name: 'threshold', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'sendMessage',
    type: 'function',
    inputs: [
      { name: 'targetChainId', type: 'uint256' },
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'messageId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'receiveMessage',
    type: 'function',
    inputs: [
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'messageId', type: 'bytes32' },
      { name: 'sender', type: 'address' },
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'signatures', type: 'bytes[]' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getMessageStatus',
    type: 'function',
    inputs: [{ name: 'messageId', type: 'bytes32' }],
    outputs: [
      { name: 'status', type: 'uint8' },
      { name: 'timestamp', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getPeerChainId',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getValidators',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
] as const

/**
 * Load federation configuration
 */
function loadConfig(): FederationConfig {
  const configFile = join(DEPLOYMENTS_DIR, 'config.json')
  if (existsSync(configFile)) {
    return JSON.parse(readFileSync(configFile, 'utf-8'))
  }
  return DEFAULT_CONFIG
}

/**
 * Save federation configuration
 */
function saveConfig(config: FederationConfig): void {
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true })
  }
  const configFile = join(DEPLOYMENTS_DIR, 'config.json')
  writeFileSync(configFile, JSON.stringify(config, null, 2))
}

/**
 * Deploy federation bridge contracts
 */
async function deployBridgeContracts(
  privateKey: string,
  config: FederationConfig,
): Promise<FederationConfig> {
  console.log('\n  Deploying Federation Bridge Contracts...')

  const account = privateKeyToAccount(privateKey as `0x${string}`)

  // Deploy to AWS chain
  console.log('\n  AWS Chain:')
  const awsBridge = await deployBridge(
    config.awsChain,
    config.gcpChain.chainId,
    config.validators.gcp,
    account,
  )
  config.bridgeContracts.aws = awsBridge
  config.awsChain.bridgeAddress = awsBridge
  console.log(`    Bridge deployed: ${awsBridge}`)

  // Deploy to GCP chain
  console.log('\n  GCP Chain:')
  const gcpBridge = await deployBridge(
    config.gcpChain,
    config.awsChain.chainId,
    config.validators.aws,
    account,
  )
  config.bridgeContracts.gcp = gcpBridge
  config.gcpChain.bridgeAddress = gcpBridge
  console.log(`    Bridge deployed: ${gcpBridge}`)

  return config
}

/**
 * Deploy bridge contract to a specific chain
 */
async function deployBridge(
  chain: ChainConfig,
  peerChainId: number,
  validators: Address[],
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<Address> {
  // For this implementation, we'll use forge to deploy the contract
  const deployCmd = `cd ${CONTRACTS_DIR} && forge create src/federation/FederationBridge.sol:FederationBridge \
    --rpc-url ${chain.rpcUrl} \
    --private-key ${account.address} \
    --constructor-args ${peerChainId} "${validators.join(',')}" ${Math.ceil((validators.length * 2) / 3)} \
    --json`

  const output = execSync(deployCmd, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  })

  const result = JSON.parse(output)
  return result.deployedTo as Address
}

/**
 * Test cross-chain message passing
 */
async function testCrossChainMessage(
  config: FederationConfig,
  privateKey: string,
): Promise<{ success: boolean; messageId: Hex; status: number }> {
  console.log('\n  Testing Cross-Chain Message...')

  const account = privateKeyToAccount(privateKey as `0x${string}`)

  if (!config.bridgeContracts.aws || !config.bridgeContracts.gcp) {
    throw new Error('Bridge contracts not deployed')
  }

  // Create clients for AWS chain
  const awsPublicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.awsChain.rpcUrl),
  })

  const awsWalletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(config.awsChain.rpcUrl),
  })

  // Send message from AWS to GCP
  const testMessage = toHex(toBytes('Hello from AWS to GCP'))
  const targetAddress = config.bridgeContracts.gcp

  console.log(`    Sending message from AWS to GCP...`)
  console.log(`    Target: ${targetAddress}`)
  console.log(`    Message: ${testMessage}`)

  const { request } = await awsPublicClient.simulateContract({
    address: config.bridgeContracts.aws,
    abi: FEDERATION_BRIDGE_ABI,
    functionName: 'sendMessage',
    args: [
      BigInt(config.gcpChain.chainId),
      targetAddress,
      testMessage as `0x${string}`,
    ],
    value: parseEther('0.001'),
    account,
  })

  const txHash = await awsWalletClient.writeContract(request)
  const receipt = await awsPublicClient.waitForTransactionReceipt({
    hash: txHash,
  })

  // Extract messageId from logs
  const messageId = receipt.logs[0].topics[1] as Hex

  console.log(`    Transaction: ${txHash}`)
  console.log(`    Message ID: ${messageId}`)

  // Wait for relayer to process (in real deployment, this is automatic)
  console.log(`    Waiting for relayer...`)
  await new Promise((resolve) => setTimeout(resolve, 10000))

  // Check message status on GCP chain
  const gcpPublicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.gcpChain.rpcUrl),
  })

  const [status, timestamp] = await gcpPublicClient.readContract({
    address: config.bridgeContracts.gcp,
    abi: FEDERATION_BRIDGE_ABI,
    functionName: 'getMessageStatus',
    args: [messageId],
  })

  console.log(`    Message status on GCP: ${status}`)
  console.log(`    Timestamp: ${timestamp}`)

  return {
    success: status === 2, // 2 = executed
    messageId,
    status: Number(status),
  }
}

/**
 * Get federation status
 */
async function getFederationStatus(config: FederationConfig): Promise<{
  aws: { connected: boolean; blockNumber: bigint; validators: Address[] }
  gcp: { connected: boolean; blockNumber: bigint; validators: Address[] }
  bridgesSynced: boolean
}> {
  const result = {
    aws: { connected: false, blockNumber: 0n, validators: [] as Address[] },
    gcp: { connected: false, blockNumber: 0n, validators: [] as Address[] },
    bridgesSynced: false,
  }

  // Check AWS chain
  const awsPublicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.awsChain.rpcUrl),
  })

  const gcpPublicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.gcpChain.rpcUrl),
  })

  // AWS status
  const awsBlockNumber = await awsPublicClient.getBlockNumber()
  result.aws.connected = true
  result.aws.blockNumber = awsBlockNumber

  if (config.bridgeContracts.aws) {
    const validators = await awsPublicClient.readContract({
      address: config.bridgeContracts.aws,
      abi: FEDERATION_BRIDGE_ABI,
      functionName: 'getValidators',
    })
    result.aws.validators = [...validators]
  }

  // GCP status
  const gcpBlockNumber = await gcpPublicClient.getBlockNumber()
  result.gcp.connected = true
  result.gcp.blockNumber = gcpBlockNumber

  if (config.bridgeContracts.gcp) {
    const validators = await gcpPublicClient.readContract({
      address: config.bridgeContracts.gcp,
      abi: FEDERATION_BRIDGE_ABI,
      functionName: 'getValidators',
    })
    result.gcp.validators = [...validators]
  }

  // Check if bridges are properly configured
  if (config.bridgeContracts.aws && config.bridgeContracts.gcp) {
    const awsPeerChainId = await awsPublicClient.readContract({
      address: config.bridgeContracts.aws,
      abi: FEDERATION_BRIDGE_ABI,
      functionName: 'getPeerChainId',
    })

    const gcpPeerChainId = await gcpPublicClient.readContract({
      address: config.bridgeContracts.gcp,
      abi: FEDERATION_BRIDGE_ABI,
      functionName: 'getPeerChainId',
    })

    result.bridgesSynced =
      Number(awsPeerChainId) === config.gcpChain.chainId &&
      Number(gcpPeerChainId) === config.awsChain.chainId
  }

  return result
}

/**
 * Main entry point
 */
async function main() {
  const { positionals, values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })

  const command = positionals[0]

  if (values.help || !command) {
    console.log(`
Federation Deployment and Testing

Usage:
  bun run scripts/deploy/federation.ts <command>

Commands:
  deploy    Deploy federation bridge contracts
  test      Test cross-chain message passing
  status    Get federation status
  sync      Sync validator sets between chains

Environment:
  PRIVATE_KEY    Required: Deployer private key
`)
    process.exit(0)
  }

  const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              JEJU FEDERATION DEPLOYMENT                      ║
╠══════════════════════════════════════════════════════════════╣
║  AWS Chain: jeju-aws-testnet (420690)                        ║
║  GCP Chain: jeju-gcp-testnet (420691)                        ║
║  Command:   ${command.padEnd(47)}║
╚══════════════════════════════════════════════════════════════╝
`)

  let config = loadConfig()

  switch (command) {
    case 'deploy': {
      if (!privateKey) {
        throw new Error('PRIVATE_KEY required for deployment')
      }

      console.log('Deploying federation infrastructure...')
      config = await deployBridgeContracts(privateKey, config)
      saveConfig(config)

      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                 DEPLOYMENT COMPLETE                          ║
╠══════════════════════════════════════════════════════════════╣
║  AWS Bridge: ${(config.bridgeContracts.aws ?? 'Not deployed').padEnd(45)}║
║  GCP Bridge: ${(config.bridgeContracts.gcp ?? 'Not deployed').padEnd(45)}║
╚══════════════════════════════════════════════════════════════╝
`)
      break
    }

    case 'test': {
      if (!privateKey) {
        throw new Error('PRIVATE_KEY required for testing')
      }

      console.log('Testing cross-chain communication...')
      const result = await testCrossChainMessage(config, privateKey)

      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   TEST RESULT                                ║
╠══════════════════════════════════════════════════════════════╣
║  Message ID: ${result.messageId.slice(0, 44).padEnd(44)}║
║  Status:     ${String(result.status).padEnd(45)}║
║  Success:    ${(result.success ? 'Yes' : 'No').padEnd(45)}║
╚══════════════════════════════════════════════════════════════╝
`)
      break
    }

    case 'status': {
      console.log('Getting federation status...')
      const status = await getFederationStatus(config)

      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                 FEDERATION STATUS                            ║
╠══════════════════════════════════════════════════════════════╣
║  AWS Chain:                                                  ║
║    Connected:   ${(status.aws.connected ? 'Yes' : 'No').padEnd(42)}║
║    Block:       ${String(status.aws.blockNumber).padEnd(42)}║
║    Validators:  ${String(status.aws.validators.length).padEnd(42)}║
╠══════════════════════════════════════════════════════════════╣
║  GCP Chain:                                                  ║
║    Connected:   ${(status.gcp.connected ? 'Yes' : 'No').padEnd(42)}║
║    Block:       ${String(status.gcp.blockNumber).padEnd(42)}║
║    Validators:  ${String(status.gcp.validators.length).padEnd(42)}║
╠══════════════════════════════════════════════════════════════╣
║  Bridges Synced: ${(status.bridgesSynced ? 'Yes' : 'No').padEnd(41)}║
╚══════════════════════════════════════════════════════════════╝
`)
      break
    }

    case 'sync': {
      console.log('Syncing validator sets...')
      const config = loadConfig()

      if (!config.bridgeContracts.aws || !config.bridgeContracts.gcp) {
        console.error('Bridge contracts not deployed. Run deploy first.')
        process.exit(1)
      }

      // Create clients for both chains
      const awsClient = createPublicClient({
        transport: http(config.awsChain.rpcUrl),
      })
      const gcpClient = createPublicClient({
        transport: http(config.gcpChain.rpcUrl),
      })

      // Get current validators from both bridges
      const [awsValidators, gcpValidators] = await Promise.all([
        awsClient.readContract({
          address: config.bridgeContracts.aws,
          abi: FEDERATION_BRIDGE_ABI,
          functionName: 'getValidators',
        }),
        gcpClient.readContract({
          address: config.bridgeContracts.gcp,
          abi: FEDERATION_BRIDGE_ABI,
          functionName: 'getValidators',
        }),
      ])

      console.log('\n  Current Validator Sets:')
      console.log(`  AWS Chain: ${awsValidators.length} validators`)
      for (let i = 0; i < awsValidators.length; i++) {
        console.log(`    ${i + 1}. ${awsValidators[i]}`)
      }
      console.log(`  GCP Chain: ${gcpValidators.length} validators`)
      for (let i = 0; i < gcpValidators.length; i++) {
        console.log(`    ${i + 1}. ${gcpValidators[i]}`)
      }

      // Update config with current validators
      config.validators.aws = [...awsValidators]
      config.validators.gcp = [...gcpValidators]
      saveConfig(config)

      console.log('\n  Validator sets synced to config.')
      break
    }

    default:
      console.error(`Unknown command: ${command}`)
      process.exit(1)
  }
}

main().catch((error) => {
  console.error('Federation operation failed:', error)
  process.exit(1)
})

export {
  deployBridgeContracts,
  testCrossChainMessage,
  getFederationStatus,
  loadConfig,
  saveConfig,
  type FederationConfig,
  type ChainConfig,
}
