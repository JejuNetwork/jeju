#!/usr/bin/env bun
/**
 * TEE Attestation for Testnet/Mainnet Deployments
 *
 * Manages Trusted Execution Environment attestation for DWS nodes.
 * Supports:
 * - Intel TDX (Trust Domain Extensions)
 * - Intel SGX (Software Guard Extensions)
 * - AMD SEV-SNP (Secure Encrypted Virtualization)
 * - NVIDIA Confidential Computing
 *
 * Architecture:
 * 1. Node registers with TEE capabilities
 * 2. Attestation is generated and verified on-chain
 * 3. Verified nodes can run high-risk workloads (keys, secrets, ML training)
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/deploy/tee-attestation.ts
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  toBytes,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { getRequiredNetwork, type NetworkType } from '../shared'

const ROOT = join(import.meta.dir, '../../../..')
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments')

// TEE Platform Types
type TEEPlatform =
  | 'intel-tdx'
  | 'intel-sgx'
  | 'amd-sev-snp'
  | 'nvidia-cc'
  | 'none'

interface TEEAttestation {
  platform: TEEPlatform
  quote: Hex
  mrEnclave: Hex
  mrSigner: Hex
  reportData: Hex
  timestamp: number
  pcrValues?: Hex[]
  signature: Hex
  certificateChain?: string[]
}

interface TEENodeConfig {
  nodeId: string
  address: Address
  endpoint: string
  platform: TEEPlatform
  region: string
  capabilities: string[]
}

interface AttestationResult {
  nodeId: string
  platform: TEEPlatform
  verified: boolean
  attestation: TEEAttestation | null
  registeredOnChain: boolean
  txHash?: string
  error?: string
}

// DWS Endpoints
const DWS_ENDPOINTS: Record<NetworkType, string> = {
  localnet: 'http://localhost:4030',
  testnet: 'https://dws.testnet.jejunetwork.org',
  mainnet: 'https://dws.jejunetwork.org',
}

// Network Configuration
const NETWORK_CONFIG: Record<
  NetworkType,
  { rpcUrl: string; chain: typeof base | typeof baseSepolia }
> = {
  localnet: {
    rpcUrl: 'http://localhost:6546',
    chain: baseSepolia, // Use baseSepolia config for localnet
  },
  testnet: {
    rpcUrl: 'https://sepolia.base.org',
    chain: baseSepolia,
  },
  mainnet: {
    rpcUrl: 'https://mainnet.base.org',
    chain: base,
  },
}

// TEE Registry Contract ABI
const TEE_REGISTRY_ABI = [
  {
    name: 'registerTEENode',
    type: 'function',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'platform', type: 'uint8' },
      { name: 'quote', type: 'bytes' },
      { name: 'mrEnclave', type: 'bytes32' },
      { name: 'mrSigner', type: 'bytes32' },
      { name: 'reportData', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'verifyAttestation',
    type: 'function',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'quote', type: 'bytes' },
    ],
    outputs: [{ name: 'valid', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'getNodeAttestation',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'platform', type: 'uint8' },
          { name: 'mrEnclave', type: 'bytes32' },
          { name: 'mrSigner', type: 'bytes32' },
          { name: 'verified', type: 'bool' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastVerifiedAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

// Platform to uint8 mapping
const PLATFORM_TO_UINT8: Record<TEEPlatform, number> = {
  none: 0,
  'intel-sgx': 1,
  'intel-tdx': 2,
  'amd-sev-snp': 3,
  'nvidia-cc': 4,
}

/**
 * Generate TEE attestation for a node
 */
async function generateAttestation(
  node: TEENodeConfig,
  network: NetworkType,
): Promise<TEEAttestation> {
  console.log(
    `  Generating attestation for ${node.nodeId} (${node.platform})...`,
  )

  // For localnet/testnet without real TEE, generate simulated attestation
  if (network === 'localnet' || !hasRealTEEHardware(node.platform)) {
    return generateSimulatedAttestation(node)
  }

  // For real TEE hardware, use platform-specific attestation
  switch (node.platform) {
    case 'intel-tdx':
      return generateIntelTDXAttestation(node)
    case 'intel-sgx':
      return generateIntelSGXAttestation(node)
    case 'amd-sev-snp':
      return generateAMDSEVAttestation(node)
    case 'nvidia-cc':
      return generateNVIDIACCAttestation(node)
    default:
      return generateSimulatedAttestation(node)
  }
}

/**
 * Check if real TEE hardware is available
 */
