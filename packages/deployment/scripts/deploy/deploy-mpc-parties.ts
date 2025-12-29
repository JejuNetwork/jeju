#!/usr/bin/env bun
/**
 * Deploy MPC Party Nodes to DWS
 *
 * This script provisions dedicated MPC party nodes for threshold signing.
 * These nodes are SEPARATE from application services - they only handle
 * MPC key generation and signing operations.
 *
 * Usage:
 *   bun run scripts/deploy/deploy-mpc-parties.ts --network localnet|testnet|mainnet
 *
 * Process:
 * 1. Build MPC party worker
 * 2. Upload to IPFS
 * 3. Register each party in MPCPartyRegistry
 * 4. Create initial cluster
 * 5. Run distributed key generation
 *
 * Requirements:
 * - TEE-capable nodes (Intel TDX, AMD SEV, or Phala)
 * - Minimum stake for slashing
 * - Valid attestation
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { getIpfsApiUrl, getLocalhostHost } from '@jejunetwork/config'
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry } from 'viem/chains'

const NETWORK_CONFIGS = {
  mainnet: { chain: base, rpcUrl: 'https://mainnet.base.org' },
  testnet: { chain: baseSepolia, rpcUrl: 'https://sepolia.base.org' },
  localnet: { chain: foundry, rpcUrl: 'http://localhost:6546' },
} as const

type Network = keyof typeof NETWORK_CONFIGS

const MPC_REGISTRY_ABI = [
  {
    name: 'registerParty',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'endpoint', type: 'string' },
      { name: 'teePlatform', type: 'string' },
      { name: 'attestation', type: 'bytes' },
      { name: 'stakeAmount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'createCluster',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'threshold', type: 'uint256' },
      { name: 'partyAgentIds', type: 'uint256[]' },
    ],
    outputs: [{ name: 'clusterId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setClusterPublicKey',
    type: 'function',
    inputs: [
      { name: 'clusterId', type: 'bytes32' },
      { name: 'groupPublicKey', type: 'bytes' },
      { name: 'derivedAddress', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setServiceAgentAuthorized',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'authorized', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getActiveParties',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getActiveClusters',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'clusterIds', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
] as const

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'createAgent',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'metadataUri', type: 'string' },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

async function buildMPCPartyWorker(
  rootDir: string,
): Promise<{ code: string; hash: `0x${string}` }> {
  console.log('Building MPC party worker...')

  const entryPath = join(rootDir, 'packages/kms/src/dws-worker/index.ts')

  if (!existsSync(entryPath)) {
    throw new Error(`MPC party worker entry not found: ${entryPath}`)
  }

  const result = await Bun.build({
    entrypoints: [entryPath],
    target: 'bun',
    minify: true,
    sourcemap: 'none',
    external: ['viem', 'elysia'],
  })

  if (!result.success) {
    throw new Error(`Build failed: ${result.logs.join('\n')}`)
  }

  const code = await result.outputs[0].text()
  const hash = keccak256(toBytes(code))

  console.log(`  Built: ${code.length} bytes, hash: ${hash.slice(0, 18)}...`)

  return { code, hash }
}

async function uploadToIPFS(ipfsUrl: string, content: string): Promise<string> {
  console.log('Uploading to IPFS...')

  const formData = new FormData()
  formData.append(
    'file',
    new Blob([content], { type: 'application/javascript' }),
    'mpc-party.js',
  )

  const response = await fetch(`${ipfsUrl}/api/v0/add`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`IPFS upload failed: ${response.status}`)
  }

  const result = (await response.json()) as { Hash: string }
  console.log(`  Uploaded: ${result.Hash}`)

  return result.Hash
}

async function registerParty(
  privateKey: `0x${string}`,
  rpcUrl: string,
  chain: (typeof NETWORK_CONFIGS)[Network]['chain'],
  identityRegistryAddress: `0x${string}`,
  mpcRegistryAddress: `0x${string}`,
  stakeTokenAddress: `0x${string}`,
  partyIndex: number,
  endpoint: string,
  stakeAmount: bigint,
): Promise<bigint> {
  console.log(`Registering party ${partyIndex}...`)

  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  // Create agent in IdentityRegistry
  const createAgentTx = await walletClient.writeContract({
    address: identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'createAgent',
    args: [`mpc-party-${partyIndex}`, `ipfs://mpc-party-${partyIndex}`],
  })

  await publicClient.waitForTransactionReceipt({ hash: createAgentTx })

  // Extract agentId from logs (simplified - in production parse events)
  const agentId = BigInt(partyIndex + 1000)

  console.log(`  Agent ID: ${agentId}`)

  // Approve stake token
  const approveTx = await walletClient.writeContract({
    address: stakeTokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [mpcRegistryAddress, stakeAmount],
  })

  await publicClient.waitForTransactionReceipt({ hash: approveTx })

  // Generate mock attestation (real implementation would get from TEE)
  const attestation = toHex(crypto.getRandomValues(new Uint8Array(256)))

  // Register party
  const registerTx = await walletClient.writeContract({
    address: mpcRegistryAddress,
    abi: MPC_REGISTRY_ABI,
    functionName: 'registerParty',
    args: [
      agentId,
      endpoint,
      'intel_tdx',
      toHex(toBytes(attestation)) as `0x${string}`,
      stakeAmount,
    ],
  })

  await publicClient.waitForTransactionReceipt({ hash: registerTx })

  console.log(`  Registered with ${stakeAmount} stake`)

  return agentId
}

async function createCluster(
  privateKey: `0x${string}`,
  rpcUrl: string,
  chain: (typeof NETWORK_CONFIGS)[Network]['chain'],
  mpcRegistryAddress: `0x${string}`,
  partyAgentIds: bigint[],
  threshold: number,
): Promise<`0x${string}`> {
  console.log(
    `Creating cluster with ${partyAgentIds.length} parties, threshold ${threshold}...`,
  )

  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const createClusterTx = await walletClient.writeContract({
    address: mpcRegistryAddress,
    abi: MPC_REGISTRY_ABI,
    functionName: 'createCluster',
    args: ['default-cluster', BigInt(threshold), partyAgentIds],
  })

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: createClusterTx,
  })

  const clusterId = keccak256(
    toBytes(`default-cluster:${receipt.blockNumber}`),
  ) as `0x${string}`

  console.log(`  Cluster ID: ${clusterId}`)

  return clusterId
}

async function runDistributedKeyGeneration(
  partyEndpoints: string[],
  clusterId: `0x${string}`,
  threshold: number,
  partyCount: number,
): Promise<{ groupPublicKey: `0x${string}`; groupAddress: `0x${string}` }> {
  console.log('Running distributed key generation...')

  const keyId = `cluster:${clusterId}:master`
  const serviceAgentId = 'deployer'

  // Round 1: Collect contributions from all parties
  const contributions = await Promise.all(
    partyEndpoints.map(async (endpoint, idx) => {
      console.log(`  Party ${idx + 1}: requesting contribution...`)

      const response = await fetch(`${endpoint}/mpc/keygen/contribute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyId,
          clusterId,
          threshold,
          totalParties: partyCount,
          partyIndices: partyEndpoints.map((_, i) => i + 1),
          serviceAgentId,
        }),
      })

      if (!response.ok) {
        throw new Error(
          `Party ${idx + 1} contribution failed: ${response.status}`,
        )
      }

      return response.json() as Promise<{
        publicShare: `0x${string}`
        commitment: `0x${string}`
      }>
    }),
  )

  console.log('  Collected all contributions')

  // Round 2: Finalize DKG at each party
  const allPublicShares = contributions.map((c) => c.publicShare)
  const allCommitments = contributions.map((c) => c.commitment)

  const finalizeResults = await Promise.all(
    partyEndpoints.map(async (endpoint, idx) => {
      console.log(`  Party ${idx + 1}: finalizing...`)

      const response = await fetch(`${endpoint}/mpc/keygen/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyId,
          clusterId,
          allPublicShares,
          allCommitments,
          serviceAgentId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Party ${idx + 1} finalize failed: ${response.status}`)
      }

      return response.json() as Promise<{
        groupPublicKey: `0x${string}`
        groupAddress: `0x${string}`
      }>
    }),
  )

  const result = finalizeResults[0]

  console.log(`  Group public key: ${result.groupPublicKey.slice(0, 42)}...`)
  console.log(`  Group address: ${result.groupAddress}`)

  return result
}

async function registerClusterKey(
  privateKey: `0x${string}`,
  rpcUrl: string,
  chain: (typeof NETWORK_CONFIGS)[Network]['chain'],
  mpcRegistryAddress: `0x${string}`,
  clusterId: `0x${string}`,
  groupPublicKey: `0x${string}`,
  groupAddress: `0x${string}`,
): Promise<void> {
  console.log('Registering cluster key on-chain...')

  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const setKeyTx = await walletClient.writeContract({
    address: mpcRegistryAddress,
    abi: MPC_REGISTRY_ABI,
    functionName: 'setClusterPublicKey',
    args: [
      clusterId,
      toHex(toBytes(groupPublicKey)) as `0x${string}`,
      groupAddress,
    ],
  })

  await publicClient.waitForTransactionReceipt({ hash: setKeyTx })

  console.log('  Registered on-chain')
}

async function authorizeServices(
  privateKey: `0x${string}`,
  rpcUrl: string,
  chain: (typeof NETWORK_CONFIGS)[Network]['chain'],
  mpcRegistryAddress: `0x${string}`,
  serviceAgentIds: bigint[],
): Promise<void> {
  console.log('Authorizing services to use MPC...')

  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  for (const agentId of serviceAgentIds) {
    const tx = await walletClient.writeContract({
      address: mpcRegistryAddress,
      abi: MPC_REGISTRY_ABI,
      functionName: 'setServiceAgentAuthorized',
      args: [agentId, true],
    })

    await publicClient.waitForTransactionReceipt({ hash: tx })
    console.log(`  Authorized agent ${agentId}`)
  }
}

function generatePartyEndpoints(network: Network, count: number): string[] {
  const basePort = 4100
  const endpoints: string[] = []

  for (let i = 0; i < count; i++) {
    switch (network) {
      case 'localnet':
        endpoints.push(`http://localhost:${basePort + i}`)
        break
      case 'testnet':
        endpoints.push(`https://mpc-party-${i + 1}.testnet.jejunetwork.org`)
        break
      case 'mainnet':
        endpoints.push(`https://mpc-party-${i + 1}.jejunetwork.org`)
        break
    }
  }

  return endpoints
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    network: { type: 'string', short: 'n', default: 'localnet' },
    parties: { type: 'string', short: 'p', default: '3' },
    threshold: { type: 'string', short: 't', default: '2' },
    'stake-amount': { type: 'string', default: '1000000000000000000000' },
    'dry-run': { type: 'boolean', default: false },
    'skip-dkg': { type: 'boolean', default: false },
  },
})

async function main() {
  const network = (values.network ?? 'localnet') as Network
  const partyCount = parseInt(values.parties ?? '3', 10)
  const threshold = parseInt(values.threshold ?? '2', 10)
  const stakeAmount = BigInt(values['stake-amount'] ?? '1000000000000000000000')
  const dryRun = values['dry-run'] ?? false
  const skipDkg = values['skip-dkg'] ?? false

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as
    | `0x${string}`
    | undefined
  const identityRegistryAddress = process.env.IDENTITY_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined
  const mpcRegistryAddress = process.env.MPC_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined

  const stakeTokenAddress =
    typeof process !== 'undefined'
      ? (process.env.STAKE_TOKEN_ADDRESS as `0x${string}` | undefined)
      : undefined
  const ipfsUrl =
    (typeof process !== 'undefined' ? process.env.IPFS_URL : undefined) ??
    getIpfsApiUrl() ??
    `http://${getLocalhostHost()}:5001`

  if (threshold > partyCount) {
    console.error('Threshold cannot exceed party count')
    process.exit(1)
  }

  if (!dryRun && !privateKey) {
    console.error('DEPLOYER_PRIVATE_KEY environment variable required')
    process.exit(1)
  }

  const networkConfig = NETWORK_CONFIGS[network]
  const rootDir = process.cwd()

  console.log(`\nDeploying MPC parties to ${network}\n`)
  console.log('='.repeat(60))
  console.log(`  Party count: ${partyCount}`)
  console.log(`  Threshold: ${threshold} of ${partyCount}`)
  console.log(`  Stake per party: ${stakeAmount}`)
  console.log(`  Dry Run: ${dryRun}`)
  console.log('='.repeat(60))

  // Build and upload MPC party worker
  const { code } = await buildMPCPartyWorker(rootDir)

  if (dryRun) {
    console.log(`\n[DRY RUN] Would upload ${code.length} bytes to IPFS`)
    console.log(`[DRY RUN] Would register ${partyCount} parties`)
    console.log(`[DRY RUN] Would create cluster with threshold ${threshold}`)
    if (!skipDkg) {
      console.log('[DRY RUN] Would run distributed key generation')
    }
    return
  }

  if (
    !identityRegistryAddress ||
    !mpcRegistryAddress ||
    !stakeTokenAddress ||
    !privateKey
  ) {
    console.error(
      'IDENTITY_REGISTRY_ADDRESS, MPC_REGISTRY_ADDRESS, STAKE_TOKEN_ADDRESS, and DEPLOYER_PRIVATE_KEY required',
    )
    process.exit(1)
  }

  const codeCid = await uploadToIPFS(ipfsUrl, code)

  // Register each party
  const partyAgentIds: bigint[] = []
  const partyEndpoints = generatePartyEndpoints(network, partyCount)

  for (let i = 0; i < partyCount; i++) {
    const agentId = await registerParty(
      privateKey,
      networkConfig.rpcUrl,
      networkConfig.chain,
      identityRegistryAddress,
      mpcRegistryAddress,
      stakeTokenAddress,
      i + 1,
      partyEndpoints[i],
      stakeAmount,
    )
    partyAgentIds.push(agentId)
  }

  // Create cluster
  const clusterId = await createCluster(
    privateKey,
    networkConfig.rpcUrl,
    networkConfig.chain,
    mpcRegistryAddress,
    partyAgentIds,
    threshold,
  )

  let groupPublicKey = '0x' as `0x${string}`
  let groupAddress =
    '0x0000000000000000000000000000000000000000' as `0x${string}`

  if (!skipDkg) {
    console.log('\nParties should now be started on their respective nodes.')

    if (process.env.AUTO_DKG === 'true') {
      await Bun.sleep(5000)
    }

    const result = await runDistributedKeyGeneration(
      partyEndpoints,
      clusterId,
      threshold,
      partyCount,
    )

    groupPublicKey = result.groupPublicKey
    groupAddress = result.groupAddress

    await registerClusterKey(
      privateKey,
      networkConfig.rpcUrl,
      networkConfig.chain,
      mpcRegistryAddress,
      clusterId,
      groupPublicKey,
      groupAddress,
    )

    // Authorize default services
    const serviceAgentIds = [1n, 2n, 3n, 4n]
    await authorizeServices(
      privateKey,
      networkConfig.rpcUrl,
      networkConfig.chain,
      mpcRegistryAddress,
      serviceAgentIds,
    )
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('\nMPC Party Deployment Summary:\n')
  console.log(`  Cluster ID: ${clusterId}`)
  if (!skipDkg) {
    console.log(`  Group Address: ${groupAddress}`)
    console.log(`  Group Public Key: ${groupPublicKey.slice(0, 66)}...`)
  }
  console.log(`  Threshold: ${threshold} of ${partyCount}`)
  console.log(`  Parties: ${partyAgentIds.join(', ')}`)
  console.log(`  Code CID: ${codeCid}`)
  console.log()

  const deploymentsDir = join(rootDir, 'deployments')
  if (!existsSync(deploymentsDir)) {
    await Bun.write(join(deploymentsDir, '.gitkeep'), '')
  }

  await Bun.write(
    join(deploymentsDir, `mpc-parties-${network}.json`),
    JSON.stringify(
      {
        network,
        deployedAt: new Date().toISOString(),
        clusterId,
        groupAddress,
        groupPublicKey,
        threshold,
        partyCount,
        parties: partyAgentIds.map((id, i) => ({
          agentId: id.toString(),
          endpoint: partyEndpoints[i],
          index: i + 1,
        })),
        codeCid,
      },
      null,
      2,
    ),
  )

  console.log(
    `Deployment manifest written to deployments/mpc-parties-${network}.json`,
  )
}

main().catch((err) => {
  console.error('MPC party deployment failed:', err)
  process.exit(1)
})
