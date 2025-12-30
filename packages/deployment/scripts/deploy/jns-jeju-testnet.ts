#!/usr/bin/env bun
/**
 * JNS Deployment to Jeju Testnet
 *
 * Deploys JNS contracts to Jeju testnet (chain ID 420690)
 *
 * Usage:
 *   RPC_URL=http://localhost:6547 bun run scripts/deploy/jns-jeju-testnet.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  type Chain,
  concat,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  formatEther,
  getContractAddress,
  type Hex,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { waitForTransactionReceipt } from 'viem/actions'

const ROOT = join(import.meta.dir, '../../../..')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments')

// Jeju Testnet configuration
const JEJU_TESTNET: Chain = {
  id: 420690,
  name: 'Jeju Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL || 'http://localhost:6547'] },
  },
}

// Deployer key from testnet-deployer.json
const DEPLOYER_KEY =
  '0xe60c18754e9569e127d320f1f92bbde9722af4ed4c098087b74c8e5af91b7895'

console.log(`
╔═══════════════════════════════════════════════════════════╗
║   🏷️  JNS - Jeju Name Service Deployment                   ║
║   Network: Jeju Testnet (Chain ID: 420690)                ║
╚═══════════════════════════════════════════════════════════╝
`)

// Get compiled contract artifact
async function getArtifact(name: string) {
  const artifactPath = join(CONTRACTS_DIR, `out/${name}.sol/${name}.json`)
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}`)
  }
  return JSON.parse(readFileSync(artifactPath, 'utf-8'))
}

// Deploy a contract
async function deployContract(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  account: ReturnType<typeof privateKeyToAccount>,
  name: string,
  args: (string | bigint | Address)[] = [],
): Promise<Address> {
  console.log(`  Deploying ${name}...`)

  const artifact = await getArtifact(name)

  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
    args,
  })

  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  })

  const txHash = await walletClient.sendTransaction({
    chain: JEJU_TESTNET,
    data: deployData,
    account,
  })

  const receipt = await waitForTransactionReceipt(publicClient, {
    hash: txHash,
    timeout: 300_000, // 5 minutes - testnet can be slow
    pollingInterval: 5000,
  })

  if (receipt.status !== 'success') {
    throw new Error(`Deployment failed: ${name} (tx: ${txHash})`)
  }

  const address =
    receipt.contractAddress ||
    getContractAddress({
      from: account.address,
      nonce: BigInt(nonce),
    })

  await new Promise((resolve) => setTimeout(resolve, 2000))

  const code = await publicClient.getCode({ address })
  if (!code || code === '0x') {
    throw new Error(`Contract not found at expected address: ${address}`)
  }

  console.log(`  ✅ ${name}: ${address}`)
  return address
}

// Compute namehash
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

function labelhash(label: string): `0x${string}` {
  return keccak256(stringToHex(label))
}

async function main() {
  const publicClient = createPublicClient({
    chain: JEJU_TESTNET,
    transport: http(process.env.RPC_URL || 'http://localhost:6547'),
  })

  const account = privateKeyToAccount(DEPLOYER_KEY as `0x${string}`)
  const walletClient = createWalletClient({
    account,
    chain: JEJU_TESTNET,
    transport: http(process.env.RPC_URL || 'http://localhost:6547'),
  })

  console.log(`Deployer: ${account.address}`)
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Balance: ${formatEther(balance)} ETH\n`)

  if (balance === 0n) {
    throw new Error('Deployer has no ETH. Please fund the account first.')
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log('1️⃣  Deploying JNS Contracts...\n')

  const jnsRegistry = await deployContract(
    publicClient,
    walletClient,
    account,
    'JNSRegistry',
    [],
  )
  const jnsResolver = await deployContract(
    publicClient,
    walletClient,
    account,
    'JNSResolver',
    [jnsRegistry],
  )
  const jnsRegistrar = await deployContract(
    publicClient,
    walletClient,
    account,
    'JNSRegistrar',
    [jnsRegistry, jnsResolver, account.address],
  )
  const jnsReverseRegistrar = await deployContract(
    publicClient,
    walletClient,
    account,
    'JNSReverseRegistrar',
    [jnsRegistry, jnsResolver],
  )

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log('2️⃣  Setting Up .jeju TLD...\n')

  const registryAbi = parseAbi([
    'function setSubnodeOwner(bytes32 node, bytes32 label, address owner)',
  ])

  const rootNode = `0x${'0'.repeat(64)}` as `0x${string}`
  const jejuLabel = labelhash('jeju')

  // Grant registrar ownership of .jeju
  let hash = await walletClient.writeContract({
    address: jnsRegistry,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [rootNode, jejuLabel, jnsRegistrar],
    account,
  })
  await waitForTransactionReceipt(publicClient, {
    hash,
    timeout: 300_000,
    pollingInterval: 5000,
  })
  console.log('  ✅ .jeju TLD created and assigned to Registrar')

  // Setup reverse namespace
  console.log('  Setting up reverse namespace...')
  const reverseLabel = labelhash('reverse')
  hash = await walletClient.writeContract({
    address: jnsRegistry,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [rootNode, reverseLabel, account.address],
    account,
  })
  await waitForTransactionReceipt(publicClient, {
    hash,
    timeout: 300_000,
    pollingInterval: 5000,
  })

  const reverseNode = namehash('reverse')
  const addrLabel = labelhash('addr')
  hash = await walletClient.writeContract({
    address: jnsRegistry,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [reverseNode, addrLabel, jnsReverseRegistrar],
    account,
  })
  await waitForTransactionReceipt(publicClient, {
    hash,
    timeout: 300_000,
    pollingInterval: 5000,
  })
  console.log('  ✅ addr.reverse namespace created')

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log('3️⃣  Registering Canonical Names...\n')

  const registrarAbi = parseAbi([
    'function register(string name, address owner, uint256 duration) payable returns (bytes32)',
    'function rentPrice(string name, uint256 duration) view returns (uint256)',
    'function available(string name) view returns (bool)',
  ])

  // Resolver ABI for future use in contenthash setting
  // const resolverAbi = parseAbi([
  //   'function setContenthash(bytes32 node, bytes contenthash)',
  // ])

  const TEN_YEARS = BigInt(10 * 365 * 24 * 60 * 60)
  const namesToRegister = [
    'cloud',
    'dws',
    'gateway',
    'bazaar',
    'crucible',
    'factory',
    'autocrat',
    'babylon',
  ]

  for (const name of namesToRegister) {
    console.log(`  Registering ${name}.jeju...`)

    const available = await publicClient.readContract({
      address: jnsRegistrar,
      abi: registrarAbi,
      functionName: 'available',
      args: [name],
    })

    if (!available) {
      console.log(`    Already registered`)
      continue
    }

    const price = await publicClient.readContract({
      address: jnsRegistrar,
      abi: registrarAbi,
      functionName: 'rentPrice',
      args: [name, TEN_YEARS],
    })

    hash = await walletClient.writeContract({
      address: jnsRegistrar,
      abi: registrarAbi,
      functionName: 'register',
      args: [name, account.address, TEN_YEARS],
      value: price,
      account,
    })
    await waitForTransactionReceipt(publicClient, {
      hash,
      timeout: 300_000,
      pollingInterval: 5000,
    })
    console.log(`  ✅ ${name}.jeju registered`)
  }

  // Save deployment
  const deployment = {
    network: 'jeju-testnet',
    chainId: 420690,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    contracts: {
      jnsRegistry,
      jnsResolver,
      jnsRegistrar,
      jnsReverseRegistrar,
    },
  }

  const outputPath = join(DEPLOYMENTS_DIR, 'jeju-testnet-jns.json')
  writeFileSync(outputPath, JSON.stringify(deployment, null, 2))
  console.log(`\n✅ Deployment saved to ${outputPath}`)

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                  JNS DEPLOYMENT COMPLETE                  ║
╠═══════════════════════════════════════════════════════════╣
║  JNSRegistry:         ${jnsRegistry}  ║
║  JNSResolver:         ${jnsResolver}  ║
║  JNSRegistrar:        ${jnsRegistrar}  ║
║  JNSReverseRegistrar: ${jnsReverseRegistrar}  ║
╚═══════════════════════════════════════════════════════════╝
  `)
}

main().catch(console.error)
