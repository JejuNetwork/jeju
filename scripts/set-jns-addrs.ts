#!/usr/bin/env bun
/**
 * Set JNS resolver addresses
 */
import { createWalletClient, http, publicActions, namehash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

const RPC = 'http://127.0.0.1:6546'
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const JNS_RESOLVER = '0x1429859428C0aBc9C2C47C8Ee9FBaf82cFA0F20f'

const JNS_RESOLVER_ABI = [
  {
    name: 'setAddr',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'addr', type: 'address' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    name: 'setText',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  }
] as const

async function main() {
  const account = privateKeyToAccount(KEY as `0x${string}`)
  const client = createWalletClient({ account, chain: foundry, transport: http(RPC) }).extend(publicActions)

  console.log('Setting JNS resolver addresses...')

  // Map apps to their URLs
  const apps: Record<string, { addr: string; url: string }> = {
    autocrat: { addr: account.address, url: 'http://127.0.0.1:3001' },
    bazaar: { addr: account.address, url: 'http://127.0.0.1:4006' },
    crucible: { addr: account.address, url: 'http://127.0.0.1:3003' },
    gateway: { addr: account.address, url: 'http://127.0.0.1:3005' },
    oauth3: { addr: account.address, url: 'http://127.0.0.1:3007' },
    wallet: { addr: account.address, url: 'http://127.0.0.1:3008' },
    factory: { addr: account.address, url: 'http://127.0.0.1:4009' },
    monitoring: { addr: account.address, url: 'http://127.0.0.1:4012' },
    dws: { addr: account.address, url: 'http://127.0.0.1:4030' }
  }
  
  for (const [name, config] of Object.entries(apps)) {
    const node = namehash(`${name}.jeju`)
    
    try {
      // Set addr
      const hash1 = await client.writeContract({
        address: JNS_RESOLVER,
        abi: JNS_RESOLVER_ABI,
        functionName: 'setAddr',
        args: [node, config.addr as `0x${string}`]
      })
      await client.waitForTransactionReceipt({ hash: hash1 })

      // Set URL as text record
      const hash2 = await client.writeContract({
        address: JNS_RESOLVER,
        abi: JNS_RESOLVER_ABI,
        functionName: 'setText',
        args: [node, 'url', config.url]
      })
      await client.waitForTransactionReceipt({ hash: hash2 })

      console.log(`✓ ${name}.jeju -> ${config.url}`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`✗ ${name}.jeju: ${msg.slice(0, 60)}`)
    }
  }
  
  console.log('\nDone.')
}

main().catch(console.error)
