#!/usr/bin/env bun
/**
 * Register a DWS node identity in the IdentityRegistry
 */
import { createWalletClient, http, publicActions, keccak256, stringToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

const RPC_URL = 'http://127.0.0.1:6546'
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const IDENTITY_REGISTRY = '0xC9a43158891282A2B1475592D5719c001986Aaec'
const DWS_ENDPOINT = 'http://127.0.0.1:4030'

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'tokenURI_', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'updateTags',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'tags', type: 'string[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setMetadata',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'totalSupply',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getAgentsByTag',
    type: 'function',
    inputs: [{ name: 'tag', type: 'string' }],
    outputs: [{ type: 'uint256[]' }],
    stateMutability: 'view',
  },
] as const

async function main() {
  console.log('=== REGISTERING DWS NODE IDENTITY ===\n')

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
  const client = createWalletClient({
    account,
    chain: foundry,
    transport: http(RPC_URL),
  }).extend(publicActions)

  console.log(`Account: ${account.address}`)
  console.log(`Registry: ${IDENTITY_REGISTRY}\n`)

  // 1. Register agent
  console.log('1. Registering identity...')
  let agentId: bigint | undefined
  try {
    const tokenURI = JSON.stringify({
      name: 'local-dws-node',
      endpoint: DWS_ENDPOINT,
      nodeType: 'full',
      region: 'global',
      capabilities: ['storage', 'cdn', 'compute', 'workers'],
    })

    const hash = await client.writeContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'register',
      args: [tokenURI],
    })
    const receipt = await client.waitForTransactionReceipt({ hash })
    
    // Parse logs to get agentId
    const regEvent = receipt.logs.find(log => log.topics[0] && log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase())
    if (regEvent && regEvent.topics[1]) {
      agentId = BigInt(regEvent.topics[1])
    }
    console.log(`   ✓ Identity registered: ${hash}`)
    console.log(`   Agent ID: ${agentId}`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`   ✗ Failed: ${msg.slice(0, 200)}`)
    return
  }

  // 2. Add "dws" tag
  if (agentId !== undefined) {
    console.log('\n2. Adding DWS tag...')
    try {
      const hash = await client.writeContract({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'updateTags',
        args: [agentId, ['dws', 'dws-storage', 'dws-cdn']],
      })
      await client.waitForTransactionReceipt({ hash })
      console.log(`   ✓ Tags added: ${hash}`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`   ✗ Failed: ${msg.slice(0, 200)}`)
    }
  }

  // 3. Check counts
  console.log('\n3. Verifying registration...')
  try {
    const totalSupply = await client.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'totalSupply',
    })
    console.log(`   Total agents: ${totalSupply}`)
  } catch (e) {
    console.log(`   totalSupply failed`)
  }

  try {
    const dwsNodes = await client.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: ['dws'],
    })
    console.log(`   DWS nodes: ${dwsNodes.length}`)
  } catch (e) {
    console.log(`   getAgentsByTag failed`)
  }

  console.log('\n=== REGISTRATION COMPLETE ===')
}

main().catch(console.error)
