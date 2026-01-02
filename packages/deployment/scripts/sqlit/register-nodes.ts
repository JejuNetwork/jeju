/**
 * Register SQLit Node Identities On-Chain
 *
 * This script:
 * 1. Generates cryptographic identities for SQLit nodes
 * 2. Registers them on the SQLitIdentityRegistry contract
 * 3. Outputs helm values for the cluster configuration
 *
 * Usage:
 *   pnpm run sqlit:register-nodes
 *
 * Environment:
 *   - OPERATOR_PRIVATE_KEY: Operator's private key (for staking)
 *   - JEJU_RPC_URL: Jeju L2 RPC endpoint
 *   - SQLIT_REGISTRY_ADDRESS: Registry contract address
 *   - JEJU_TOKEN_ADDRESS: JEJU token for staking
 *   - NODE_COUNT: Number of nodes to register (default: 3)
 *   - TARGET_DIFFICULTY: Mining difficulty in bits (default: 24)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { secp256k1 } from '@noble/curves/secp256k1'
import { blake2b } from '@noble/hashes/blake2b'
import { sha256 } from '@noble/hashes/sha256'
import * as dotenv from 'dotenv'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as yaml from 'yaml'

dotenv.config()

// Contract ABI (minimal)
const REGISTRY_ABI = [
  {
    name: 'registerIdentity',
    type: 'function',
    inputs: [
      { name: 'publicKey', type: 'bytes' },
      {
        name: 'nonce',
        type: 'tuple',
        components: [
          { name: 'a', type: 'uint64' },
          { name: 'b', type: 'uint64' },
          { name: 'c', type: 'uint64' },
          { name: 'd', type: 'uint64' },
        ],
      },
      { name: 'nodeId', type: 'bytes32' },
      { name: 'role', type: 'uint8' },
      { name: 'endpoint', type: 'string' },
      { name: 'stakeAmount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
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
] as const

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

interface NodeIdentity {
  name: string
  nodeId: string
  publicKey: string
  privateKey: string
  nonce: { a: bigint; b: bigint; c: bigint; d: bigint }
  difficulty: number
  endpoint: string
  role: 'Leader' | 'Follower'
}

function computeNodeId(
  publicKey: string,
  nonce: { a: bigint; b: bigint; c: bigint; d: bigint },
): string {
  const pubKeyBytes = Buffer.from(publicKey, 'hex')
  const nonceBytes = Buffer.alloc(32)
  nonceBytes.writeBigUInt64BE(nonce.a, 0)
  nonceBytes.writeBigUInt64BE(nonce.b, 8)
  nonceBytes.writeBigUInt64BE(nonce.c, 16)
  nonceBytes.writeBigUInt64BE(nonce.d, 24)

  const input = Buffer.concat([pubKeyBytes, nonceBytes])
  const blake2bHash = blake2b(input, { dkLen: 64 })
  const sha256Hash = sha256(blake2bHash)
  const reversed = Buffer.from(sha256Hash).reverse()
  return reversed.toString('hex')
}

function countLeadingZeroBits(hex: string): number {
  let bits = 0
  for (const char of hex) {
    const value = parseInt(char, 16)
    if (value === 0) {
      bits += 4
    } else {
      if ((value & 0b1000) === 0) bits++
      if ((value & 0b1100) === 0) bits++
      if ((value & 0b1110) === 0) bits++
      break
    }
  }
  return bits
}

async function generateIdentity(
  name: string,
  endpoint: string,
  role: 'Leader' | 'Follower',
  targetDifficulty: number,
): Promise<NodeIdentity> {
  console.log(
    `Mining identity for ${name} (target: ${targetDifficulty} bits)...`,
  )

  const privateKeyBytes = secp256k1.utils.randomPrivateKey()
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, true)

  const privateKey = Buffer.from(privateKeyBytes).toString('hex')
  const publicKey = Buffer.from(publicKeyBytes).toString('hex')

  const startTime = Date.now()
  let bestDifficulty = 0
  let attempts = 0

  for (;;) {
    const nonce = {
      a: BigInt(Math.floor(Math.random() * 0xffffffff)),
      b: BigInt(Math.floor(Math.random() * 0xffffffff)),
      c: BigInt(Math.floor(Math.random() * 0xffffffff)),
      d: BigInt(0),
    }

    const nodeId = computeNodeId(publicKey, nonce)
    const difficulty = countLeadingZeroBits(nodeId)

    if (difficulty > bestDifficulty) {
      bestDifficulty = difficulty
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(
        `  ${name}: Best difficulty ${difficulty} bits (${elapsed}s, ${attempts} attempts)`,
      )
    }

    if (difficulty >= targetDifficulty) {
      console.log(`  ${name}: Found valid identity!`)
      return {
        name,
        nodeId,
        publicKey,
        privateKey,
        nonce,
        difficulty,
        endpoint,
        role,
      }
    }

    attempts++
    if (attempts % 10000 === 0) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('SQLit Node Registration')
  console.log('='.repeat(60))

  // Validate environment
  const rpcUrl = process.env.JEJU_RPC_URL
  const registryAddress = process.env.SQLIT_REGISTRY_ADDRESS as Address
  const tokenAddress = process.env.JEJU_TOKEN_ADDRESS as Address
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY as Hex

  if (!rpcUrl || !registryAddress || !tokenAddress || !operatorKey) {
    console.error('Missing required environment variables:')
    console.error(
      '  JEJU_RPC_URL, SQLIT_REGISTRY_ADDRESS, JEJU_TOKEN_ADDRESS, OPERATOR_PRIVATE_KEY',
    )
    process.exit(1)
  }

  const nodeCount = parseInt(process.env.NODE_COUNT || '3', 10)
  const targetDifficulty = parseInt(process.env.TARGET_DIFFICULTY || '24', 10)
  const namespace = process.env.SQLIT_NAMESPACE || 'dws'
  const releaseName = process.env.SQLIT_RELEASE_NAME || 'sqlit'

  console.log('Configuration:')
  console.log('  RPC URL:', rpcUrl)
  console.log('  Registry:', registryAddress)
  console.log('  Token:', tokenAddress)
  console.log('  Node Count:', nodeCount)
  console.log('  Target Difficulty:', targetDifficulty, 'bits')
  console.log('')

  // Setup clients with chain configuration
  const account = privateKeyToAccount(operatorKey)
  // Define chain for localnet/testnet use
  const chain = {
    id: 31337,
    name: 'Anvil',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  console.log('Operator:', account.address)
  console.log('')

  // Generate identities
  console.log('='.repeat(60))
  console.log('Generating Node Identities')
  console.log('='.repeat(60))

  const identities: NodeIdentity[] = []
  for (let i = 0; i < nodeCount; i++) {
    const name = `sqlit-${i}`
    const endpoint = `${releaseName}-${i}.${releaseName}-headless.${namespace}.svc.cluster.local:4661`
    const role = i === 0 ? 'Leader' : 'Follower'

    const identity = await generateIdentity(
      name,
      endpoint,
      role as 'Leader' | 'Follower',
      targetDifficulty,
    )
    identities.push(identity)
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('Registering Identities On-Chain')
  console.log('='.repeat(60))

  // Check token balance
  const balance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })

  const stakePerNode = parseEther('100000') // 100k JEJU per BP
  const totalStake = stakePerNode * BigInt(nodeCount)

  console.log('Token balance:', Number(balance) / 1e18, 'JEJU')
  console.log('Required stake:', Number(totalStake) / 1e18, 'JEJU')

  if (balance < totalStake) {
    console.error('Insufficient token balance for staking!')
    process.exit(1)
  }

  // Approve tokens
  console.log('Approving tokens...')
  const approveHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [registryAddress, totalStake],
  })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })
  console.log('  Approved!')

  // Register each node
  for (const identity of identities) {
    console.log(`Registering ${identity.name}...`)

    const hash = await walletClient.writeContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'registerIdentity',
      args: [
        `0x${identity.publicKey}` as Hex,
        {
          a: identity.nonce.a,
          b: identity.nonce.b,
          c: identity.nonce.c,
          d: identity.nonce.d,
        },
        `0x${identity.nodeId}` as Hex,
        0, // BLOCK_PRODUCER
        identity.endpoint,
        stakePerNode,
      ],
    })

    await publicClient.waitForTransactionReceipt({ hash })
    console.log(`  ${identity.name} registered! TX: ${hash}`)
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('Generating Output Files')
  console.log('='.repeat(60))

  // Generate helm values
  const clusterNodes = identities.map((id) => ({
    name: id.name,
    nodeId: id.nodeId,
    publicKey: id.publicKey,
    nonceA: id.nonce.a.toString(),
    nonceB: id.nonce.b.toString(),
    nonceC: id.nonce.c.toString(),
    nonceD: id.nonce.d.toString(),
    role: id.role,
  }))

  const helmValues = {
    replicaCount: nodeCount,
    sqlit: {
      registry: {
        enabled: true,
        address: registryAddress,
        rpcUrl: rpcUrl,
      },
    },
    clusterNodes,
    adapter: {
      bpNodeId: identities[0].nodeId,
      bpPublicKey: identities[0].publicKey,
      bpNonceA: identities[0].nonce.a.toString(),
      bpNonceB: identities[0].nonce.b.toString(),
      bpNonceC: identities[0].nonce.c.toString(),
      bpNonceD: identities[0].nonce.d.toString(),
    },
  }

  // Save helm values
  const valuesPath = path.resolve(
    __dirname,
    '../../kubernetes/helm/sqlit/values-registered.yaml',
  )
  fs.writeFileSync(valuesPath, yaml.stringify(helmValues))
  console.log('Helm values saved to:', valuesPath)

  // Save private keys (for node secrets)
  const secretsDir = path.resolve(__dirname, '../../../secrets/sqlit')
  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true })
  }

  for (const identity of identities) {
    const keyPath = path.join(secretsDir, `${identity.name}.key`)
    fs.writeFileSync(keyPath, identity.privateKey)
    console.log(`Private key saved: ${keyPath}`)
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('Registration Complete!')
  console.log('='.repeat(60))
  console.log('')
  console.log('Node identities are now registered on-chain.')
  console.log('Use the generated values-registered.yaml for helm deployment.')
  console.log('')
  console.log('IMPORTANT: Store the private keys securely!')
  console.log('           They are needed for each node to sign transactions.')
}

main().catch(console.error)
