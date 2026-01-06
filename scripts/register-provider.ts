import { createWalletClient, http, publicActions, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

const RPC = 'http://127.0.0.1:6546'
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const STORAGE_MANAGER = '0x21dF544947ba3E8b3c32561399E88B52Dc8b2823'

// StorageBackend enum: IPFS=0, ARWEAVE=1, WEBTORRENT=2, FILECOIN=3
const STORAGE_ABI = [
  {
    name: 'registerProvider',
    type: 'function',
    inputs: [
      { name: 'backend', type: 'uint8' },
      { name: 'endpoint', type: 'string' },
      { name: 'capacityGB', type: 'uint256' },
      { name: 'pricePerGBMonth', type: 'uint256' }
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable'
  },
  {
    name: 'getTotalProviders',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'getActiveProviders',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view'
  }
] as const

async function main() {
  const account = privateKeyToAccount(KEY as `0x${string}`)
  const client = createWalletClient({ 
    account, 
    chain: foundry, 
    transport: http(RPC) 
  }).extend(publicActions)

  console.log('Registering as storage provider...')
  console.log('Address:', account.address)

  try {
    // Register as IPFS provider
    const hash = await client.writeContract({
      address: STORAGE_MANAGER,
      abi: STORAGE_ABI,
      functionName: 'registerProvider',
      args: [
        0, // IPFS
        'http://127.0.0.1:5001', // IPFS endpoint
        BigInt(1000), // 1TB capacity
        parseEther('0.01') // 0.01 ETH per GB/month
      ]
    })
    await client.waitForTransactionReceipt({ hash })
    console.log('✓ Registered as IPFS storage provider')

    // Verify
    const count = await client.readContract({
      address: STORAGE_MANAGER,
      abi: STORAGE_ABI,
      functionName: 'getTotalProviders'
    })
    console.log('Total providers:', count.toString())

    const active = await client.readContract({
      address: STORAGE_MANAGER,
      abi: STORAGE_ABI,
      functionName: 'getActiveProviders'
    })
    console.log('Active providers:', active.length)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log('Registration failed:', msg.slice(0, 150))
  }
}

main().catch(console.error)