function hasRealTEEHardware(platform: TEEPlatform): boolean {
  if (platform === 'none') return false

  // Check environment variable for TEE availability
  const teeEnv = process.env.TEE_HARDWARE_AVAILABLE
  if (teeEnv === 'true') return true
  if (teeEnv === 'false') return false

  // Try to detect hardware
  switch (platform) {
    case 'intel-tdx': {
      // Check for TDX support via /dev/tdx_guest or cpuid
      const hasTdxDevice = existsSync('/dev/tdx_guest')
      return hasTdxDevice
    }
    case 'intel-sgx': {
      // Check for SGX support
      const hasSgxDevice =
        existsSync('/dev/sgx_enclave') || existsSync('/dev/isgx')
      return hasSgxDevice
    }
    case 'amd-sev-snp': {
      // Check for SEV-SNP support
      const hasSevDevice = existsSync('/dev/sev-guest')
      return hasSevDevice
    }
    case 'nvidia-cc': {
      // Check for NVIDIA CC support (H100/H200 with CC mode)
      const hasNvidiaCc = existsSync('/dev/nvidia-cc')
      return hasNvidiaCc
    }
    default:
      return false
  }
}

/**
 * Generate simulated attestation for testing
 */
function generateSimulatedAttestation(node: TEENodeConfig): TEEAttestation {
  const timestamp = Date.now()
  const nodeIdBytes = toBytes(node.nodeId, { size: 32 })
  const mrEnclave = keccak256(
    toBytes(`${node.nodeId}:${node.platform}:${timestamp}`),
  )
  const mrSigner = keccak256(toBytes(node.address))
  const reportData = keccak256(toBytes(`${mrEnclave}:${mrSigner}:${timestamp}`))

  // Simulate quote (in real TEE, this comes from hardware)
  const quoteData = new Uint8Array(256)
  const encoder = new TextEncoder()
  const header = encoder.encode('SIMULATED_TEE_QUOTE_V1')
  quoteData.set(header)
  quoteData.set(nodeIdBytes, 32)

  const signature = keccak256(
    toBytes(`${mrEnclave}:${mrSigner}:${reportData}:${timestamp}`),
  )

  return {
    platform: node.platform,
    quote: toHex(quoteData),
    mrEnclave,
    mrSigner,
    reportData,
    timestamp,
    signature,
  }
}

/**
 * Generate Intel TDX attestation
 */
async function generateIntelTDXAttestation(
  node: TEENodeConfig,
): Promise<TEEAttestation> {
  // Use Intel TDX tooling to generate attestation
  // This requires running inside a TDX VM
  const reportData = keccak256(toBytes(`${node.nodeId}:${Date.now()}`))

  const tdxQuote = execSync(`tdx-cli quote --report-data ${reportData}`, {
    encoding: 'utf-8',
  }).trim()

  const quoteData = JSON.parse(tdxQuote) as {
    quote: string
    mr_td: string
    mr_config_id: string
    td_attributes: string
  }

  return {
    platform: 'intel-tdx',
    quote: quoteData.quote as Hex,
    mrEnclave: quoteData.mr_td as Hex,
    mrSigner: quoteData.mr_config_id as Hex,
    reportData,
    timestamp: Date.now(),
    signature: keccak256(toBytes(quoteData.quote)),
  }
}

/**
 * Generate Intel SGX attestation
 */
async function generateIntelSGXAttestation(
  node: TEENodeConfig,
): Promise<TEEAttestation> {
  // Use Intel SGX SDK to generate attestation
  const reportData = keccak256(toBytes(`${node.nodeId}:${Date.now()}`))

  const sgxQuote = execSync(`sgx-quote generate --report-data ${reportData}`, {
    encoding: 'utf-8',
  }).trim()

  const quoteData = JSON.parse(sgxQuote) as {
    quote: string
    mrenclave: string
    mrsigner: string
  }

  return {
    platform: 'intel-sgx',
    quote: quoteData.quote as Hex,
    mrEnclave: quoteData.mrenclave as Hex,
    mrSigner: quoteData.mrsigner as Hex,
    reportData,
    timestamp: Date.now(),
    signature: keccak256(toBytes(quoteData.quote)),
  }
}

/**
 * Generate AMD SEV-SNP attestation
 */
async function generateAMDSEVAttestation(
  node: TEENodeConfig,
): Promise<TEEAttestation> {
  const reportData = keccak256(toBytes(`${node.nodeId}:${Date.now()}`))

  const sevReport = execSync(
    `sev-guest-get-report --report-data ${reportData}`,
    { encoding: 'utf-8' },
  ).trim()

  const reportBytes = Buffer.from(sevReport, 'hex')

  return {
    platform: 'amd-sev-snp',
    quote: toHex(reportBytes),
    mrEnclave: keccak256(reportBytes.slice(0, 48)),
    mrSigner: keccak256(reportBytes.slice(48, 96)),
    reportData,
    timestamp: Date.now(),
    signature: keccak256(toBytes(sevReport)),
  }
}

