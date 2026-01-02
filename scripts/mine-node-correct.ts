/**
 * Correct Node Identity Miner
 * Matches SQLitIdentityRegistry.computeNodeId exactly
 */
import { createPublicClient, http, toHex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { blake2b } from '@noble/hashes/blake2b'
import { foundry } from 'viem/chains'

const RPC = 'http://127.0.0.1:6546'
const MIN_DIFFICULTY = 24

interface Nonce {
  a: bigint
  b: bigint
  c: bigint
  d: bigint
}

function countLeadingZeroBits(hash: Uint8Array): number {
  let count = 0
  for (const byte of hash) {
    if (byte === 0) {
      count += 8
    } else {
      for (let i = 7; i >= 0; i--) {
        if ((byte & (1 << i)) === 0) count++
        else return count
      }
    }
  }
  return count
}

// Convert uint64 to big-endian bytes (matching contract)
function toBigEndian64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    bytes[7 - i] = Number((value >> BigInt(i * 8)) & 0xFFn)
  }
  return bytes
}

// Reverse bytes32 (matching contract)
function reverseBytes32(hash: Uint8Array): Uint8Array {
  const reversed = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    reversed[i] = hash[31 - i]
  }
  return reversed
}

// CORRECT computation matching SQLitIdentityRegistry.computeNodeId
function computeNodeId(publicKey: Uint8Array, nonce: Nonce): Uint8Array {
  // Serialize nonce as BIG-ENDIAN (4 x uint64)
  const nonceBytes = new Uint8Array(32)
  nonceBytes.set(toBigEndian64(nonce.a), 0)
  nonceBytes.set(toBigEndian64(nonce.b), 8)
  nonceBytes.set(toBigEndian64(nonce.c), 16)
  nonceBytes.set(toBigEndian64(nonce.d), 24)
  
  // Concatenate publicKey || nonce
  const input = new Uint8Array(publicKey.length + nonceBytes.length)
  input.set(publicKey)
  input.set(nonceBytes, publicKey.length)
  
  // blake2b-512
  const blakeHash = blake2b(input, { dkLen: 64 })
  
  // sha256
  const shaHash = sha256(blakeHash)
  
  // Reverse bytes (Bitcoin-style)
  return reverseBytes32(shaHash)
}

function mine(publicKey: Uint8Array, maxIterations: number = 100000000): { nonce: Nonce; nodeId: Uint8Array; iterations: number } | null {
  let bestZeros = 0
  const startTime = Date.now()
  
  for (let i = 0; i < maxIterations; i++) {
    const nonce: Nonce = {
      a: BigInt(i),
      b: BigInt(Math.floor(Math.random() * 0xFFFFFFFF)),
      c: BigInt(Date.now() & 0xFFFFFFFF),
      d: BigInt(Math.floor(Math.random() * 0xFFFFFFFF))
    }
    
    const nodeId = computeNodeId(publicKey, nonce)
    const leadingZeros = countLeadingZeroBits(nodeId)
    
    if (leadingZeros > bestZeros) {
      bestZeros = leadingZeros
      const elapsed = (Date.now() - startTime) / 1000
      console.log(`New best: ${leadingZeros} zeros at iteration ${i} (${elapsed.toFixed(1)}s)`)
    }
    
    if (leadingZeros >= MIN_DIFFICULTY) {
      return { nonce, nodeId, iterations: i }
    }
  }
  
  return null
}

async function main() {
  console.log('Correct Node Identity Miner')
  console.log('===========================')
  console.log(`Target: ${MIN_DIFFICULTY} leading zero bits`)
  console.log('')

  const nodePrivKey = generatePrivateKey()
  const privKeyBytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    privKeyBytes[i] = parseInt(nodePrivKey.slice(2 + i * 2, 4 + i * 2), 16)
  }
  
  const nodePublicKey = secp256k1.getPublicKey(privKeyBytes, true)
  console.log('Node public key:', toHex(nodePublicKey))
  console.log('')
  console.log('Mining...')
  
  const result = mine(nodePublicKey)
  
  if (!result) {
    console.log('Mining failed')
    process.exit(1)
  }

  console.log('')
  console.log('=== FOUND VALID NODEID ===')
  console.log('NodeID:', toHex(result.nodeId))
  console.log('Nonce:', {
    a: result.nonce.a.toString(),
    b: result.nonce.b.toString(),
    c: result.nonce.c.toString(),
    d: result.nonce.d.toString()
  })
  console.log('Iterations:', result.iterations)
  
  // Verify on-chain
  const client = createPublicClient({ chain: foundry, transport: http(RPC) })
  const IDENTITY_REGISTRY = '0x809d550fca64d94bd9f66e60752a544199cfac3d'
  
  try {
    const verified = await client.readContract({
      address: IDENTITY_REGISTRY,
      abi: [{
        name: 'verifyIdentity',
        type: 'function',
        inputs: [
          { name: 'publicKey', type: 'bytes' },
          { name: 'nonce', type: 'tuple', components: [
            { name: 'a', type: 'uint64' },
            { name: 'b', type: 'uint64' },
            { name: 'c', type: 'uint64' },
            { name: 'd', type: 'uint64' }
          ]},
          { name: 'nodeId', type: 'bytes32' }
        ],
        outputs: [{ type: 'bool' }],
        stateMutability: 'view'
      }],
      functionName: 'verifyIdentity',
      args: [
        toHex(nodePublicKey),
        {
          a: result.nonce.a,
          b: result.nonce.b,
          c: result.nonce.c,
          d: result.nonce.d
        },
        toHex(result.nodeId)
      ]
    })
    console.log('')
    console.log('On-chain verification:', verified ? 'PASSED' : 'FAILED')
  } catch (e: unknown) {
    console.log('Verification error:', e instanceof Error ? e.message.slice(0, 100) : 'unknown')
  }
  
  // Save
  const identity = {
    publicKey: toHex(nodePublicKey),
    nodeId: toHex(result.nodeId),
    nonce: {
      a: result.nonce.a.toString(),
      b: result.nonce.b.toString(),
      c: result.nonce.c.toString(),
      d: result.nonce.d.toString()
    }
  }
  
  await Bun.write('.dws/localnet/node-identity.json', JSON.stringify(identity, null, 2))
  console.log('Saved to .dws/localnet/node-identity.json')
}

main().catch(console.error)
