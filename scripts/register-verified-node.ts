import { createWalletClient, http, publicActions, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { readFileSync } from 'node:fs'

const RPC = 'http://127.0.0.1:6546'
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const JEJU_TOKEN = '0x36c02da8a0983159322a80ffe9f24b1acff8b570' as const
const IDENTITY_REGISTRY = '0x809d550fca64d94bd9f66e60752a544199cfac3d' as const

const identity = JSON.parse(readFileSync('.dws/localnet/node-identity.json', 'utf8'))

const ERC20_ABI = [
  { name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }
] as const

const REGISTRY_ABI = [
  {
    name: 'registerIdentity',
    type: 'function',
    inputs: [
      { name: 'publicKey', type: 'bytes' },
      { name: 'nonce', type: 'tuple', components: [
        { name: 'a', type: 'uint64' },
        { name: 'b', type: 'uint64' },
        { name: 'c', type: 'uint64' },
        { name: 'd', type: 'uint64' }
      ]},
      { name: 'nodeId', type: 'bytes32' },
      { name: 'role', type: 'uint8' },
      { name: 'endpoint', type: 'string' },
      { name: 'stakeAmount', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  { name: 'getMinerCount', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'getBlockProducerCount', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }
] as const

async function main() {
  const account = privateKeyToAccount(KEY)
  const client = createWalletClient({ account, chain: foundry, transport: http(RPC) }).extend(publicActions)

  console.log('Registering Node Identity')
  console.log('=========================')
  console.log('Operator:', account.address)
  console.log('NodeID:', identity.nodeId)
  console.log('')

  const stakeAmount = parseEther('10000')

  console.log('Approving tokens...')
  const approveHash = await client.writeContract({
    address: JEJU_TOKEN,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [IDENTITY_REGISTRY, stakeAmount]
  })
  await client.waitForTransactionReceipt({ hash: approveHash })
  console.log('✓ Approved')

  console.log('Registering identity...')
  const registerHash = await client.writeContract({
    address: IDENTITY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'registerIdentity',
    args: [
      identity.publicKey as `0x${string}`,
      {
        a: BigInt(identity.nonce.a),
        b: BigInt(identity.nonce.b),
        c: BigInt(identity.nonce.c),
        d: BigInt(identity.nonce.d)
      },
      identity.nodeId as `0x${string}`,
      1, // MINER role
      'http://127.0.0.1:4030',
      stakeAmount
    ]
  })
  await client.waitForTransactionReceipt({ hash: registerHash })
  console.log('✓ Registered')

  const minerCount = await client.readContract({
    address: IDENTITY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'getMinerCount'
  })
  const bpCount = await client.readContract({
    address: IDENTITY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'getBlockProducerCount'
  })
  
  console.log('')
  console.log('=== ON-CHAIN STATE ===')
  console.log('Miners:', minerCount.toString())
  console.log('Block Producers:', bpCount.toString())
}

main().catch(console.error)