/**
 * Generate NVIDIA Confidential Computing attestation
 */
async function generateNVIDIACCAttestation(
  node: TEENodeConfig,
): Promise<TEEAttestation> {
  const reportData = keccak256(toBytes(`${node.nodeId}:${Date.now()}`))

  // Use NVIDIA attestation SDK
  const ccReport = execSync(
    `nvidia-cc-attestation --report-data ${reportData}`,
    { encoding: 'utf-8' },
  ).trim()

  const reportJson = JSON.parse(ccReport) as {
    attestation: string
    measurement: string
    cert_chain: string[]
  }

  return {
    platform: 'nvidia-cc',
    quote: reportJson.attestation as Hex,
    mrEnclave: keccak256(toBytes(reportJson.measurement)),
    mrSigner: keccak256(toBytes(reportJson.cert_chain[0])),
    reportData,
    timestamp: Date.now(),
    certificateChain: reportJson.cert_chain,
    signature: keccak256(toBytes(reportJson.attestation)),
  }
}

/**
 * Register attestation with DWS
 */
async function registerWithDWS(
  node: TEENodeConfig,
  attestation: TEEAttestation,
  network: NetworkType,
  privateKey: string,
): Promise<{ success: boolean; nodeId: string }> {
  const dwsEndpoint = DWS_ENDPOINTS[network]
  const account = privateKeyToAccount(privateKey as `0x${string}`)

  const timestamp = Date.now()
  const message = JSON.stringify({
    nodeId: node.nodeId,
    attestation,
    timestamp,
  })
  const signature = await account.signMessage({ message })

  const response = await fetch(`${dwsEndpoint}/containers/nodes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': signature,
      'X-Timestamp': timestamp.toString(),
      'X-Address': account.address,
    },
    body: JSON.stringify({
      nodeId: node.nodeId,
      address: node.address,
      endpoint: node.endpoint,
      region: node.region,
      totalCpu: 64,
      totalMemoryMb: 512 * 1024,
      totalStorageMb: 2 * 1024 * 1024,
      capabilities: ['tee', node.platform, ...node.capabilities],
      gpuTypes: [],
      attestation,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to register with DWS: ${error}`)
  }

  return { success: true, nodeId: node.nodeId }
}

/**
 * Register attestation on-chain
 */
async function registerOnChain(
  node: TEENodeConfig,
  attestation: TEEAttestation,
  network: NetworkType,
  privateKey: string,
  teeRegistryAddress: Address,
): Promise<{ success: boolean; txHash: string }> {
  const config = NETWORK_CONFIG[network]
  const account = privateKeyToAccount(privateKey as `0x${string}`)

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
  })

  const nodeIdBytes = keccak256(toBytes(node.nodeId))
  const platformUint8 = PLATFORM_TO_UINT8[attestation.platform]

  const { request } = await publicClient.simulateContract({
    address: teeRegistryAddress,
    abi: TEE_REGISTRY_ABI,
    functionName: 'registerTEENode',
    args: [
      nodeIdBytes,
      platformUint8,
      attestation.quote as `0x${string}`,
      attestation.mrEnclave,
      attestation.mrSigner,
      attestation.reportData as `0x${string}`,
    ],
    account,
  })

  const txHash = await walletClient.writeContract(request)
  await publicClient.waitForTransactionReceipt({ hash: txHash })

  return { success: true, txHash }
}

/**
 * Verify attestation on-chain
 */
async function verifyOnChain(
  nodeId: string,
  attestation: TEEAttestation,
  network: NetworkType,
  teeRegistryAddress: Address,
): Promise<boolean> {
  const config = NETWORK_CONFIG[network]

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  })

  const nodeIdBytes = keccak256(toBytes(nodeId))

  const result = await publicClient.readContract({
    address: teeRegistryAddress,
    abi: TEE_REGISTRY_ABI,
    functionName: 'verifyAttestation',
    args: [nodeIdBytes, attestation.quote as `0x${string}`],
  })

  return result
}

/**
 * Main entry point
 */
