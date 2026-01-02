/**
 * Discover SQLit Peers from On-Chain Registry
 *
 * Queries the SQLitIdentityRegistry and generates helm values
 * for cluster deployment.
 *
 * Usage:
 *   pnpm run sqlit:discover-peers
 *
 * Environment:
 *   - JEJU_RPC_URL: Jeju L2 RPC endpoint
 *   - SQLIT_REGISTRY_ADDRESS: Registry contract address
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as dotenv from 'dotenv'
import { type Address, createPublicClient, type Hex, http } from 'viem'
import * as yaml from 'yaml'

dotenv.config()

const REGISTRY_ABI = [
  {
    name: 'getActiveBlockProducers',
    type: 'function',
    inputs: [],
    outputs: [
      { name: 'nodeIds', type: 'bytes32[]' },
      { name: 'endpoints', type: 'string[]' },
      { name: 'publicKeys', type: 'bytes[]' },
      {
        name: 'nonces',
        type: 'tuple[]',
        components: [
          { name: 'a', type: 'uint64' },
          { name: 'b', type: 'uint64' },
          { name: 'c', type: 'uint64' },
          { name: 'd', type: 'uint64' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getBlockProducerCount',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

interface PeerInfo {
  name: string
  nodeId: string
  publicKey: string
  nonceA: string
  nonceB: string
  nonceC: string
  nonceD: string
  role: 'Leader' | 'Follower'
  endpoint: string
}

async function main() {
  console.log('='.repeat(60))
  console.log('SQLit Peer Discovery')
  console.log('='.repeat(60))

  const rpcUrl = process.env.JEJU_RPC_URL
  const registryAddress = process.env.SQLIT_REGISTRY_ADDRESS as Address

  if (!rpcUrl || !registryAddress) {
    console.error('Missing required environment variables:')
    console.error('  JEJU_RPC_URL, SQLIT_REGISTRY_ADDRESS')
    process.exit(1)
  }

  console.log('RPC URL:', rpcUrl)
  console.log('Registry:', registryAddress)
  console.log('')

  const publicClient = createPublicClient({ transport: http(rpcUrl) })

  // Get block producer count
  const bpCount = await publicClient.readContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'getBlockProducerCount',
  })

  console.log('Block Producers registered:', bpCount.toString())

  if (bpCount === 0n) {
    console.log('No block producers registered. Nothing to discover.')
    process.exit(0)
  }

  // Get active block producers
  console.log('Fetching active block producers...')
  const result = (await publicClient.readContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'getActiveBlockProducers',
  })) as [
    Hex[],
    string[],
    Hex[],
    { a: bigint; b: bigint; c: bigint; d: bigint }[],
  ]

  const [nodeIds, endpoints, publicKeys, nonces] = result

  console.log('Active block producers:', nodeIds.length)
  console.log('')

  // Build peer list
  const peers: PeerInfo[] = []
  for (let i = 0; i < nodeIds.length; i++) {
    const peer: PeerInfo = {
      name: `sqlit-${i}`,
      nodeId: nodeIds[i].slice(2), // Remove 0x prefix
      publicKey: publicKeys[i].slice(2),
      nonceA: nonces[i].a.toString(),
      nonceB: nonces[i].b.toString(),
      nonceC: nonces[i].c.toString(),
      nonceD: nonces[i].d.toString(),
      role: i === 0 ? 'Leader' : 'Follower',
      endpoint: endpoints[i],
    }
    peers.push(peer)

    console.log(`${peer.name}:`)
    console.log(`  NodeID: ${peer.nodeId.slice(0, 16)}...`)
    console.log(`  Endpoint: ${peer.endpoint}`)
    console.log(`  Role: ${peer.role}`)
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('Generating Helm Values')
  console.log('='.repeat(60))

  // Generate helm values
  const helmValues = {
    replicaCount: peers.length,
    registry: {
      enabled: true,
      address: registryAddress,
      rpcUrl: rpcUrl,
    },
    clusterNodes: peers.map((p) => ({
      name: p.name,
      nodeId: p.nodeId,
      publicKey: p.publicKey,
      nonceA: p.nonceA,
      nonceB: p.nonceB,
      nonceC: p.nonceC,
      nonceD: p.nonceD,
      role: p.role,
    })),
    adapter: {
      enabled: true,
      bpNodeId: peers[0].nodeId,
      bpPublicKey: peers[0].publicKey,
      bpNonceA: peers[0].nonceA,
      bpNonceB: peers[0].nonceB,
      bpNonceC: peers[0].nonceC,
      bpNonceD: peers[0].nonceD,
    },
  }

  // Save to file
  const outputPath = path.resolve(
    __dirname,
    '../../kubernetes/helm/sqlit/values-discovered.yaml',
  )
  fs.writeFileSync(outputPath, yaml.stringify(helmValues))
  console.log('Values written to:', outputPath)

  // Also output to stdout for piping
  console.log('')
  console.log('--- Generated values-discovered.yaml ---')
  console.log(yaml.stringify(helmValues))

  console.log('')
  console.log('='.repeat(60))
  console.log('Discovery Complete!')
  console.log('='.repeat(60))
  console.log('')
  console.log('To deploy with discovered peers:')
  console.log(
    '  helm upgrade sqlit ./packages/deployment/kubernetes/helm/sqlit \\',
  )
  console.log(
    '    -f ./packages/deployment/kubernetes/helm/sqlit/values-testnet.yaml \\',
  )
  console.log(
    '    -f ./packages/deployment/kubernetes/helm/sqlit/values-discovered.yaml \\',
  )
  console.log('    -n dws')
}

main().catch(console.error)
