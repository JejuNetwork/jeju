/**
 * Optimized Node Identity Miner
 * Uses Worker threads for parallel mining
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { createWalletClient, http, publicActions, toHex, parseEther } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { blake2b } from '@noble/hashes/blake2b'
import { foundry } from 'viem/chains'
import { cpus } from 'node:os'

const RPC = 'http://127.0.0.1:6546'
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const IDENTITY_REGISTRY = '0xC9a43158891282A2B1475592D5719c001986Aaec' as const
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

// CORRECT computation: NodeID = sha256(blake2b-512(publicKey || nonce))
function computeNodeId(publicKey: Uint8Array, nonce: Nonce): Uint8Array {
  const nonceBytes = new Uint8Array(32)
  const view = new DataView(nonceBytes.buffer)
  view.setBigUint64(0, nonce.a, true)
  view.setBigUint64(8, nonce.b, true)
  view.setBigUint64(16, nonce.c, true)
  view.setBigUint64(24, nonce.d, true)
  
  const combined = new Uint8Array(publicKey.length + nonceBytes.length)
  combined.set(publicKey)
  combined.set(nonceBytes, publicKey.length)
  
  // blake2b-512 then sha256
  const blake = blake2b(combined, { dkLen: 64 })
  return sha256(blake)
}

// Mining function
function mine(publicKey: Uint8Array, startNonce: number, step: number, maxIterations: number): { nonce: Nonce; nodeId: Uint8Array; iterations: number } | null {
  let bestZeros = 0
  const startTime = Date.now()
  
  for (let i = 0; i < maxIterations; i++) {
    const currentNonce = startNonce + (i * step)
    const nonce: Nonce = {
      a: BigInt(currentNonce),
      b: BigInt(Date.now() & 0xFFFFFFFF),
      c: BigInt((currentNonce * 7) & 0xFFFFFFFF),
      d: BigInt((currentNonce * 13) & 0xFFFFFFFF)
    }
    
    const nodeId = computeNodeId(publicKey, nonce)
    const leadingZeros = countLeadingZeroBits(nodeId)
    
    if (leadingZeros > bestZeros) {
      bestZeros = leadingZeros
      const elapsed = (Date.now() - startTime) / 1000
      console.log(`[Thread ${startNonce}] New best: ${leadingZeros} zeros at iteration ${i} (${elapsed.toFixed(1)}s)`)
    }
    
    if (leadingZeros >= MIN_DIFFICULTY) {
      return { nonce, nodeId, iterations: i }
    }
  }
  
  return null
}

async function main() {
  console.log('Node Identity Miner')
  console.log('===================')
  console.log(`Target: ${MIN_DIFFICULTY} leading zero bits`)
  console.log(`CPUs: ${cpus().length}`)
  console.log('')

  // Generate a node key
  const nodePrivKey = generatePrivateKey()
  const privKeyBytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    privKeyBytes[i] = parseInt(nodePrivKey.slice(2 + i * 2, 4 + i * 2), 16)
  }
  
  const nodePublicKey = secp256k1.getPublicKey(privKeyBytes, true)
  console.log('Node public key:', toHex(nodePublicKey))
  console.log('')
  console.log('Mining (this will take a few minutes)...')
  
  // Single-threaded mining with more iterations
  const result = mine(nodePublicKey, 0, 1, 50000000) // 50 million iterations max
  
  if (!result) {
    console.log('Mining failed to find solution')
    process.exit(1)
  }

  console.log('')
  console.log('=== FOUND VALID NODEID ===')
  console.log('NodeID:', toHex(result.nodeId))
  console.log('Nonce:', result.nonce)
  console.log('Iterations:', result.iterations)
  
  // Now register on-chain (would need staking tokens)
  console.log('')
  console.log('Registration requires staking tokens (10k+ JEJU)')
  console.log('Saving identity for later registration...')
  
  // Save to file for later use
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
