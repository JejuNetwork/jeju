/**
 * Register Node Identity on SQLitIdentityRegistry
 */
import { createWalletClient, http, publicActions, toHex } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { foundry } from 'viem/chains'

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
  
  return sha256(sha256(combined))
}

function mineNonce(publicKey: Uint8Array, maxIterations: number = 1000000): { nonce: Nonce; nodeId: Uint8Array } | null {
  console.log(`Mining for ${MIN_DIFFICULTY} leading zero bits...`)
  
  let bestZeros = 0
  for (let i = 0; i < maxIterations; i++) {
    const nonce: Nonce = {
      a: BigInt(i),
      b: BigInt(Math.floor(Math.random() * 0xFFFFFFFF)),
      c: BigInt(Date.now()),
      d: BigInt(Math.floor(Math.random() * 0xFFFFFFFF))
    }
    
    const nodeId = computeNodeId(publicKey, nonce)
    const leadingZeros = countLeadingZeroBits(nodeId)
    
    if (leadingZeros > bestZeros) {
      bestZeros = leadingZeros
      console.log(`  New best: ${leadingZeros} zeros at iteration ${i}`)
    }
    
    if (leadingZeros >= MIN_DIFFICULTY) {
      console.log(`  Found valid nodeId with ${leadingZeros} leading zeros`)
      return { nonce, nodeId }
    }
  }
  
  console.log(`  Max iterations reached, best was ${bestZeros} zeros`)
  return null
}

async function main() {
  const account = privateKeyToAccount(KEY)
  const client = createWalletClient({ 
    account, 
    chain: foundry, 
    transport: http(RPC) 
  }).extend(publicActions)

  console.log('Node Identity Registration')
  console.log('Operator:', account.address)
  console.log('')

  // Generate a node key
  const nodePrivKey = generatePrivateKey()
  // Extract raw bytes (remove 0x prefix)
  const privKeyBytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    privKeyBytes[i] = parseInt(nodePrivKey.slice(2 + i * 2, 4 + i * 2), 16)
  }
  
  const nodePublicKey = secp256k1.getPublicKey(privKeyBytes, true)
  console.log('Node public key (33 bytes):', toHex(nodePublicKey))
  
  const result = mineNonce(nodePublicKey)
  if (!result) {
    console.log('')
    console.log('Mining did not find solution in time.')
    console.log('For localnet demo, we can skip node identity registration.')
    return
  }

  console.log('NodeID:', toHex(result.nodeId))
}

main().catch(console.error)
