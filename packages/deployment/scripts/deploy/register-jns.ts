#!/usr/bin/env bun

/**
 * JNS Name Registration Script
 *
 * Registers Jeju Name Service names for all applications and sets
 * their content hashes to point to the uploaded frontends.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  concat,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  keccak256,
  toBytes,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import type {
  DeployPublicClient,
  DeployWalletClient,
} from '../shared/viem-chains'

// Configuration

interface JNSConfig {
  name: string
  label: string
  contentCid?: string
  address?: Address
  text?: Record<string, string>
}

interface JNSRegistrationResult {
  name: string
  node: Hex
  registered: boolean
  contentHashSet: boolean
  txHash?: string
  error?: string
}

const ROOT_DIR = join(import.meta.dir, '../..')
const APPS_DIR = join(ROOT_DIR, 'apps')
const TEN_YEARS = BigInt(10 * 365 * 24 * 60 * 60)

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
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'rentPrice',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const JNS_RESOLVER_ABI = [
  {
    name: 'setAddr',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'addr', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
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
] as const

// JNS Registrar Class

class JNSRegistrar {
  private network: 'testnet' | 'mainnet'
  private privateKey: Hex
  private account: ReturnType<typeof privateKeyToAccount>
  private publicClient: DeployPublicClient
  private walletClient: DeployWalletClient
  private registrarAddress: Address
  private resolverAddress: Address
  private results: JNSRegistrationResult[] = []

  constructor(network: 'testnet' | 'mainnet' = 'testnet') {
    this.network = network
    this.privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex

    if (!this.privateKey) {
      throw new Error('DEPLOYER_PRIVATE_KEY environment variable required')
    }

    const chain = network === 'mainnet' ? base : baseSepolia
    const rpcUrl =
      network === 'mainnet'
        ? process.env.MAINNET_RPC_URL || 'https://mainnet.base.org'
        : process.env.TESTNET_RPC_URL || 'https://sepolia.base.org'

    this.account = privateKeyToAccount(this.privateKey)
    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as DeployPublicClient
    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(rpcUrl),
    }) as DeployWalletClient

    // Load contract addresses
    const addressesPath = join(
      ROOT_DIR,
      'packages/contracts/deployments',
      network,
      'addresses.json',
    )
    if (!existsSync(addressesPath)) {
      throw new Error(
        `Deployment addresses not found at ${addressesPath}. Run deployment first.`,
      )
    }
    const addresses = JSON.parse(readFileSync(addressesPath, 'utf-8'))
    this.registrarAddress = addresses.jnsRegistrar as Address
    this.resolverAddress = addresses.jnsResolver as Address
  }

  async run(): Promise<JNSRegistrationResult[]> {
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║          JEJU NAME SERVICE REGISTRATION                              ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')
    console.log(`Network: ${this.network}`)
    console.log(`Registrar: ${this.registrarAddress}`)
    console.log(`Resolver: ${this.resolverAddress}`)
    console.log(`Deployer: ${this.account.address}`)
    console.log('')

    // Check balance
    const balance = await this.publicClient.getBalance({
      address: this.account.address,
    })
    console.log(`Balance: ${formatEther(balance)} ETH`)
    console.log('')

    // Collect all JNS names to register
    const names = this.collectNames()
    console.log(`Found ${names.length} names to register`)
    console.log('')

    // Register each name
    for (const name of names) {
      console.log(
        '═══════════════════════════════════════════════════════════════════════',
      )
      console.log(`Registering: ${name.name}`)
      console.log(
        '═══════════════════════════════════════════════════════════════════════',
      )

      const result = await this.registerName(name)
      this.results.push(result)
      console.log('')
    }

    // Save results
    this.saveResults()

    // Print summary
    this.printSummary()

    return this.results
  }

  private collectNames(): JNSConfig[] {
    const names: JNSConfig[] = []

    // Core infrastructure names
    const coreNames = [
      {
        name: 'dws.jeju',
        label: 'dws',
        text: { description: 'Decentralized Web Services' },
      },
      {
        name: 'git.jeju',
        label: 'git',
        text: { description: 'JejuGit - Decentralized Git Hosting' },
      },
      {
        name: 'npm.jeju',
        label: 'npm',
        text: { description: 'JejuPkg - Decentralized Package Registry' },
      },
      {
        name: 'hub.jeju',
        label: 'hub',
        text: { description: 'JejuHub - Decentralized Model Registry' },
      },
      {
        name: 'registry.jeju',
        label: 'registry',
        text: { description: 'Container Registry' },
      },
      {
        name: 'storage.jeju',
        label: 'storage',
        text: { description: 'Decentralized Storage' },
      },
      {
        name: 'ipfs.jeju',
        label: 'ipfs',
        text: { description: 'IPFS Gateway' },
      },
      {
        name: 'docs.jeju',
        label: 'docs',
        text: { description: 'Documentation' },
      },
    ]

    for (const core of coreNames) {
      names.push({
        name: core.name,
        label: core.label,
        text: core.text,
      })
    }

    // Load frontend upload results if available
    const frontendResultPath = join(
      ROOT_DIR,
      `frontend-upload-result-${this.network}.json`,
    )
    if (existsSync(frontendResultPath)) {
      const frontendResults = JSON.parse(
        readFileSync(frontendResultPath, 'utf-8'),
      )
      for (const result of frontendResults) {
        if (result.jnsName) {
          const label = result.jnsName.replace('.jeju', '')
          const existing = names.find((n) => n.label === label)
          if (existing) {
            existing.contentCid = result.indexCid
          } else {
            names.push({
              name: result.jnsName,
              label,
              contentCid: result.indexCid,
            })
          }
        }
      }
    }

    // Load from app manifests
    const appDirs = readdirSync(APPS_DIR)
    for (const dir of appDirs) {
      const manifestPath = join(APPS_DIR, dir, 'jeju-manifest.json')
      if (!existsSync(manifestPath)) continue

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      if (manifest.jns?.name) {
        const label = manifest.jns.name.replace('.jeju', '')
        const existing = names.find((n) => n.label === label)
        if (!existing) {
          names.push({
            name: manifest.jns.name,
            label,
            text: { description: manifest.description || `Jeju ${dir}` },
          })
        }
      }
    }

    return names
  }

  private async registerName(
    config: JNSConfig,
  ): Promise<JNSRegistrationResult> {
    const result: JNSRegistrationResult = {
      name: config.name,
      node: this.namehash(config.name),
      registered: false,
      contentHashSet: false,
    }

    // Check availability
    const available = await this.publicClient.readContract({
      address: this.registrarAddress,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'available',
      args: [config.label],
    })

    if (!available) {
      console.log(`  ⏭️  Name already registered`)
      result.registered = true

      // Still try to set content hash if provided
      if (config.contentCid) {
        await this.setContentHash(result.node, config.contentCid)
        result.contentHashSet = true
      }

      return result
    }

    // Get price
    const price = await this.publicClient.readContract({
      address: this.registrarAddress,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'rentPrice',
      args: [config.label, TEN_YEARS],
    })

    console.log(`  Price for 10 years: ${formatEther(price)} ETH`)

    // Register
    const hash = await this.walletClient.writeContract({
      address: this.registrarAddress,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'register',
      args: [config.label, this.account.address, TEN_YEARS],
      value: price,
    })

    await this.publicClient.waitForTransactionReceipt({ hash })
    console.log(`  ✅ Registered: ${hash}`)
    result.registered = true
    result.txHash = hash

    // Set content hash if provided
    if (config.contentCid) {
      await this.setContentHash(result.node, config.contentCid)
      result.contentHashSet = true
    }

    // Set text records if provided
    if (config.text) {
      for (const [key, value] of Object.entries(config.text)) {
        await this.setText(result.node, key, value)
      }
    }

    // Set address if provided
    if (config.address) {
      await this.setAddr(result.node, config.address)
    }

    return result
  }

  private async setContentHash(node: Hex, cid: string): Promise<void> {
    console.log(`  Setting content hash: ${cid}`)

    const contenthash = this.encodeContenthash(cid)

    const hash = await this.walletClient.writeContract({
      address: this.resolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setContenthash',
      args: [node, contenthash],
    })

    await this.publicClient.waitForTransactionReceipt({ hash })
    console.log(`  ✅ Content hash set: ${hash}`)
  }

  private async setText(node: Hex, key: string, value: string): Promise<void> {
    console.log(`  Setting text record: ${key}`)

    const hash = await this.walletClient.writeContract({
      address: this.resolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setText',
      args: [node, key, value],
    })

    await this.publicClient.waitForTransactionReceipt({ hash })
  }

  private async setAddr(node: Hex, addr: Address): Promise<void> {
    console.log(`  Setting address: ${addr}`)

    const hash = await this.walletClient.writeContract({
      address: this.resolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setAddr',
      args: [node, addr],
    })

    await this.publicClient.waitForTransactionReceipt({ hash })
  }

  private namehash(name: string): Hex {
    let node =
      '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
    if (name) {
      const labels = name.split('.').reverse()
      for (const label of labels) {
        const labelHash = keccak256(toBytes(label))
        node = keccak256(concat([toBytes(node), toBytes(labelHash)]))
      }
    }
    return node
  }

  private encodeContenthash(cid: string): Hex {
    // IPFS CIDv1 content hash encoding
    // Format: 0xe3010170 + CID bytes
    // e3 = IPFS namespace
    // 01 = CIDv1
    // 01 = dag-pb
    // 70 = sha2-256

    // For simplicity, we encode the CID string directly
    // In production, would properly decode and encode the CID
    const cidBytes = new TextEncoder().encode(cid)
    const prefix = new Uint8Array([0xe3, 0x01, 0x01, 0x70])
    const combined = new Uint8Array(prefix.length + cidBytes.length)
    combined.set(prefix)
    combined.set(cidBytes, prefix.length)

    return toHex(combined)
  }

  private saveResults(): void {
    const resultPath = join(
      ROOT_DIR,
      `jns-registration-result-${this.network}.json`,
    )
    writeFileSync(resultPath, JSON.stringify(this.results, null, 2))
    console.log(`Results saved to: ${resultPath}`)
  }

  private printSummary(): void {
    console.log('')
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║                    REGISTRATION COMPLETE                             ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')

    console.log('Registered Names:')
    for (const result of this.results) {
      const status = result.registered ? '✅' : '❌'
      const contentStatus = result.contentHashSet ? ' (content hash set)' : ''
      console.log(`  ${status} ${result.name}${contentStatus}`)
      console.log(`     Node: ${result.node}`)
    }
    console.log('')

    const successCount = this.results.filter((r) => r.registered).length
    console.log(`Total: ${successCount}/${this.results.length} registered`)
    console.log('')

    console.log('Access via:')
    for (const result of this.results) {
      if (result.registered) {
        console.log(`  https://${result.name}`)
      }
    }
    console.log('')
  }
}

// CLI Entry Point

async function main() {
  const network = (process.argv[2] || 'testnet') as 'testnet' | 'mainnet'
  const registrar = new JNSRegistrar(network)
  await registrar.run()
}

main().catch((err) => {
  console.error('Registration failed:', err)
  process.exit(1)
})

export { JNSRegistrar, type JNSRegistrationResult }
