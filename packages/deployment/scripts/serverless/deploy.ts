#!/usr/bin/env bun

/**
 * Serverless Deployment Script
 *
 * Orchestrates the complete deployment of serverless apps:
 * 1. Discovers all apps with serverless configuration
 * 2. Builds workers for workerd compatibility
 * 3. Uploads frontends to IPFS/Arweave
 * 4. Registers workers with DWS
 * 5. Updates JNS records
 * 6. Runs verification tests
 *
 * Usage:
 *   bun run scripts/serverless/deploy.ts                # Deploy to localnet
 *   bun run scripts/serverless/deploy.ts --testnet      # Deploy to testnet
 *   bun run scripts/serverless/deploy.ts --mainnet      # Deploy to mainnet
 *   bun run scripts/serverless/deploy.ts --app bazaar   # Deploy specific app
 *   bun run scripts/serverless/deploy.ts --verify       # Only run verification
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { extname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  namehash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry } from 'viem/chains'
import { z } from 'zod'
import { discoverAllApps } from '../shared/discover-apps'
import {
  type AppDeploymentState,
  type DeploymentManifest,
  parseServerlessConfig,
  type ServerlessAppConfig,
  type VerificationResult,
  validateServerlessConfig,
} from './types'

// API response schemas
const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
})

const WorkerRegistrationResponseSchema = z.object({
  workerId: z.string(),
})

const DeploymentAddressesSchema = z.record(z.string(), z.string())

import { WorkerBuilder } from './worker-builder'

// Types

interface DeployContext {
  network: 'localnet' | 'testnet' | 'mainnet'
  rootDir: string
  rpcUrl: string
  dwsEndpoint: string
  ipfsApiUrl: string
  privateKey: Hex
  deployer: Address
  contracts: {
    jnsRegistry: Address
    jnsResolver: Address
    jnsRegistrar: Address
    identityRegistry: Address
  }
}

interface UploadedFile {
  path: string
  relativePath: string
  cid: string
  size: number
  hash: string
  mimeType: string
}

// MIME Types

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json',
}

// Contract ABIs

const JNS_RESOLVER_ABI = [
  {
    name: 'setContenthash',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'contenthash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const

// Main Deployment Class

class ServerlessDeployer {
  private ctx: DeployContext
  private results: AppDeploymentState[] = []
  private workerBuilder: WorkerBuilder

  constructor(ctx: DeployContext) {
    this.ctx = ctx
    this.workerBuilder = new WorkerBuilder(ctx.rootDir)
  }

  /**
   * Run the full deployment
   */
  async deploy(targetApp?: string): Promise<DeploymentManifest> {
    this.printHeader()

    // Step 1: Discover apps
    console.log('\n1. Discovering serverless apps...')
    const apps = this.discoverServerlessApps(targetApp)
    console.log(`   Found ${apps.length} app(s) with serverless configuration`)

    if (apps.length === 0) {
      console.log('   No apps to deploy.')
      return this.createManifest()
    }

    // Step 2: Build and deploy each app
    for (const { path, config } of apps) {
      console.log(`\n${'─'.repeat(60)}`)
      console.log(`Deploying: ${config.name}`)
      console.log(`${'─'.repeat(60)}`)

      const state = await this.deployApp(path, config)
      this.results.push(state)
    }

    // Step 3: Run verification
    console.log('\n3. Running verification...')
    await this.verifyDeployments()

    // Step 4: Save manifest
    const manifest = this.createManifest()
    this.saveManifest(manifest)

    // Step 5: Print summary
    this.printSummary()

    return manifest
  }

  /**
   * Discover all apps with serverless configuration
   */
  private discoverServerlessApps(
    targetApp?: string,
  ): Array<{ path: string; config: ServerlessAppConfig }> {
    const allApps = discoverAllApps(this.ctx.rootDir)
    const serverlessApps: Array<{ path: string; config: ServerlessAppConfig }> =
      []

    for (const app of allApps) {
      // Filter by target app if specified
      if (targetApp && app.name !== targetApp) {
        continue
      }

      // Try to parse serverless config from manifest
      const config = parseServerlessConfig(
        app.manifest as Record<string, unknown>,
      )
      if (!config) {
        continue
      }

      // Validate config
      const validation = validateServerlessConfig(config)
      if (!validation.valid) {
        console.warn(
          `   Warning: ${app.name} has invalid config: ${validation.errors.join(', ')}`,
        )
        continue
      }

      serverlessApps.push({ path: app.path, config })
    }

    return serverlessApps
  }

  /**
   * Deploy a single app
   */
  private async deployApp(
    appPath: string,
    config: ServerlessAppConfig,
  ): Promise<AppDeploymentState> {
    const state: AppDeploymentState = {
      name: config.name,
      jnsName: config.jnsName,
      status: 'pending',
      deployedAt: Date.now(),
    }

    // Deploy worker if configured
    if (config.worker) {
      console.log('\n   Building worker...')
      const workerState = await this.deployWorker(appPath, config)
      state.worker = workerState

      if (workerState && workerState.status === 'error') {
        state.status = 'error'
        state.error = workerState.error
        return state
      }
    }

    // Deploy frontend if configured
    if (config.frontend) {
      console.log('\n   Building frontend...')
      const frontendState = await this.deployFrontend(appPath, config)
      state.frontend = frontendState
    }

    // Update JNS records
    if (state.frontend?.ipfsCid) {
      console.log('\n   Updating JNS...')
      const jnsNode = await this.updateJNS(
        config.jnsName,
        state.frontend.ipfsCid,
      )
      state.jnsNode = jnsNode
    }

    state.status =
      state.worker?.status === 'active' || state.frontend?.ipfsCid
        ? 'complete'
        : 'partial'

    return state
  }

  /**
   * Deploy a worker
   */
  private async deployWorker(
    appPath: string,
    config: ServerlessAppConfig,
  ): Promise<AppDeploymentState['worker']> {
    const workerConfig = config.worker
    if (!workerConfig) {
      throw new Error('No worker config')
    }

    // Build the worker
    const buildOutput = await this.workerBuilder.build(appPath, workerConfig)

    console.log(`   Built: ${(buildOutput.size / 1024).toFixed(1)}KB`)
    console.log(`   Hash: ${buildOutput.contentHash.slice(0, 16)}...`)

    // Upload to DWS storage
    console.log('   Uploading to DWS...')
    const codeCid = await this.uploadToDWS(buildOutput.bundlePath)
    console.log(`   CID: ${codeCid}`)

    // Register with DWS worker registry
    console.log('   Registering worker...')
    const workerId = await this.registerWorker(
      config.name,
      codeCid,
      workerConfig,
    )

    return {
      workerId,
      name: workerConfig.name,
      codeCid,
      version: 1,
      status: 'active',
      deployedAt: Date.now(),
      regions: workerConfig.regions,
    }
  }

  /**
   * Deploy frontend to IPFS
   */
  private async deployFrontend(
    appPath: string,
    config: ServerlessAppConfig,
  ): Promise<AppDeploymentState['frontend']> {
    const frontendConfig = config.frontend
    if (!frontendConfig) {
      throw new Error('No frontend config')
    }

    const buildDir = join(appPath, frontendConfig.buildDir)

    // Run build command if needed
    if (frontendConfig.buildCommand && !existsSync(buildDir)) {
      console.log(`   Building with: ${frontendConfig.buildCommand}`)
      const proc = Bun.spawn(['sh', '-c', frontendConfig.buildCommand], {
        cwd: appPath,
        stdout: 'inherit',
        stderr: 'inherit',
      })
      await proc.exited
    }

    if (!existsSync(buildDir)) {
      console.log(`   Warning: Build directory not found: ${buildDir}`)
      return undefined
    }

    // Collect and upload files
    const files = this.collectFiles(buildDir)
    console.log(`   Found ${files.length} files to upload`)

    const uploadedFiles: UploadedFile[] = []
    let totalSize = 0

    for (const file of files) {
      const relativePath = relative(buildDir, file)
      const content = readFileSync(file)
      const ext = extname(file)
      const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream'
      const hash = createHash('sha256').update(content).digest('hex')
      const size = content.length
      totalSize += size

      const cid = await this.uploadFileToDWS(content, relativePath, mimeType)

      uploadedFiles.push({
        path: file,
        relativePath,
        cid,
        size,
        hash,
        mimeType,
      })
    }

    // Create and upload manifest
    const manifest = {
      name: config.name,
      version: '1.0.0',
      files: uploadedFiles.map((f) => ({
        path: f.relativePath,
        cid: f.cid,
        size: f.size,
      })),
      createdAt: new Date().toISOString(),
    }

    const manifestContent = JSON.stringify(manifest, null, 2)
    const rootCid = await this.uploadFileToDWS(
      Buffer.from(manifestContent),
      'manifest.json',
      'application/json',
    )

    console.log(`   Uploaded: ${(totalSize / 1024).toFixed(1)}KB`)
    console.log(`   Root CID: ${rootCid}`)

    return {
      name: config.name,
      ipfsCid: rootCid,
      version: '1.0.0',
      files: uploadedFiles.map((f) => ({
        path: f.relativePath,
        cid: f.cid,
        size: f.size,
      })),
      totalSize,
      deployedAt: Date.now(),
      jnsName: config.jnsName,
    }
  }

  /**
   * Collect all files from a directory
   */
  private collectFiles(dir: string): string[] {
    const files: string[] = []

    const walk = (currentDir: string): void => {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name)
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            walk(fullPath)
          }
        } else {
          files.push(fullPath)
        }
      }
    }

    walk(dir)
    return files
  }

  /**
   * Upload a file to DWS storage
   */
  private async uploadToDWS(filePath: string): Promise<string> {
    const content = readFileSync(filePath)
    return this.uploadFileToDWS(content, 'worker.js', 'application/javascript')
  }

  /**
   * Upload file content to DWS
   */
  private async uploadFileToDWS(
    content: Buffer,
    filename: string,
    contentType: string,
  ): Promise<string> {
    const formData = new FormData()
    const blob = new Blob([new Uint8Array(content)], { type: contentType })
    formData.append('file', blob, filename)
    formData.append('permanent', 'true')

    const response = await fetch(`${this.ctx.dwsEndpoint}/storage/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        'x-jeju-address': this.ctx.deployer,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Upload failed: ${error}`)
    }

    const rawData: unknown = await response.json()
    const result = IPFSUploadResponseSchema.parse(rawData)
    return result.cid
  }

  /**
   * Register worker with DWS
   */
  private async registerWorker(
    name: string,
    codeCid: string,
    config: ServerlessAppConfig['worker'],
  ): Promise<string> {
    if (!config) throw new Error('No worker config')

    const response = await fetch(`${this.ctx.dwsEndpoint}/workers/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': this.ctx.deployer,
      },
      body: JSON.stringify({
        name,
        codeCid,
        memoryMb: config.memoryMb,
        timeoutMs: config.timeoutMs,
        regions: config.regions,
        tee: config.tee,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Worker registration failed: ${error}`)
    }

    const rawWorkerData: unknown = await response.json()
    const workerResult = WorkerRegistrationResponseSchema.parse(rawWorkerData)
    return workerResult.workerId
  }

  /**
   * Update JNS records with IPFS content hash
   */
  private async updateJNS(jnsName: string, ipfsCid: string): Promise<string> {
    const node = namehash(jnsName) as Hex

    // Encode IPFS CID as contenthash (EIP-1577)
    const contenthash = this.encodeIPFSContenthash(ipfsCid)

    // Get chain based on network
    const chain =
      this.ctx.network === 'mainnet'
        ? base
        : this.ctx.network === 'testnet'
          ? baseSepolia
          : foundry

    // Create clients
    const publicClient = createPublicClient({
      chain,
      transport: http(this.ctx.rpcUrl),
    })

    const account = privateKeyToAccount(this.ctx.privateKey)
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(this.ctx.rpcUrl),
    })

    // Set contenthash
    const hash = await walletClient.writeContract({
      address: this.ctx.contracts.jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setContenthash',
      args: [node, contenthash],
      chain,
    })

    await publicClient.waitForTransactionReceipt({ hash })

    console.log(`   JNS updated: ${jnsName}`)
    return node
  }

  /**
   * Encode IPFS CID as EIP-1577 contenthash
   */
  private encodeIPFSContenthash(cid: string): Hex {
    const BASE58_ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

    const base58Decode = (str: string): Uint8Array => {
      const bytes: number[] = [0]
      for (const char of str) {
        const value = BASE58_ALPHABET.indexOf(char)
        if (value === -1) {
          throw new Error(`Invalid base58 character: ${char}`)
        }

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

      let leadingZeros = 0
      for (const char of str) {
        if (char === '1') leadingZeros++
        else break
      }

      const result = new Uint8Array(leadingZeros + bytes.length)
      result.set(new Uint8Array(bytes), leadingZeros)
      return result
    }

    if (!cid.startsWith('Qm')) {
      throw new Error(`Unsupported CID format: ${cid}. Expected CIDv0 (Qm...)`)
    }

    const multihash = base58Decode(cid)
    const contenthash = new Uint8Array(3 + multihash.length)
    contenthash[0] = 0xe3 // IPFS namespace
    contenthash[1] = 0x01 // CIDv1
    contenthash[2] = 0x70 // dag-pb
    contenthash.set(multihash, 3)

    return `0x${Array.from(contenthash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}` as Hex
  }

  /**
   * Verify deployments
   */
  private async verifyDeployments(): Promise<void> {
    for (const app of this.results) {
      const results: VerificationResult[] = []

      // Verify worker
      if (app.worker) {
        const workerResult = await this.verifyWorker(app)
        results.push(workerResult)
      }

      // Verify frontend
      if (app.frontend) {
        const frontendResult = await this.verifyFrontend(app)
        results.push(frontendResult)
      }

      // Verify JNS
      if (app.jnsNode) {
        const jnsResult = await this.verifyJNS(app)
        results.push(jnsResult)
      }

      const passed = results.every((r) => r.passed)
      if (passed) {
        app.verifiedAt = Date.now()
        console.log(`   ✅ ${app.name}: All checks passed`)
      } else {
        const failed = results.filter((r) => !r.passed)
        console.log(`   ❌ ${app.name}: ${failed.length} check(s) failed`)
        for (const f of failed) {
          console.log(`      - ${f.type}: ${f.message}`)
        }
      }
    }
  }

  private async verifyWorker(
    app: AppDeploymentState,
  ): Promise<VerificationResult> {
    const start = Date.now()

    // Check if worker is responding
    const response = await fetch(
      `${this.ctx.dwsEndpoint}/workers/${app.worker?.workerId}/health`,
      { signal: AbortSignal.timeout(5000) },
    )

    return {
      name: app.name,
      type: 'worker',
      passed: response?.ok ?? false,
      message: response?.ok
        ? 'Worker is healthy'
        : 'Worker health check failed',
      duration: Date.now() - start,
    }
  }

  private async verifyFrontend(
    app: AppDeploymentState,
  ): Promise<VerificationResult> {
    const start = Date.now()

    // Check if frontend is accessible via IPFS
    const response = await fetch(
      `${this.ctx.dwsEndpoint}/ipfs/${app.frontend?.ipfsCid}`,
      { signal: AbortSignal.timeout(5000) },
    )

    return {
      name: app.name,
      type: 'frontend',
      passed: response?.ok ?? false,
      message: response?.ok ? 'Frontend accessible' : 'Frontend not accessible',
      details: {
        cid: app.frontend?.ipfsCid ?? '',
        files: app.frontend?.files.length ?? 0,
      },
      duration: Date.now() - start,
    }
  }

  private async verifyJNS(
    app: AppDeploymentState,
  ): Promise<VerificationResult> {
    const start = Date.now()

    // Check if JNS resolves
    const publicClient = createPublicClient({
      transport: http(this.ctx.rpcUrl),
    })

    const contenthash = await publicClient.readContract({
      address: this.ctx.contracts.jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'contenthash',
      args: [app.jnsNode as Hex],
    })

    const hasContent = contenthash && contenthash !== '0x'

    return {
      name: app.name,
      type: 'jns',
      passed: hasContent,
      message: hasContent ? 'JNS resolves correctly' : 'JNS not configured',
      details: {
        jnsName: app.jnsName,
        node: app.jnsNode ?? '',
      },
      duration: Date.now() - start,
    }
  }

  /**
   * Create deployment manifest
   */
  private createManifest(): DeploymentManifest {
    return {
      network: this.ctx.network,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      deployer: this.ctx.deployer,
      apps: this.results,
      contracts: this.ctx.contracts,
    }
  }

  /**
   * Save deployment manifest
   */
  private saveManifest(manifest: DeploymentManifest): void {
    const outputPath = join(
      this.ctx.rootDir,
      'packages',
      'deployment',
      `.temp`,
      `serverless-deployment-${this.ctx.network}.json`,
    )

    mkdirSync(join(outputPath, '..'), { recursive: true })
    writeFileSync(outputPath, JSON.stringify(manifest, null, 2))
    console.log(`\nManifest saved: ${outputPath}`)
  }

  /**
   * Print header
   */
  private printHeader(): void {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║           🚀 JEJU SERVERLESS DEPLOYMENT                               ║
╚═══════════════════════════════════════════════════════════════════════╝

Network:     ${this.ctx.network}
Deployer:    ${this.ctx.deployer}
DWS:         ${this.ctx.dwsEndpoint}
`)
  }

  /**
   * Print summary
   */
  private printSummary(): void {
    const successful = this.results.filter((r) => r.status === 'complete')
    const partial = this.results.filter((r) => r.status === 'partial')
    const failed = this.results.filter((r) => r.status === 'error')

    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                       DEPLOYMENT SUMMARY                              ║
╚═══════════════════════════════════════════════════════════════════════╝

Total:      ${this.results.length}
Successful: ${successful.length}
Partial:    ${partial.length}
Failed:     ${failed.length}

Apps:
`)

    for (const app of this.results) {
      const icon =
        app.status === 'complete' ? '✅' : app.status === 'partial' ? '⚠️' : '❌'
      console.log(`  ${icon} ${app.name}`)
      console.log(`     JNS: ${app.jnsName}`)
      if (app.worker) {
        console.log(`     Worker: ${app.worker.codeCid?.slice(0, 16)}...`)
      }
      if (app.frontend) {
        console.log(`     Frontend: ${app.frontend.ipfsCid?.slice(0, 16)}...`)
      }
      console.log('')
    }
  }
}

