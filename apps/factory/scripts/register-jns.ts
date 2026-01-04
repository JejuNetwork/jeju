/**
 * Factory JNS Registration Script
 *
 * Registers factory.jeju in the Jeju Name Service with:
 * - contenthash pointing to IPFS frontend CID
 * - app.endpoint text record for backend API
 * - app.a2a text record for A2A endpoint (if enabled)
 *
 * Usage:
 *   bun run scripts/register-jns.ts --frontend-cid=<CID> [--backend-endpoint=<URL>]
 *   bun run scripts/register-jns.ts --help
 */

import {
  getContract,
  getCurrentNetwork,
  getEnvVar,
  getRpcUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import type { Address, Hex } from 'viem'
import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  http,
  keccak256,
  stringToBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Parse CLI arguments
const args = process.argv.slice(2)
const argMap = new Map<string, string>()
for (const arg of args) {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=')
    argMap.set(key, value ?? '')
  }
}

if (argMap.has('help')) {
  console.log(`
Factory JNS Registration

Usage:
  bun run scripts/register-jns.ts [options]

Options:
  --frontend-cid=<CID>         IPFS CID for frontend (required)
  --backend-endpoint=<URL>     Backend API endpoint
  --backend-worker-id=<ID>     DWS Worker ID for backend
  --name=<name>                Name to register (default: factory)
  --network=<network>          Network to use (localnet/testnet/mainnet)
  --help                       Show this help message

Environment:
  DEPLOYER_PRIVATE_KEY         Private key for registration (required)
                               For production, this should be managed via KMS.

Example:
  DEPLOYER_PRIVATE_KEY=0x... bun run scripts/register-jns.ts \\
    --frontend-cid=QmXyz... \\
    --backend-endpoint=https://factory.testnet.jejunetwork.org/api
`)
  process.exit(0)
}

const NETWORK = (argMap.get('network') ?? getCurrentNetwork()) as
  | 'localnet'
  | 'testnet'
  | 'mainnet'
const APP_NAME = argMap.get('name') ?? 'factory'
const FRONTEND_CID = argMap.get('frontend-cid')
const BACKEND_ENDPOINT = argMap.get('backend-endpoint')
const BACKEND_WORKER_ID = argMap.get('backend-worker-id')

if (!FRONTEND_CID) {
  console.error('Error: --frontend-cid is required')
  console.error('Run with --help for usage information')
  process.exit(1)
}

// Get deployer private key via config helper (not raw process.env)
const PRIVATE_KEY = getEnvVar('DEPLOYER_PRIVATE_KEY') as Hex | undefined
if (!PRIVATE_KEY) {
  const errorMsg = isProductionEnv()
    ? 'DEPLOYER_PRIVATE_KEY is required. For production, this secret should be managed via KMS.'
    : 'DEPLOYER_PRIVATE_KEY environment variable is required'
  console.error(`Error: ${errorMsg}`)
  process.exit(1)
}

