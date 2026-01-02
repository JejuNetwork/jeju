import { createWalletClient, http, publicActions, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

const RPC = 'http://127.0.0.1:6546'
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const WORKER_REGISTRY = '0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2'

// PaymentMode enum: FREE=0, PREPAID=1, SUBSCRIPTION=2
const WORKER_ABI = [
  {
    name: 'deployWorker',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'codeHash', type: 'bytes32' },
      { name: 'routes', type: 'string[]' },
      { name: 'cronSchedule', type: 'string' },
      { name: 'paymentMode', type: 'uint8' },
      { name: 'pricePerInvocation', type: 'uint256' }
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable'
  },
  {
    name: 'getWorkerCount',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
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

  console.log('Deploying a DWS worker...')

  // Create a mock worker code hash (in reality this would be IPFS CID of the worker bundle)
  const workerCode = 'export default { fetch(req) { return new Response("Hello from DWS Worker!") } }'
  const codeHash = keccak256(toBytes(workerCode))

  try {
    const hash = await client.writeContract({
      address: WORKER_REGISTRY,
      abi: WORKER_ABI,
      functionName: 'deployWorker',
      args: [
        'hello-worker',
        codeHash,
        ['/api/hello', '/api/greet'],
        '', // no cron
        0, // FREE
        BigInt(0) // free
      ]
    })
    await client.waitForTransactionReceipt({ hash })
    console.log('✓ Worker deployed')

    const count = await client.readContract({
      address: WORKER_REGISTRY,
      abi: WORKER_ABI,
      functionName: 'getWorkerCount'
    })
    console.log('Total workers:', count.toString())
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log('Deploy failed:', msg.slice(0, 150))
  }
}

main().catch(console.error)
