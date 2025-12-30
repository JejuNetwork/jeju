#!/usr/bin/env bun
/**
 * Configure JNS Routing for cloud.jeju
 * Sets up the resolver and contenthash for the Eliza Cloud deployment
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  parseAbi,
  concat,
  keccak256,
  stringToHex,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const ROOT = join(import.meta.dir, '../../../..')
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments')

// Jeju Testnet configuration
const JEJU_TESTNET: Chain = {
  id: 420690,
  name: 'Jeju Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL || 'http://localhost:38545'] },
  },
}

// Deployer key (same as JNS deployment - owns the names)
const DEPLOYER_KEY = '0xe60c18754e9569e127d320f1f92bbde9722af4ed4c098087b74c8e5af91b7895'

// Compute ENS namehash
function namehash(name: string): `0x${string}` {
  let node = `0x${'0'.repeat(64)}` as `0x${string}`
  if (name === '') return node
  const labels = name.split('.').reverse()
  for (const label of labels) {
    const labelHash = keccak256(stringToHex(label))
    node = keccak256(concat([node, labelHash]))
  }
  return node
}

// Encode IPFS CID as contenthash (using ipfs-ns codec)
function encodeContenthash(cid: string): `0x${string}` {
  // For IPFS CIDv0 (starts with Qm), we encode as:
  // 0xe3 (ipfs-ns) + 0x01 (cidv1) + 0x70 (dag-pb) + 0x12 (sha2-256) + 0x20 (32 bytes) + hash
  // For CIDv1 we'd need different handling
  
  // For now, use a simple placeholder encoding that DWS gateway will understand
  // The gateway typically accepts IPFS CIDs directly
  const cidBytes = Buffer.from(cid, 'utf-8')
  return toHex(cidBytes)
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║   🔗 JNS Routing Configuration                            ║
║   Setting up cloud.jeju routing                           ║
╚═══════════════════════════════════════════════════════════╝
`)

  // Load JNS deployment
  const jnsDeployment = JSON.parse(
    readFileSync(join(DEPLOYMENTS_DIR, 'jeju-testnet-jns.json'), 'utf-8')
  )
  
  const { jnsRegistry, jnsResolver, jnsRegistrar } = jnsDeployment.contracts
  
  console.log('JNS Contracts:')
  console.log(`  Registry: ${jnsRegistry}`)
  console.log(`  Resolver: ${jnsResolver}`)
  console.log(`  Registrar: ${jnsRegistrar}`)

  const publicClient = createPublicClient({
    chain: JEJU_TESTNET,
    transport: http(process.env.RPC_URL || 'http://localhost:38545'),
  })

  const account = privateKeyToAccount(DEPLOYER_KEY as `0x${string}`)
  const walletClient = createWalletClient({
    account,
    chain: JEJU_TESTNET,
    transport: http(process.env.RPC_URL || 'http://localhost:38545'),
  })

  console.log(`\nDeployer: ${account.address}`)

  const cloudJejuHash = namehash('cloud.jeju')
  console.log(`\ncloud.jeju namehash: ${cloudJejuHash}`)

  // Check current owner
  const registryAbi = parseAbi([
    'function owner(bytes32 node) view returns (address)',
    'function resolver(bytes32 node) view returns (address)',
    'function setResolver(bytes32 node, address resolver)',
  ])

  const currentOwner = await publicClient.readContract({
    address: jnsRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'owner',
    args: [cloudJejuHash],
  })

  console.log(`Current owner of cloud.jeju: ${currentOwner}`)

  if (currentOwner === '0x0000000000000000000000000000000000000000') {
    console.log('\n⚠️  cloud.jeju has no owner. The name may not be registered properly.')
    console.log('Checking if it needs to be registered...')
    
    // Try to register it
    const registrarAbi = parseAbi([
      'function register(string name, address owner, uint256 duration) payable returns (bytes32)',
      'function rentPrice(string name, uint256 duration) view returns (uint256)',
      'function available(string name) view returns (bool)',
    ])

    const available = await publicClient.readContract({
      address: jnsRegistrar as `0x${string}`,
      abi: registrarAbi,
      functionName: 'available',
      args: ['cloud'],
    })

    if (available) {
      console.log('Registering cloud.jeju...')
      const TEN_YEARS = BigInt(10 * 365 * 24 * 60 * 60)
      const price = await publicClient.readContract({
        address: jnsRegistrar as `0x${string}`,
        abi: registrarAbi,
        functionName: 'rentPrice',
        args: ['cloud', TEN_YEARS],
      })

      const hash = await walletClient.writeContract({
        address: jnsRegistrar as `0x${string}`,
        abi: registrarAbi,
        functionName: 'register',
        args: ['cloud', account.address, TEN_YEARS],
        value: price,
        account,
      })

      await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
      console.log('✅ cloud.jeju registered')
    } else {
      console.log('cloud.jeju is not available but has no owner - checking registry again...')
    }
  }

  // Set resolver for cloud.jeju
  const currentResolver = await publicClient.readContract({
    address: jnsRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'resolver',
    args: [cloudJejuHash],
  })

  console.log(`\nCurrent resolver: ${currentResolver}`)

  if (currentResolver.toLowerCase() !== jnsResolver.toLowerCase()) {
    console.log(`Setting resolver to ${jnsResolver}...`)
    
    const hash = await walletClient.writeContract({
      address: jnsRegistry as `0x${string}`,
      abi: registryAbi,
      functionName: 'setResolver',
      args: [cloudJejuHash, jnsResolver as `0x${string}`],
      account,
    })

    await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
    console.log('✅ Resolver set')
  } else {
    console.log('✅ Resolver already set correctly')
  }

  // Set contenthash (IPFS CID)
  // Using the CID from the DWS deployment - this would be the actual IPFS hash of the static assets
  const IPFS_CID = 'QmYourActualCIDHere' // Placeholder - will be replaced with actual CID
  
  const resolverAbi = parseAbi([
    'function setContenthash(bytes32 node, bytes contenthash)',
    'function contenthash(bytes32 node) view returns (bytes)',
    'function setText(bytes32 node, string key, string value)',
    'function text(bytes32 node, string key) view returns (string)',
  ])

  // For now, set a text record with the DWS deployment info
  console.log('\nSetting DWS deployment text records...')
  
  const hash = await walletClient.writeContract({
    address: jnsResolver as `0x${string}`,
    abi: resolverAbi,
    functionName: 'setText',
    args: [cloudJejuHash, 'dws.deployment', 'eliza-cloud'],
    account,
  })

  await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
  console.log('✅ DWS deployment record set')

  // Set URL record
  const urlHash = await walletClient.writeContract({
    address: jnsResolver as `0x${string}`,
    abi: resolverAbi,
    functionName: 'setText',
    args: [cloudJejuHash, 'url', 'https://cloud.jeju.network'],
    account,
  })

  await publicClient.waitForTransactionReceipt({ hash: urlHash, timeout: 60_000 })
  console.log('✅ URL record set')

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                  JNS ROUTING CONFIGURED                   ║
╠═══════════════════════════════════════════════════════════╣
║  Name:     cloud.jeju                                     ║
║  Resolver: ${jnsResolver}  ║
║  Records:  dws.deployment = eliza-cloud                   ║
║            url = https://cloud.jeju.network               ║
╚═══════════════════════════════════════════════════════════╝
`)
}

main().catch(console.error)