// Contract ABIs
const JNS_REGISTRAR_ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: 'node', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'available',
    type: 'function',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'rentPrice',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const JNS_RESOLVER_ABI = [
  {
    name: 'setContenthash',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setText',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'contenthash',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    name: 'text',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
] as const

const JNS_REGISTRY_ABI = [
  {
    name: 'owner',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'resolver',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'setResolver',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'resolver', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// Calculate namehash
function namehash(name: string): Hex {
  let node: Hex =
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  if (name) {
    const labels = name.split('.')
    for (let i = labels.length - 1; i >= 0; i--) {
      const labelHash = keccak256(stringToBytes(labels[i]))
      node = keccak256(encodePacked(['bytes32', 'bytes32'], [node, labelHash]))
    }
  }
  return node
}

// Encode IPFS CID as contenthash (EIP-1577)
function encodeIPFSContenthash(cid: string): Hex {
  // EIP-1577 contenthash encoding for IPFS
  // Format: 0xe3 (IPFS namespace) + 0x01 (CIDv1 prefix) + 0x70 (dag-pb codec) + multihash

  // For CIDv0 "Qm..." format, we need to base58 decode to get the multihash
  if (cid.startsWith('Qm')) {
    const BASE58_ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

    function base58Decode(str: string): Uint8Array {
      const bytes: number[] = [0]
      for (const char of str) {
        const value = BASE58_ALPHABET.indexOf(char)
        if (value === -1) throw new Error(`Invalid base58 character: ${char}`)

        let carry = value
        for (let i = bytes.length - 1; i >= 0; i--) {
          const n = bytes[i] * 58 + carry
          bytes[i] = n % 256
          carry = Math.floor(n / 256)
        }
        while (carry > 0) {
          bytes.unshift(carry % 256)
          carry = Math.floor(carry / 256)
        }
      }

      // Handle leading zeros
      let leadingZeros = 0
      for (const char of str) {
        if (char === '1') leadingZeros++
        else break
      }

      const result = new Uint8Array(leadingZeros + bytes.length)
      result.set(new Uint8Array(bytes), leadingZeros)
      return result
    }

    const multihash = base58Decode(cid)
    // Contenthash = e3 (IPFS) + 01 (CIDv1) + 70 (dag-pb) + multihash
    const contenthash = new Uint8Array(3 + multihash.length)
    contenthash[0] = 0xe3
    contenthash[1] = 0x01
    contenthash[2] = 0x70
    contenthash.set(multihash, 3)

    return `0x${Array.from(contenthash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}` as Hex
  }

  // For CIDv1 or other formats, store as simple text encoding with e3 prefix
  const cidBytes = new TextEncoder().encode(cid)
  const contenthash = new Uint8Array(1 + cidBytes.length)
  contenthash[0] = 0xe3
  contenthash.set(cidBytes, 1)
  return `0x${Array.from(contenthash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex
}

// Get chain config
function getChain(network: string) {
  const chains: Record<string, { id: number; name: string }> = {
    localnet: { id: 31337, name: 'Jeju Localnet' },
    testnet: { id: 420690, name: 'Jeju Testnet' },
    mainnet: { id: 420691, name: 'Jeju Mainnet' },
  }
  return chains[network] ?? chains.localnet
}

async function registerJNS(): Promise<void> {
  console.log('JNS Registration for Factory')
  console.log(`  Network: ${NETWORK}`)
  console.log(`  App Name: ${APP_NAME}`)
  console.log(`  Frontend CID: ${FRONTEND_CID}`)
  if (BACKEND_ENDPOINT) console.log(`  Backend Endpoint: ${BACKEND_ENDPOINT}`)
  if (BACKEND_WORKER_ID) console.log(`  Backend Worker: ${BACKEND_WORKER_ID}`)
  console.log('')

  // Get contract addresses
  const jnsRegistrarAddress = getContract(
    'jns',
    'registrar',
    NETWORK,
  ) as Address
  const jnsResolverAddress = getContract('jns', 'resolver', NETWORK) as Address
  const jnsRegistryAddress = getContract('jns', 'registry', NETWORK) as Address

  if (!jnsRegistrarAddress || !jnsResolverAddress || !jnsRegistryAddress) {
    throw new Error(`JNS contracts not configured for ${NETWORK}`)
  }

  console.log('Contract addresses:')
  console.log(`  JNS Registrar: ${jnsRegistrarAddress}`)
  console.log(`  JNS Resolver: ${jnsResolverAddress}`)
  console.log(`  JNS Registry: ${jnsRegistryAddress}`)
  console.log('')

  // Setup clients
  const rpcUrl = getRpcUrl(NETWORK)
  const chain = getChain(NETWORK)
  const account = privateKeyToAccount(PRIVATE_KEY)

  console.log(`  Deployer: ${account.address}`)
  console.log(`  RPC URL: ${rpcUrl}`)
  console.log('')

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  })

  // Calculate node hash for the name
  const fullName = `${APP_NAME}.jeju`
  const node = namehash(fullName)
  console.log(`  Name: ${fullName}`)
  console.log(`  Node: ${node}`)
  console.log('')

  // Check if name is already registered
  const currentOwner = await publicClient.readContract({
    address: jnsRegistryAddress,
    abi: JNS_REGISTRY_ABI,
    functionName: 'owner',
    args: [node],
  })

  const isRegistered =
    currentOwner !== '0x0000000000000000000000000000000000000000'
  const ownsName = currentOwner.toLowerCase() === account.address.toLowerCase()

  if (isRegistered && !ownsName) {
    throw new Error(
      `Name ${fullName} is already registered to ${currentOwner}. You need ownership to update records.`,
    )
  }

  // Register name if not already owned
  if (!isRegistered) {
    console.log('Registering name...')

    // Check availability
    const available = await publicClient.readContract({
      address: jnsRegistrarAddress,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'available',
      args: [APP_NAME],
    })

    if (!available) {
      console.log(
        `Name ${APP_NAME} is not available - checking if it's registered to someone else...`,
      )
      // Try to proceed anyway - the name might be owned by the registry itself
    } else {
      // Get price for 1 year
      const duration = BigInt(365 * 24 * 60 * 60) // 1 year in seconds
      const price = await publicClient.readContract({
        address: jnsRegistrarAddress,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'rentPrice',
        args: [APP_NAME, duration],
      })

      console.log(`  Price: ${price} wei`)

      // Register
      const registerHash = await walletClient.writeContract({
        chain: { id: chain.id, name: chain.name },
        address: jnsRegistrarAddress,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'register',
        args: [APP_NAME, account.address, duration],
        value: price,
      })

      console.log(`  Registration tx: ${registerHash}`)
      await publicClient.waitForTransactionReceipt({ hash: registerHash })
      console.log('  Name registered.')
    }
  } else {
    console.log(`Name ${fullName} already owned by ${currentOwner}`)
    if (!ownsName) {
      console.log(
        '  WARNING: You do not own this name. Will attempt to set records anyway...',
      )
    }
  }

  // Ensure resolver is set
  const currentResolver = await publicClient.readContract({
    address: jnsRegistryAddress,
    abi: JNS_REGISTRY_ABI,
    functionName: 'resolver',
    args: [node],
  })

  if (currentResolver.toLowerCase() !== jnsResolverAddress.toLowerCase()) {
    console.log('Setting resolver...')
    const setResolverHash = await walletClient.writeContract({
      chain: { id: chain.id, name: chain.name },
      address: jnsRegistryAddress,
      abi: JNS_REGISTRY_ABI,
      functionName: 'setResolver',
      args: [node, jnsResolverAddress],
    })
    console.log(`  Set resolver tx: ${setResolverHash}`)
    await publicClient.waitForTransactionReceipt({ hash: setResolverHash })
    console.log('  Resolver set.')
  }

  // Set contenthash
  console.log('Setting contenthash...')
  const contenthash = encodeIPFSContenthash(FRONTEND_CID)
  console.log(`  Encoded contenthash: ${contenthash.slice(0, 40)}...`)

  const setContenthashHash = await walletClient.writeContract({
    chain: { id: chain.id, name: chain.name },
    address: jnsResolverAddress,
    abi: JNS_RESOLVER_ABI,
    functionName: 'setContenthash',
    args: [node, contenthash],
  })
  console.log(`  Set contenthash tx: ${setContenthashHash}`)
  await publicClient.waitForTransactionReceipt({ hash: setContenthashHash })
  console.log('  Contenthash set.')

  // Set text records
  const textRecords: Array<{ key: string; value: string }> = []

  if (BACKEND_ENDPOINT) {
    textRecords.push({ key: 'app.endpoint', value: BACKEND_ENDPOINT })
  }

  if (BACKEND_WORKER_ID) {
    textRecords.push({ key: 'dws.worker', value: BACKEND_WORKER_ID })
  }

  // Always set URL to the testnet domain
  const networkDomain = NETWORK === 'mainnet' ? '' : `${NETWORK}.`
  textRecords.push({
    key: 'url',
    value: `https://${APP_NAME}.${networkDomain}jejunetwork.org`,
  })
  textRecords.push({
    key: 'description',
    value: 'Factory - Bounty and Package Marketplace',
  })

  for (const record of textRecords) {
    console.log(`Setting text record: ${record.key}...`)
    const setTextHash = await walletClient.writeContract({
      chain: { id: chain.id, name: chain.name },
      address: jnsResolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setText',
      args: [node, record.key, record.value],
    })
    console.log(`  Set ${record.key} tx: ${setTextHash}`)
    await publicClient.waitForTransactionReceipt({ hash: setTextHash })
    console.log(`  ${record.key} set.`)
  }

  // Verify registration
  console.log('\nVerifying registration...')
  const finalContenthash = await publicClient.readContract({
    address: jnsResolverAddress,
    abi: JNS_RESOLVER_ABI,
    functionName: 'contenthash',
    args: [node],
  })
  console.log(`  Contenthash: ${finalContenthash}`)

  for (const record of textRecords) {
    const value = await publicClient.readContract({
      address: jnsResolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'text',
      args: [node, record.key],
    })
    console.log(`  ${record.key}: ${value}`)
  }

  console.log('\nJNS registration complete.')
  console.log(`  Name: ${fullName}`)
  console.log(`  Frontend: ipfs://${FRONTEND_CID}`)
  if (BACKEND_ENDPOINT) console.log(`  API: ${BACKEND_ENDPOINT}`)
  console.log(`  URL: https://${APP_NAME}.${networkDomain}jejunetwork.org`)
}

registerJNS().catch((error) => {
  console.error('Registration failed:', error.message)
  process.exit(1)
})
