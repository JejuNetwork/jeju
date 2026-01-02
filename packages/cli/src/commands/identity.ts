#!/usr/bin/env bun
/**
 * Node Identity Registration CLI
 *
 * Implements BLAKE2b proof-of-work mining for SQLit node identity registration.
 * Based on CovenantSQL algorithm: NodeID = sha256(blake2b-512(publicKey || nonce))
 *
 * Usage:
 *   jeju identity mine [--difficulty 24] [--output identity.json]
 *   jeju identity register [--identity identity.json] [--role blockproducer] [--endpoint localhost:4661]
 *   jeju identity verify <nodeId>
 */

import { secp256k1 } from '@noble/curves/secp256k1'
import { blake2b } from '@noble/hashes/blake2b'
import { sha256 } from '@noble/hashes/sha256'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ============================================================================
// Types
// ============================================================================

export interface NodeIdentity {
  nodeId: string
  publicKey: string
  privateKey: string
  nonce: {
    a: bigint
    b: bigint
    c: bigint
    d: bigint
  }
  difficulty: number
  minedAt: string
}

export interface MiningProgress {
  attempts: number
  bestDifficulty: number
  elapsedMs: number
  hashRate: number
}

export type MiningCallback = (progress: MiningProgress) => void

// ============================================================================
// BLAKE2b Proof-of-Work Miner
// ============================================================================

/**
 * Mine a node identity with BLAKE2b proof-of-work
 *
 * Algorithm (CovenantSQL compatible):
 * 1. Generate secp256k1 keypair
 * 2. Mine for nonce where NodeID = reverse(sha256(blake2b-512(publicKey || nonce)))
 *    has at least `targetDifficulty` leading zero bits
 *
 * @param targetDifficulty Minimum leading zero bits (24 = 6 hex zeros)
 * @param onProgress Callback for mining progress updates
 * @returns Mined identity
 */
