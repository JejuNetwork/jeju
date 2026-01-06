#!/usr/bin/env bun
/**
 * Register a DWS node with proper BLAKE2b proof-of-work identity
 *
 * This script:
 * 1. Mines a node identity with BLAKE2b PoW (or loads existing)
 * 2. Registers the identity on the SQLitIdentityRegistry contract
 * 3. Stores identity for node startup
 *
 * Usage:
 *   bun scripts/register-node.ts [options]
 *
 * Options:
 *   --difficulty <bits>   Mining difficulty (default: 24 = 6 hex zeros)
 *   --role <role>         Node role: blockproducer or miner (default: miner)
 *   --endpoint <addr>     Node endpoint (default: auto-detect)
 *   --identity <file>     Use existing identity file instead of mining
 *   --skip-register       Only mine, don't register on-chain
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
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  rpcUrl: process.env.JEJU_RPC_URL || 'http://127.0.0.1:6546',
  chainId: parseInt(process.env.JEJU_CHAIN_ID || '420691', 10),
  sqlitRegistry: (process.env.SQLIT_IDENTITY_REGISTRY ||
    // Default localnet deployment address
    '0x0000000000000000000000000000000000000000') as Address,
  privateKey: (process.env.OPERATOR_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    // Anvil default for testing
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex,
  identityPath: process.env.NODE_IDENTITY_PATH || '.node-identity.json',
}

// ============================================================================
// BLAKE2b Proof-of-Work Mining
// ============================================================================

interface NodeIdentity {
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

/**
 * Compute NodeID from public key and nonce
 * Algorithm: NodeID = reverse(sha256(blake2b-512(publicKey || nonce)))
 */
