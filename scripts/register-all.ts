import { createWalletClient, http, publicActions, parseEther, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

const RPC = 'http://127.0.0.1:6546'
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const STORAGE_MANAGER = '0xe6e340d132b5f46d1e472debcd681b2abc16e57e' as const
const WORKER_REGISTRY = '0xc3e53f4d16ae77db1c982e75a937b9f60fe63690' as const

const STORAGE_ABI = [
  { name: 'registerProvider', type: 'function', inputs: [{ name: 'backend', type: 'uint8' }, { name: 'endpoint', type: 'string' }, { name: 'capacityGB', type: 'uint256' }, { name: 'pricePerGBMonth', type: 'uint256' }], outputs: [{ type: 'bytes32' }], stateMutability: 'nonpayable' },
  { name: 'getTotalProviders', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }
] as const

const WORKER_ABI = [
  { name: 'deployWorker', type: 'function', inputs: [{ name: 'name', type: 'string' }, { name: 'codeHash', type: 'bytes32' }, { name: 'routes', type: 'string[]' }, { name: 'cronSchedule', type: 'string' }, { name: 'paymentMode', type: 'uint8' }, { name: 'pricePerInvocation', type: 'uint256' }], outputs: [{ type: 'bytes32' }], stateMutability: 'nonpayable' },
  { name: 'getWorkerCount', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }
] as const

async function main() {
  const account = privateKeyToAccount(KEY)
  const client = createWalletClient({ account, chain: foundry, transport: http(RPC) }).extend(publicActions)

  console.log('Registering storage provider...')
  const hash1 = await client.writeContract({
    address: STORAGE_MANAGER,
    abi: STORAGE_ABI,
    functionName: 'registerProvider',
    args: [0, 'http://127.0.0.1:5001', BigInt(1000), parseEther('0.01')]
  })
  await client.waitForTransactionReceipt({ hash: hash1 })
  const providerCount = await client.readContract({ address: STORAGE_MANAGER, abi: STORAGE_ABI, functionName: 'getTotalProviders' })
  console.log('✓ Storage providers:', providerCount.toString())

  console.log('Deploying worker...')
  const codeHash = keccak256(toBytes('export default { fetch() { return new Response("Hello") } }'))
  const hash2 = await client.writeContract({
    address: WORKER_REGISTRY,
    abi: WORKER_ABI,
    functionName: 'deployWorker',
    args: ['hello-worker', codeHash, ['/api/hello'], '', 0, BigInt(0)]
  })
  await client.waitForTransactionReceipt({ hash: hash2 })
  const workerCount = await client.readContract({ address: WORKER_REGISTRY, abi: WORKER_ABI, functionName: 'getWorkerCount' })
  console.log('✓ Workers:', workerCount.toString())
}

main().catch(console.error)