export async function mineIdentity(
  targetDifficulty = 24,
  onProgress?: MiningCallback,
): Promise<NodeIdentity> {
  console.log(`\n[Mining] Starting BLAKE2b proof-of-work mining...`)
  console.log(
    `[Mining] Target difficulty: ${targetDifficulty} bits (${targetDifficulty / 4} hex zeros)`,
  )
  console.log(`[Mining] This may take a while...\n`)

  // Generate secp256k1 keypair
  const privateKeyBytes = secp256k1.utils.randomPrivateKey()
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, true) // compressed

  const privateKey = Buffer.from(privateKeyBytes).toString('hex')
  const publicKey = Buffer.from(publicKeyBytes).toString('hex')

  const startTime = Date.now()
  let attempts = 0
  let bestDifficulty = 0

  // Use multiple workers for parallel mining
  const batchSize = 10000

  while (true) {
    // Try a batch of nonces
    for (let i = 0; i < batchSize; i++) {
      attempts++

      // Generate random nonce (4 x uint64)
      const nonce = {
        a:
          BigInt(Math.floor(Math.random() * 0xffffffff)) |
          (BigInt(Math.floor(Math.random() * 0xffffffff)) << 32n),
        b:
          BigInt(Math.floor(Math.random() * 0xffffffff)) |
          (BigInt(Math.floor(Math.random() * 0xffffffff)) << 32n),
        c:
          BigInt(Math.floor(Math.random() * 0xffffffff)) |
          (BigInt(Math.floor(Math.random() * 0xffffffff)) << 32n),
        d: 0n, // Usually fixed to 0 for ordering
      }

      // Compute NodeID
      const nodeId = computeNodeId(publicKey, nonce)
      const difficulty = countLeadingZeroBits(nodeId)

      if (difficulty > bestDifficulty) {
        bestDifficulty = difficulty
        const elapsedMs = Date.now() - startTime
        const hashRate = Math.floor(attempts / (elapsedMs / 1000))

        if (onProgress) {
          onProgress({ attempts, bestDifficulty, elapsedMs, hashRate })
        }

        console.log(
          `[Mining] New best: ${difficulty} bits (${(difficulty / 4).toFixed(1)} hex zeros) ` +
            `| ${hashRate.toLocaleString()} H/s | ${(elapsedMs / 1000).toFixed(1)}s`,
        )
      }

      if (difficulty >= targetDifficulty) {
        const elapsedMs = Date.now() - startTime
        console.log(
          `\n[Mining] SUCCESS. Found valid identity in ${(elapsedMs / 1000).toFixed(2)}s`,
        )
        console.log(`[Mining] NodeID: ${nodeId}`)
        console.log(`[Mining] Difficulty: ${difficulty} bits`)
        console.log(`[Mining] Total attempts: ${attempts.toLocaleString()}`)

        return {
          nodeId,
          publicKey,
          privateKey,
          nonce,
          difficulty,
          minedAt: new Date().toISOString(),
        }
      }
    }

    // Yield to event loop
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * Compute NodeID from public key and nonce
 * Algorithm: NodeID = reverse(sha256(blake2b-512(publicKey || nonce)))
 */
export function computeNodeId(
  publicKey: string,
  nonce: { a: bigint; b: bigint; c: bigint; d: bigint },
): string {
  const pubKeyBytes = Buffer.from(publicKey, 'hex')

  // Serialize nonce as BIG-ENDIAN (CovenantSQL format)
  const nonceBytes = Buffer.alloc(32)
  nonceBytes.writeBigUInt64BE(nonce.a, 0)
  nonceBytes.writeBigUInt64BE(nonce.b, 8)
  nonceBytes.writeBigUInt64BE(nonce.c, 16)
  nonceBytes.writeBigUInt64BE(nonce.d, 24)

  // Concatenate: publicKey || nonce
  const input = Buffer.concat([pubKeyBytes, nonceBytes])

  // THashH: blake2b-512 then sha256
  const blake2bHash = blake2b(input, { dkLen: 64 })
  const sha256Hash = sha256(blake2bHash)

  // Reverse bytes for CovenantSQL NodeID format (Bitcoin-style)
  const reversed = Buffer.from(sha256Hash).reverse()

  return reversed.toString('hex')
}

/**
 * Count leading zero bits in a hex string
 */
export function countLeadingZeroBits(hex: string): number {
  let bits = 0
  for (const char of hex) {
    const value = parseInt(char, 16)
    if (value === 0) {
      bits += 4
    } else {
      // Count remaining leading zeros in this nibble
      if ((value & 0b1000) === 0) bits++
      if ((value & 0b1100) === 0) bits++
      if ((value & 0b1110) === 0) bits++
      break
    }
  }
  return bits
}

/**
 * Verify an identity's proof-of-work
 */
export function verifyIdentity(identity: NodeIdentity): boolean {
  const computed = computeNodeId(identity.publicKey, identity.nonce)
  if (computed !== identity.nodeId) {
    console.error('[Verify] NodeID mismatch')
    console.error(`  Expected: ${identity.nodeId}`)
    console.error(`  Computed: ${computed}`)
    return false
  }

  const difficulty = countLeadingZeroBits(computed)
  if (difficulty < identity.difficulty) {
    console.error('[Verify] Difficulty mismatch')
    return false
  }

  return true
}

// ============================================================================
// On-Chain Registration
// ============================================================================

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
    name: 'verifyIdentity',
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
    ],
    outputs: [{ name: 'valid', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'getIdentity',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        name: 'identity',
        type: 'tuple',
        components: [
          { name: 'nodeId', type: 'bytes32' },
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
          { name: 'operator', type: 'address' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastHeartbeat', type: 'uint256' },
          { name: 'endpoint', type: 'string' },
          { name: 'role', type: 'uint8' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'MIN_BP_STAKE',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'MIN_MINER_STAKE',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'stakingToken',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
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
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export interface RegistrationOptions {
  identity: NodeIdentity
  role: 'blockproducer' | 'miner'
  endpoint: string
  stakeAmount?: bigint
  rpcUrl?: string
  registryAddress?: Address
  operatorPrivateKey?: Hex
}

/**
 * Register an identity on-chain
 */
export async function registerIdentity(
  options: RegistrationOptions,
): Promise<Hex> {
  const {
    identity,
    role,
    endpoint,
    rpcUrl = process.env.JEJU_RPC_URL || 'http://127.0.0.1:6546',
    registryAddress = (process.env.SQLIT_IDENTITY_REGISTRY ||
      '0x0000000000000000000000000000000000000000') as Address,
    operatorPrivateKey = (process.env.OPERATOR_PRIVATE_KEY ||
      process.env.PRIVATE_KEY) as Hex,
  } = options

  if (!operatorPrivateKey) {
    throw new Error(
      'OPERATOR_PRIVATE_KEY or PRIVATE_KEY environment variable required',
    )
  }

  if (registryAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error('SQLIT_IDENTITY_REGISTRY address not configured')
  }

  console.log(`\n[Register] Registering identity on-chain...`)
  console.log(`[Register] Registry: ${registryAddress}`)
  console.log(`[Register] RPC: ${rpcUrl}`)
  console.log(`[Register] Role: ${role}`)
  console.log(`[Register] Endpoint: ${endpoint}`)

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  })

  const account = privateKeyToAccount(operatorPrivateKey)
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  })

  console.log(`[Register] Operator: ${account.address}`)

  // Get staking token address
  const stakingToken = (await publicClient.readContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'stakingToken',
  })) as Address

  console.log(`[Register] Staking token: ${stakingToken}`)

  // Get minimum stake
  let stakeAmount = options.stakeAmount
  if (!stakeAmount) {
    const minStakeFn =
      role === 'blockproducer' ? 'MIN_BP_STAKE' : 'MIN_MINER_STAKE'
    stakeAmount = (await publicClient.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: minStakeFn,
    })) as bigint
    console.log(`[Register] Minimum stake: ${Number(stakeAmount) / 1e18} JEJU`)
  }

  // Check token balance
  const balance = (await publicClient.readContract({
    address: stakingToken,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint

  console.log(`[Register] Token balance: ${Number(balance) / 1e18} JEJU`)

  if (balance < stakeAmount) {
    throw new Error(
      `Insufficient JEJU balance. Need ${Number(stakeAmount) / 1e18}, have ${Number(balance) / 1e18}`,
    )
  }

  // Check existing allowance
  const currentAllowance = (await publicClient.readContract({
    address: stakingToken,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, registryAddress],
  })) as bigint

  // Approve if needed
  if (currentAllowance < stakeAmount) {
    console.log(`[Register] Approving ${Number(stakeAmount) / 1e18} JEJU...`)
    const approveHash = await walletClient.writeContract({
      chain: null,
      address: stakingToken,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [registryAddress, stakeAmount],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveHash })
    console.log(`[Register] Approved: ${approveHash}`)
  } else {
    console.log(`[Register] Sufficient allowance exists`)
  }

  // Register
  console.log(`[Register] Registering identity...`)
  const roleEnum = role === 'blockproducer' ? 0 : 1

  const hash = await walletClient.writeContract({
    chain: null,
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
      roleEnum,
      endpoint,
      stakeAmount,
    ],
  })

  console.log(`[Register] Transaction: ${hash}`)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`[Register] Status: ${receipt.status}`)

  if (receipt.status === 'success') {
    console.log(`\n[Register] SUCCESS. Node registered.`)
    console.log(`[Register] NodeID: ${identity.nodeId}`)
  } else {
    throw new Error('Registration failed')
  }

  return hash
}

