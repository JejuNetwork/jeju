#!/usr/bin/env bun
/**
 * Register JNS names via Registrar
 */
import { createWalletClient, http, publicActions, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

const RPC = 'http://127.0.0.1:6546'
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const JNS_REGISTRAR = '0xB0D4afd8879eD9F52b28595d31B441D079B2Ca07'

const JNS_REGISTRAR_ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'owner_', type: 'address' },
      { name: 'duration', type: 'uint256' }
    ],
    outputs: [{ name: 'node', type: 'bytes32' }],
    stateMutability: 'payable'
  },
  {
    name: 'price',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' }
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  }
] as const

async function main() {
  const account = privateKeyToAccount(KEY as `0x${string}`)
  const client = createWalletClient({ account, chain: foundry, transport: http(RPC) }).extend(publicActions)

  console.log('Registering JNS names via Registrar...')
  console.log('Account:', account.address)
  console.log('Registrar:', JNS_REGISTRAR)

  const apps = ['autocrat', 'bazaar', 'crucible', 'gateway', 'oauth3', 'wallet', 'factory', 'monitoring', 'dws']
  const duration = BigInt(365 * 24 * 60 * 60) // 1 year
  
  for (const app of apps) {
    try {
      // Get price
      let price = BigInt(0)
      try {
        price = await client.readContract({
          address: JNS_REGISTRAR,
          abi: JNS_REGISTRAR_ABI,
          functionName: 'price',
          args: [app, duration]
        })
      } catch {
        price = parseEther('0.01') // Default price
      }

      // Register
      const hash = await client.writeContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'register',
        args: [app, account.address, duration],
        value: price
      })
      await client.waitForTransactionReceipt({ hash })
      console.log(`✓ ${app}.jeju registered`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('already') || msg.includes('exists')) {
        console.log(`~ ${app}.jeju already registered`)
      } else {
        console.log(`✗ ${app}.jeju: ${msg.slice(0, 80)}`)
      }
    }
  }
  
  console.log('\nDone.')
}

main().catch(console.error)