function computeNodeId(
  publicKey: string,
  nonce: { a: bigint; b: bigint; c: bigint; d: bigint }
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

/**
 * Mine a node identity with BLAKE2b proof-of-work
 */
async function mineIdentity(targetDifficulty: number): Promise<NodeIdentity> {
  console.log(`\n[Mining] Starting BLAKE2b proof-of-work mining...`)
  console.log(`[Mining] Target difficulty: ${targetDifficulty} bits (${targetDifficulty / 4} hex zeros)`)

  // Generate secp256k1 keypair
  const privateKeyBytes = secp256k1.utils.randomPrivateKey()
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, true)

  const privateKey = Buffer.from(privateKeyBytes).toString('hex')
  const publicKey = Buffer.from(publicKeyBytes).toString('hex')

  const startTime = Date.now()
  let attempts = 0
  let bestDifficulty = 0
  const batchSize = 10000
  const reportInterval = 5000 // Report every 5 seconds

  let lastReport = startTime

  while (true) {
    for (let i = 0; i < batchSize; i++) {
      attempts++

      const nonce = {
        a: BigInt(Math.floor(Math.random() * 0xffffffff)) |
           (BigInt(Math.floor(Math.random() * 0xffffffff)) << 32n),
        b: BigInt(Math.floor(Math.random() * 0xffffffff)) |
           (BigInt(Math.floor(Math.random() * 0xffffffff)) << 32n),
        c: BigInt(Math.floor(Math.random() * 0xffffffff)) |
           (BigInt(Math.floor(Math.random() * 0xffffffff)) << 32n),
        d: 0n,
      }

      const nodeId = computeNodeId(publicKey, nonce)
      const difficulty = countLeadingZeroBits(nodeId)

      if (difficulty > bestDifficulty) {
        bestDifficulty = difficulty
        const elapsedMs = Date.now() - startTime
        const hashRate = Math.floor(attempts / (elapsedMs / 1000))
        console.log(
          `[Mining] New best: ${difficulty} bits | ${hashRate.toLocaleString()} H/s | ${(elapsedMs / 1000).toFixed(1)}s`
        )
      }

      if (difficulty >= targetDifficulty) {
        const elapsedMs = Date.now() - startTime
        console.log(`\n[Mining] SUCCESS. Found valid identity.`)
        console.log(`[Mining] NodeID: ${nodeId}`)
        console.log(`[Mining] Difficulty: ${difficulty} bits`)
        console.log(`[Mining] Time: ${(elapsedMs / 1000).toFixed(2)}s`)
        console.log(`[Mining] Attempts: ${attempts.toLocaleString()}`)

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

    // Progress report
    const now = Date.now()
    if (now - lastReport > reportInterval) {
      const elapsedMs = now - startTime
      const hashRate = Math.floor(attempts / (elapsedMs / 1000))
      console.log(
        `[Mining] Progress: ${attempts.toLocaleString()} attempts | ` +
        `${hashRate.toLocaleString()} H/s | best: ${bestDifficulty} bits`
      )
      lastReport = now
    }

    // Yield to event loop
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
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
    name: 'stakingToken',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
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
] as const

async function registerOnChain(
  identity: NodeIdentity,
  role: 'blockproducer' | 'miner',
  endpoint: string
): Promise<void> {
  if (CONFIG.sqlitRegistry === '0x0000000000000000000000000000000000000000') {
    console.log(`\n[Register] SQLitIdentityRegistry not deployed. Skipping on-chain registration.`)
    console.log(`[Register] Set SQLIT_IDENTITY_REGISTRY to enable registration.`)
    return
  }

  console.log(`\n[Register] Starting on-chain registration...`)
  console.log(`[Register] Registry: ${CONFIG.sqlitRegistry}`)
  console.log(`[Register] Role: ${role}`)
  console.log(`[Register] Endpoint: ${endpoint}`)

  const chain = {
    id: CONFIG.chainId,
    name: 'Jeju',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
  } as const

  const publicClient = createPublicClient({
    chain,
    transport: http(CONFIG.rpcUrl),
  })

  const account = privateKeyToAccount(CONFIG.privateKey)
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(CONFIG.rpcUrl),
  })

  console.log(`[Register] Operator: ${account.address}`)

  // Get staking token and minimum stake
  const stakingToken = (await publicClient.readContract({
    address: CONFIG.sqlitRegistry,
    abi: REGISTRY_ABI,
    functionName: 'stakingToken',
  })) as Address

  const minStakeFn = role === 'blockproducer' ? 'MIN_BP_STAKE' : 'MIN_MINER_STAKE'
  const minStake = (await publicClient.readContract({
    address: CONFIG.sqlitRegistry,
    abi: REGISTRY_ABI,
    functionName: minStakeFn,
  })) as bigint

  console.log(`[Register] Staking token: ${stakingToken}`)
  console.log(`[Register] Minimum stake: ${Number(minStake) / 1e18} JEJU`)

  // Check balance
  const balance = (await publicClient.readContract({
    address: stakingToken,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint

  console.log(`[Register] Token balance: ${Number(balance) / 1e18} JEJU`)

  if (balance < minStake) {
    throw new Error(`Insufficient JEJU balance. Need ${Number(minStake) / 1e18}, have ${Number(balance) / 1e18}`)
  }

  // Approve staking tokens
  console.log(`[Register] Approving staking tokens...`)
  const approveHash = await walletClient.writeContract({
    address: stakingToken,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [CONFIG.sqlitRegistry, minStake],
  })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })
  console.log(`[Register] Approved: ${approveHash}`)

  // Register identity
  console.log(`[Register] Registering identity...`)
  const roleEnum = role === 'blockproducer' ? 0 : 1

  const registerHash = await walletClient.writeContract({
    address: CONFIG.sqlitRegistry,
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
      minStake,
    ],
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash })
  console.log(`[Register] Transaction: ${registerHash}`)
  console.log(`[Register] Status: ${receipt.status}`)

  if (receipt.status === 'success') {
    console.log(`\n[Register] SUCCESS. Node registered on-chain.`)
  } else {
    throw new Error('Registration transaction failed')
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(60))
  console.log('  DWS NODE REGISTRATION')
  console.log('='.repeat(60))

  const args = process.argv.slice(2)

  // Parse arguments
  let difficulty = 24
  let role: 'blockproducer' | 'miner' = 'miner'
  let endpoint = 'http://127.0.0.1:4030'
  let identityPath: string | null = null
  let skipRegister = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--difficulty' || args[i] === '-d') {
      difficulty = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--role' || args[i] === '-r') {
      role = args[i + 1] as 'blockproducer' | 'miner'
      i++
    } else if (args[i] === '--endpoint' || args[i] === '-e') {
      endpoint = args[i + 1]
      i++
    } else if (args[i] === '--identity' || args[i] === '-i') {
      identityPath = args[i + 1]
      i++
    } else if (args[i] === '--skip-register') {
      skipRegister = true
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: bun scripts/register-node.ts [options]

Options:
  -d, --difficulty <bits>   Mining difficulty (default: 24)
  -r, --role <role>         Node role: blockproducer or miner (default: miner)
  -e, --endpoint <addr>     Node endpoint (default: http://127.0.0.1:4030)
  -i, --identity <file>     Use existing identity file
  --skip-register           Only mine, don't register on-chain

Environment Variables:
  JEJU_RPC_URL              RPC URL (default: http://127.0.0.1:6546)
  SQLIT_IDENTITY_REGISTRY   Registry contract address
  OPERATOR_PRIVATE_KEY      Private key for transactions
`)
      process.exit(0)
    }
  }

  console.log(`\nConfiguration:`)
  console.log(`  RPC URL: ${CONFIG.rpcUrl}`)
  console.log(`  Chain ID: ${CONFIG.chainId}`)
  console.log(`  Registry: ${CONFIG.sqlitRegistry}`)
  console.log(`  Difficulty: ${difficulty} bits`)
  console.log(`  Role: ${role}`)
  console.log(`  Endpoint: ${endpoint}`)

  let identity: NodeIdentity

  if (identityPath) {
    // Load existing identity
    console.log(`\n[Load] Loading identity from: ${identityPath}`)
    const file = Bun.file(identityPath)
    if (!(await file.exists())) {
      throw new Error(`Identity file not found: ${identityPath}`)
    }

    const raw = await file.json()
    identity = {
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

    console.log(`[Load] NodeID: ${identity.nodeId}`)
    console.log(`[Load] Difficulty: ${identity.difficulty} bits`)
  } else {
    // Mine new identity
    identity = await mineIdentity(difficulty)
  }

  // Save identity
  const savePath = CONFIG.identityPath
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

  await Bun.write(savePath, JSON.stringify(output, null, 2))
  console.log(`\n[Save] Identity saved to: ${savePath}`)

  // Register on-chain
  if (!skipRegister) {
    await registerOnChain(identity, role, endpoint)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('  NODE REGISTRATION COMPLETE')
  console.log('='.repeat(60))
  console.log(`\nNode Identity:`)
  console.log(`  NodeID: ${identity.nodeId}`)
  console.log(`  Public Key: ${identity.publicKey}`)
  console.log(`  Difficulty: ${identity.difficulty} bits`)
  console.log(`\nEnvironment variables to export:`)
  console.log(`  export SQLIT_NODE_ID=${identity.nodeId}`)
  console.log(`  export SQLIT_PUBLIC_KEY=${identity.publicKey}`)
  console.log(`  export SQLIT_PRIVATE_KEY=${identity.privateKey}`)
}

main().catch((error) => {
  console.error('\nError:', error)
  process.exit(1)
})