// ============================================================================
// CLI Commands
// ============================================================================

export async function handleMineCommand(args: string[]): Promise<void> {
  let difficulty = 24
  let outputPath = 'identity.json'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--difficulty' || args[i] === '-d') {
      difficulty = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--output' || args[i] === '-o') {
      outputPath = args[i + 1]
      i++
    }
  }

  console.log('='.repeat(60))
  console.log('  NODE IDENTITY MINING - BLAKE2b Proof-of-Work')
  console.log('='.repeat(60))

  const identity = await mineIdentity(difficulty)

  // Save identity to file
  const output = {
    nodeId: identity.nodeId,
    publicKey: identity.publicKey,
    privateKey: identity.privateKey,
    nonce: {
      a: identity.nonce.a.toString(),
      b: identity.nonce.b.toString(),
      c: identity.nonce.c.toString(),
      d: identity.nonce.d.toString(),
    },
    difficulty: identity.difficulty,
    minedAt: identity.minedAt,
  }

  await Bun.write(outputPath, JSON.stringify(output, null, 2))
  console.log(`\n[Mining] Identity saved to: ${outputPath}`)

  // Also output environment variable format
  console.log(`\n# Environment variables:`)
  console.log(`SQLIT_NODE_ID=${identity.nodeId}`)
  console.log(`SQLIT_PUBLIC_KEY=${identity.publicKey}`)
  console.log(`SQLIT_PRIVATE_KEY=${identity.privateKey}`)
}

export async function handleRegisterCommand(args: string[]): Promise<void> {
  let identityPath = 'identity.json'
  let role: 'blockproducer' | 'miner' = 'miner'
  let endpoint = 'localhost:4661'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--identity' || args[i] === '-i') {
      identityPath = args[i + 1]
      i++
    } else if (args[i] === '--role' || args[i] === '-r') {
      role = args[i + 1] as 'blockproducer' | 'miner'
      i++
    } else if (args[i] === '--endpoint' || args[i] === '-e') {
      endpoint = args[i + 1]
      i++
    }
  }

  console.log('='.repeat(60))
  console.log('  NODE IDENTITY REGISTRATION')
  console.log('='.repeat(60))

  // Load identity
  const file = Bun.file(identityPath)
  if (!(await file.exists())) {
    throw new Error(`Identity file not found: ${identityPath}`)
  }

  const raw = await file.json()
  const identity: NodeIdentity = {
    nodeId: raw.nodeId,
    publicKey: raw.publicKey,
    privateKey: raw.privateKey,
    nonce: {
      a: BigInt(raw.nonce.a),
      b: BigInt(raw.nonce.b),
      c: BigInt(raw.nonce.c),
      d: BigInt(raw.nonce.d),
    },
    difficulty: raw.difficulty,
    minedAt: raw.minedAt,
  }

  console.log(`[Register] Loaded identity from: ${identityPath}`)
  console.log(`[Register] NodeID: ${identity.nodeId}`)

  // Verify before registering
  if (!verifyIdentity(identity)) {
    throw new Error('Identity verification failed')
  }
  console.log(`[Register] Identity verified locally`)

  await registerIdentity({ identity, role, endpoint })
}