// CLI Entry Point

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      testnet: { type: 'boolean', default: false },
      mainnet: { type: 'boolean', default: false },
      app: { type: 'string' },
      verify: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  })

  if (values.help) {
    console.log(`
Jeju Serverless Deployment

Usage:
  bun run scripts/serverless/deploy.ts [options]

Options:
  --testnet     Deploy to testnet
  --mainnet     Deploy to mainnet
  --app <name>  Deploy specific app only
  --verify      Only run verification
  -h, --help    Show this help

Examples:
  bun run scripts/serverless/deploy.ts                # Deploy all to localnet
  bun run scripts/serverless/deploy.ts --testnet      # Deploy all to testnet
  bun run scripts/serverless/deploy.ts --app bazaar   # Deploy bazaar only
`)
    process.exit(0)
  }

  // Determine network
  const network = values.mainnet
    ? 'mainnet'
    : values.testnet
      ? 'testnet'
      : 'localnet'

  // Get configuration
  const rootDir = process.cwd()
  const privateKey =
    process.env.DEPLOYER_PRIVATE_KEY ||
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  const account = privateKeyToAccount(privateKey as Hex)

  // Network-specific configuration
  const networkConfig = {
    localnet: {
      rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:6546',
      dwsEndpoint: process.env.DWS_ENDPOINT || 'http://localhost:4030',
      ipfsApiUrl: process.env.IPFS_API_URL || 'http://localhost:5001',
    },
    testnet: {
      rpcUrl: process.env.TESTNET_RPC_URL || 'https://sepolia.base.org',
      dwsEndpoint: 'https://dws.testnet.jejunetwork.org',
      ipfsApiUrl: 'https://ipfs.testnet.jejunetwork.org:5001',
    },
    mainnet: {
      rpcUrl: process.env.MAINNET_RPC_URL || 'https://mainnet.base.org',
      dwsEndpoint: 'https://dws.jejunetwork.org',
      ipfsApiUrl: 'https://ipfs.jejunetwork.org:5001',
    },
  }

  // Load contract addresses
  const deploymentsPath = join(
    rootDir,
    'packages',
    'contracts',
    'deployments',
    network,
    'deployment.json',
  )
  let contracts = {
    jnsRegistry: '0x0000000000000000000000000000000000000000' as Address,
    jnsResolver: '0x0000000000000000000000000000000000000000' as Address,
    jnsRegistrar: '0x0000000000000000000000000000000000000000' as Address,
    identityRegistry: '0x0000000000000000000000000000000000000000' as Address,
  }

  if (existsSync(deploymentsPath)) {
    const parsed = DeploymentAddressesSchema.safeParse(
      JSON.parse(readFileSync(deploymentsPath, 'utf-8')),
    )
    if (parsed.success) {
      const deployments = parsed.data
      contracts = {
        jnsRegistry: (deployments.JNSRegistry ||
          contracts.jnsRegistry) as Address,
        jnsResolver: (deployments.JNSResolver ||
          contracts.jnsResolver) as Address,
        jnsRegistrar: (deployments.JNSRegistrar ||
          contracts.jnsRegistrar) as Address,
        identityRegistry: (deployments.IdentityRegistry ||
          contracts.identityRegistry) as Address,
      }
    }
  }

  const ctx: DeployContext = {
    network,
    rootDir,
    privateKey: privateKey as Hex,
    deployer: account.address,
    ...networkConfig[network],
    contracts,
  }

  const deployer = new ServerlessDeployer(ctx)
  await deployer.deploy(values.app)
}

main().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