async function main() {
  const network = getRequiredNetwork()
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  const teeRegistryAddress = process.env.TEE_REGISTRY_ADDRESS as
    | Address
    | undefined

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              TEE ATTESTATION DEPLOYMENT                      ║
╠══════════════════════════════════════════════════════════════╣
║  Network: ${network.padEnd(50)}║
║  TEE Registry: ${(teeRegistryAddress || 'Not set').slice(0, 45).padEnd(45)}║
╚══════════════════════════════════════════════════════════════╝
`)

  // Load node configurations from deployment or generate defaults
  const outputDir = join(DEPLOYMENTS_DIR, 'tee-nodes')
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Default TEE nodes for testnet
  const defaultNodes: TEENodeConfig[] = [
    {
      nodeId: `dws-tee-${network}-1`,
      address: '0x0000000000000000000000000000000000000001' as Address,
      endpoint: `https://dws-node-1.${network}.jejunetwork.org`,
      platform: 'intel-tdx',
      region: 'us-east-1',
      capabilities: ['compute', 'storage', 'container'],
    },
    {
      nodeId: `dws-tee-${network}-2`,
      address: '0x0000000000000000000000000000000000000002' as Address,
      endpoint: `https://dws-node-2.${network}.jejunetwork.org`,
      platform: 'intel-tdx',
      region: 'eu-west-1',
      capabilities: ['compute', 'storage', 'container'],
    },
    {
      nodeId: `dws-tee-${network}-3`,
      address: '0x0000000000000000000000000000000000000003' as Address,
      endpoint: `https://dws-node-3.${network}.jejunetwork.org`,
      platform: 'amd-sev-snp',
      region: 'ap-northeast-1',
      capabilities: ['compute', 'storage', 'container'],
    },
  ]

  // Load or use default nodes
  const nodesFile = join(outputDir, `${network}-nodes.json`)
  const nodes: TEENodeConfig[] = existsSync(nodesFile)
    ? JSON.parse(readFileSync(nodesFile, 'utf-8'))
    : defaultNodes

  console.log(`\nProcessing ${nodes.length} TEE nodes:`)

  const results: AttestationResult[] = []

  for (const node of nodes) {
    console.log(`\n  Node: ${node.nodeId}`)
    console.log(`    Platform: ${node.platform}`)
    console.log(`    Endpoint: ${node.endpoint}`)

    const result: AttestationResult = {
      nodeId: node.nodeId,
      platform: node.platform,
      verified: false,
      attestation: null,
      registeredOnChain: false,
    }

    // Generate attestation
    const attestation = await generateAttestation(node, network)
    result.attestation = attestation
    console.log(
      `    Attestation generated: ${attestation.mrEnclave.slice(0, 20)}...`,
    )

    // Register with DWS
    if (privateKey) {
      const dwsResult = await registerWithDWS(
        node,
        attestation,
        network,
        privateKey,
      )
      console.log(
        `    Registered with DWS: ${dwsResult.success ? 'Yes' : 'No'}`,
      )
    } else {
      console.log('    Skipping DWS registration (no PRIVATE_KEY)')
    }

    // Register on-chain if registry address is set
    if (teeRegistryAddress && privateKey) {
      const onChainResult = await registerOnChain(
        node,
        attestation,
        network,
        privateKey,
        teeRegistryAddress,
      )
      result.registeredOnChain = onChainResult.success
      result.txHash = onChainResult.txHash
      console.log(
        `    Registered on-chain: ${onChainResult.txHash.slice(0, 20)}...`,
      )

      // Verify on-chain
      const verified = await verifyOnChain(
        node.nodeId,
        attestation,
        network,
        teeRegistryAddress,
      )
      result.verified = verified
      console.log(`    Verified on-chain: ${verified ? 'Yes' : 'No'}`)
    } else {
      console.log(
        '    Skipping on-chain registration (no TEE_REGISTRY_ADDRESS)',
      )
    }

    results.push(result)
  }

  // Save results
  const resultsFile = join(outputDir, `${network}-attestations.json`)
  writeFileSync(
    resultsFile,
    JSON.stringify(
      {
        network,
        timestamp: new Date().toISOString(),
        nodes: results,
      },
      null,
      2,
    ),
  )

  // Summary
  const verified = results.filter((r) => r.verified).length
  const registered = results.filter((r) => r.registeredOnChain).length
  const withAttestation = results.filter((r) => r.attestation).length

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    ATTESTATION SUMMARY                       ║
╠══════════════════════════════════════════════════════════════╣
║  Total Nodes:        ${String(results.length).padEnd(38)}║
║  With Attestation:   ${String(withAttestation).padEnd(38)}║
║  Registered On-Chain:${String(registered).padEnd(39)}║
║  Verified:           ${String(verified).padEnd(38)}║
╠══════════════════════════════════════════════════════════════╣
║  Results: ${resultsFile.slice(-48).padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝
`)

  if (!teeRegistryAddress) {
    console.log(`
TEE_REGISTRY_ADDRESS not set. To enable on-chain registration:
  1. Deploy TEERegistry contract: bun run forge script DeployTEE.s.sol
  2. Set TEE_REGISTRY_ADDRESS environment variable
  3. Re-run this script
`)
  }
}

main().catch((error) => {
  console.error('TEE attestation failed:', error)
  process.exit(1)
})

export {
  generateAttestation,
  registerWithDWS,
  registerOnChain,
  verifyOnChain,
  type TEEAttestation,
  type TEENodeConfig,
  type TEEPlatform,
}