export async function handleVerifyCommand(args: string[]): Promise<void> {
  const nodeId = args[0]

  if (!nodeId) {
    console.log('Usage: jeju identity verify <nodeId>')
    process.exit(1)
  }

  console.log('='.repeat(60))
  console.log('  NODE IDENTITY VERIFICATION')
  console.log('='.repeat(60))

  const rpcUrl = process.env.JEJU_RPC_URL || 'http://127.0.0.1:6546'
  const registryAddress = (process.env.SQLIT_IDENTITY_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address

  if (registryAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error('SQLIT_IDENTITY_REGISTRY address not configured')
  }

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  })

  console.log(`[Verify] Querying on-chain identity...`)
  console.log(`[Verify] NodeID: ${nodeId}`)

  const result = (await publicClient.readContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'getIdentity',
    args: [`0x${nodeId}` as Hex],
  })) as {
    nodeId: Hex
    publicKey: Hex
    nonce: { a: bigint; b: bigint; c: bigint; d: bigint }
    operator: Address
    stakedAmount: bigint
    registeredAt: bigint
    lastHeartbeat: bigint
    endpoint: string
    role: number
    status: number
  }

  if (result.registeredAt === 0n) {
    console.log(`\n[Verify] Node not found in registry`)
    return
  }

  const roleNames = ['Block Producer', 'Miner']
  const statusNames = ['Pending', 'Active', 'Suspended', 'Slashed', 'Exiting']

  console.log(`\n[Verify] Node found:`)
  console.log(`  NodeID: ${result.nodeId}`)
  console.log(`  Public Key: ${result.publicKey}`)
  console.log(`  Operator: ${result.operator}`)
  console.log(`  Role: ${roleNames[result.role] || 'Unknown'}`)
  console.log(`  Status: ${statusNames[result.status] || 'Unknown'}`)
  console.log(`  Staked: ${Number(result.stakedAmount) / 1e18} JEJU`)
  console.log(`  Endpoint: ${result.endpoint}`)
  console.log(
    `  Registered: ${new Date(Number(result.registeredAt) * 1000).toISOString()}`,
  )
  console.log(
    `  Last Heartbeat: ${new Date(Number(result.lastHeartbeat) * 1000).toISOString()}`,
  )

  // Verify the PoW locally
  const identity: NodeIdentity = {
    nodeId: result.nodeId.slice(2),
    publicKey: result.publicKey.slice(2),
    privateKey: '', // Not stored on-chain
    nonce: result.nonce,
    difficulty: countLeadingZeroBits(result.nodeId.slice(2)),
    minedAt: new Date(Number(result.registeredAt) * 1000).toISOString(),
  }

  const computed = computeNodeId(identity.publicKey, identity.nonce)
  const valid = computed === identity.nodeId

  console.log(
    `\n[Verify] Proof-of-work verification: ${valid ? 'VALID' : 'INVALID'}`,
  )
  console.log(`[Verify] Difficulty: ${identity.difficulty} bits`)
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  switch (command) {
    case 'mine':
      await handleMineCommand(args.slice(1))
      break

    case 'register':
      await handleRegisterCommand(args.slice(1))
      break

    case 'verify':
      await handleVerifyCommand(args.slice(1))
      break

    default:
      console.log(`
Node Identity CLI - BLAKE2b Proof-of-Work Mining

Usage:
  jeju identity mine [options]     Mine a new node identity
  jeju identity register [options] Register identity on-chain
  jeju identity verify <nodeId>    Verify an identity

Mine Options:
  -d, --difficulty <bits>  Target difficulty in bits (default: 24 = 6 hex zeros)
  -o, --output <file>      Output file for identity (default: identity.json)

Register Options:
  -i, --identity <file>    Identity file to register (default: identity.json)
  -r, --role <role>        Node role: blockproducer or miner (default: miner)
  -e, --endpoint <addr>    Node endpoint address (default: localhost:4661)

Environment Variables:
  OPERATOR_PRIVATE_KEY     Private key for registration transaction
  SQLIT_IDENTITY_REGISTRY  Registry contract address
  JEJU_RPC_URL             Jeju network RPC URL
`)
      process.exit(1)
  }
}

// Only run if called directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
}
