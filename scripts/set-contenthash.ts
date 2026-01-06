import { createWalletClient, http, publicActions, namehash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import bs58 from 'bs58'

const RPC = 'http://127.0.0.1:6546'
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const JNS_RESOLVER = '0x1429859428C0aBc9C2C47C8Ee9FBaf82cFA0F20f'

const JNS_RESOLVER_ABI = [
  {
    name: 'setContenthash',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  }
] as const

// Proper IPFS CIDv0 to contenthash encoding matching JNS gateway expectations
function cidV0ToContenthash(cid: string): `0x${string}` {
  // Decode base58 CID - this gives us the full multihash (0x12 0x20 + sha256)
  const decoded = bs58.decode(cid)
  
  // The gateway expects:
  // 0xe3 (ipfs-ns) + 0x01 (version) + 0x70 (dag-pb codec) + multihash (WITHOUT 0x12 0x20)
  // But our decoded CIDv0 IS the multihash (0x12 0x20 + hash)
  
  // So we need: 0xe3 0x01 0x70 + the hash part (skip 0x12 0x20)
  const hashOnly = Buffer.from(decoded.slice(2)) // Skip 0x12 0x20
  
  const contentHash = Buffer.concat([
    Buffer.from([0xe3, 0x01, 0x70]),
    hashOnly
  ])
  return `0x${contentHash.toString('hex')}` as `0x${string}`
}

async function main() {
  const account = privateKeyToAccount(KEY as `0x${string}`)
  const client = createWalletClient({ account, chain: foundry, transport: http(RPC) }).extend(publicActions)

  const name = process.argv[2] || 'autocrat'
  const cid = process.argv[3] || 'QmXacmtonTgnEtgUm7VVAeytkiVdvJZgUpXCrpf26uKqc4'
  
  const node = namehash(`${name}.jeju`)
  const contenthash = cidV0ToContenthash(cid)
  
  console.log(`Setting contenthash for ${name}.jeju`)
  console.log(`CID: ${cid}`)
  console.log(`Contenthash: ${contenthash}`)
  
  try {
    const hash = await client.writeContract({
      address: JNS_RESOLVER,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setContenthash',
      args: [node, contenthash]
    })
    await client.waitForTransactionReceipt({ hash })
    console.log('✓ Contenthash set')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`✗ Failed: ${msg.slice(0, 100)}`)
  }
}

main()
