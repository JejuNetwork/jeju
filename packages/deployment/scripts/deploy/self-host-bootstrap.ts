#!/usr/bin/env bun

/**
 * Self-Hosting Bootstrap Script
 *
 * Deploys Jeju to its own decentralized infrastructure:
 * 1. Push Jeju monorepo to JejuGit
 * 2. Publish all @jejunetwork/* packages to JejuPkg
 * 3. Build and push Docker images to Container Registry
 * 4. Upload frontend builds to DWS storage
 * 5. Register all JNS names
 *
 * This enables Jeju to be fully self-hosted on its own infrastructure.
 */

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { bytesToHex, hash256 } from '@jejunetwork/shared'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  parseEther,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import {
  CIDUploadResponseSchema,
  DwsAddressesSchema,
  DwsDeploymentSchema,
  expectJson,
  expectValid,
  type JejuManifest,
  JejuManifestSchema,
  PackageJsonSchema,
} from '../../schemas'
import type {
  DeployPublicClient,
  DeployWalletClient,
} from '../shared/viem-chains'

// Configuration

interface DeploymentConfig {
  network: 'testnet' | 'mainnet'
  rpcUrl: string
  privateKey: Hex
  contracts: {
    identityRegistry: Address
    repoRegistry: Address
    packageRegistry: Address
    containerRegistry: Address
    jnsRegistrar: Address
    jnsRegistry: Address
    modelRegistry: Address
    storageManager: Address
  }
  dwsEndpoint: string
  ipfsGateway: string
}

interface BootstrapResult {
  git: {
    repoId: string
    commitHash: string
    pushed: boolean
  }
  packages: Array<{
    name: string
    version: string
    cid: string
    published: boolean
  }>
  containers: Array<{
    name: string
    tag: string
    digest: string
    pushed: boolean
  }>
  frontends: Array<{
    app: string
    cid: string
    uploaded: boolean
  }>
  jns: Array<{
    name: string
    node: string
    registered: boolean
  }>
}

// Contract ABIs
const REPO_REGISTRY_ABI = [
  {
    name: 'createRepo',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'visibility', type: 'uint8' },
    ],
    outputs: [{ name: 'repoId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'pushCommit',
    type: 'function',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'branch', type: 'string' },
      { name: 'commitHash', type: 'bytes32' },
      { name: 'parentHash', type: 'bytes32' },
      { name: 'treeCid', type: 'string' },
      { name: 'message', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getRepoByName',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'name', type: 'string' },
    ],
    outputs: [{ name: 'repoId', type: 'bytes32' }],
    stateMutability: 'view',
  },
] as const

const PACKAGE_REGISTRY_ABI = [
  {
    name: 'publishPackage',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'tarballCid', type: 'string' },
      { name: 'integrityHash', type: 'bytes32' },
      { name: 'dependencies', type: 'string[]' },
    ],
    outputs: [{ name: 'packageId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getPackage',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
    ],
    outputs: [
      { name: 'tarballCid', type: 'string' },
      { name: 'integrityHash', type: 'bytes32' },
      { name: 'publishedAt', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

const CONTAINER_REGISTRY_ABI = [
  {
    name: 'createRepository',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'namespace', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'visibility', type: 'uint8' },
      { name: 'tags', type: 'string[]' },
    ],
    outputs: [{ name: 'repoId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'pushImage',
    type: 'function',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'tag', type: 'string' },
      { name: 'digest', type: 'string' },
      { name: 'manifestUri', type: 'string' },
      { name: 'manifestHash', type: 'bytes32' },
      { name: 'size', type: 'uint256' },
      { name: 'architectures', type: 'string[]' },
      { name: 'layerCids', type: 'string[]' },
      { name: 'buildInfo', type: 'string' },
    ],
    outputs: [{ name: 'manifestId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'claimNamespace',
    type: 'function',
    inputs: [{ name: 'namespace', type: 'string' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

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

// Bootstrap Class

class SelfHostingBootstrap {
  private config: DeploymentConfig
  private publicClient: DeployPublicClient
  private walletClient: DeployWalletClient
  private account: ReturnType<typeof privateKeyToAccount>
  private rootDir: string
  private result: BootstrapResult

  constructor(config: DeploymentConfig) {
    this.config = config
    this.rootDir = join(import.meta.dir, '../..')

    const chain = config.network === 'mainnet' ? base : baseSepolia

    this.account = privateKeyToAccount(config.privateKey)
    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as DeployPublicClient
    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.rpcUrl),
    }) as DeployWalletClient

    this.result = {
      git: { repoId: '', commitHash: '', pushed: false },
      packages: [],
      containers: [],
      frontends: [],
      jns: [],
    }
  }

  async run(): Promise<BootstrapResult> {
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║          JEJU SELF-HOSTING BOOTSTRAP                                  ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')
    console.log(`Network: ${this.config.network}`)
    console.log(`Deployer: ${this.account.address}`)
    console.log(`DWS Endpoint: ${this.config.dwsEndpoint}`)
    console.log('')

    // Check balance
    const balance = await this.publicClient.getBalance({
      address: this.account.address,
    })
    console.log(`Balance: ${Number(balance) / 1e18} ETH`)
    if (balance < parseEther('0.1')) {
      throw new Error(
        'Insufficient balance. Need at least 0.1 ETH for deployment.',
      )
    }
    console.log('')

    // Step 1: Push to JejuGit
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('STEP 1: Push Jeju Monorepo to JejuGit')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    await this.pushToJejuGit()
    console.log('')

    // Step 2: Publish packages to JejuPkg
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('STEP 2: Publish Packages to JejuPkg')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    await this.publishPackages()
    console.log('')

    // Step 3: Build and push containers
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('STEP 3: Build and Push Container Images')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    await this.pushContainers()
    console.log('')

    // Step 4: Upload frontends to DWS storage
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('STEP 4: Upload Frontends to DWS Storage')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    await this.uploadFrontends()
    console.log('')

    // Step 5: Register JNS names
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('STEP 5: Register JNS Names')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    await this.registerJNSNames()
    console.log('')

    // Save results
    this.saveResults()

    // Print summary
    this.printSummary()

    return this.result
  }

  // Step 1: Push to JejuGit

  private async pushToJejuGit(): Promise<void> {
    console.log('Creating repository jeju/jeju...')

    // Check if repo already exists
    const existingRepoId = await this.publicClient.readContract({
      address: this.config.contracts.repoRegistry,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getRepoByName',
      args: [this.account.address, 'jeju'],
    })

    let repoId: Hex
    if (
      existingRepoId &&
      existingRepoId !==
        '0x0000000000000000000000000000000000000000000000000000000000000000'
    ) {
      console.log(`  Repository already exists: ${existingRepoId}`)
      repoId = existingRepoId
    } else {
      // Create new repository
      const hash = await this.walletClient.writeContract({
        address: this.config.contracts.repoRegistry,
        abi: REPO_REGISTRY_ABI,
        functionName: 'createRepo',
        args: ['jeju', 'Jeju Network - A network for agents and humans', 0], // 0 = public
      })

      await this.publicClient.waitForTransactionReceipt({ hash })
      console.log(`  Repository created: ${hash}`)
      repoId = keccak256(toBytes(`${this.account.address}:jeju`))
    }

    // Get current git commit hash
    const commitHash = execSync('git rev-parse HEAD', {
      cwd: this.rootDir,
      encoding: 'utf-8',
    }).trim()
    console.log(`  Current commit: ${commitHash}`)

    // Create tree from current state and upload to DWS
    console.log('  Uploading repository tree to storage...')
    const treeCid = await this.uploadGitTree()
    console.log(`  Tree CID: ${treeCid}`)

    // Push commit to chain
    console.log('  Recording commit on-chain...')
    const commitMessage = execSync('git log -1 --pretty=%B', {
      cwd: this.rootDir,
      encoding: 'utf-8',
    }).trim()
    const parentHash = execSync('git rev-parse HEAD~1', {
      cwd: this.rootDir,
      encoding: 'utf-8',
    }).trim()

    const commitHashBytes32 = this.gitSha1ToBytes32(commitHash)
    const parentHashBytes32 = this.gitSha1ToBytes32(parentHash)

    const pushHash = await this.walletClient.writeContract({
      address: this.config.contracts.repoRegistry,
      abi: REPO_REGISTRY_ABI,
      functionName: 'pushCommit',
      args: [
        repoId,
        'main',
        commitHashBytes32,
        parentHashBytes32,
        treeCid,
        commitMessage.slice(0, 256),
      ],
    })

    await this.publicClient.waitForTransactionReceipt({ hash: pushHash })
    console.log(`  ✅ Commit pushed: ${pushHash}`)

    this.result.git = {
      repoId: repoId,
      commitHash,
      pushed: true,
    }
  }

  private gitSha1ToBytes32(sha: string): Hex {
    const trimmed = sha.trim()
    if (!/^[0-9a-fA-F]{40}$/.test(trimmed)) {
      throw new Error(`Invalid git SHA1 (expected 40 hex chars): ${sha}`)
    }
    return keccak256(toBytes(`0x${trimmed}` as Hex))
  }

  private async uploadGitTree(): Promise<string> {
    // Create a tar archive of the repository (excluding .git and node_modules)
    const archivePath = '/tmp/jeju-repo.tar.gz'
    execSync(
      `tar -czf ${archivePath} --exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='.next' --exclude='*.log' .`,
      { cwd: this.rootDir },
    )

    // Upload to DWS
    const archiveContent = readFileSync(archivePath)
    const cid = await this.uploadToDWS(
      archiveContent,
      'jeju-repo.tar.gz',
      'application/gzip',
    )

    return cid
  }

  // Step 2: Publish Packages

  private async publishPackages(): Promise<void> {
    const packagesDir = join(this.rootDir, 'packages')
    const packageDirs = readdirSync(packagesDir).filter((dir) => {
      const pkgPath = join(packagesDir, dir, 'package.json')
      return existsSync(pkgPath)
    })

    for (const dir of packageDirs) {
      const pkgPath = join(packagesDir, dir, 'package.json')
      const pkgContent = readFileSync(pkgPath, 'utf-8')
      const pkg = expectJson(
        pkgContent,
        PackageJsonSchema,
        `package.json for ${dir}`,
      )

      if (!pkg.name || !pkg.version || pkg.private) continue

      console.log(`Publishing ${pkg.name}@${pkg.version}...`)

      // Create tarball
      const tarballPath = `/tmp/${dir}.tgz`
      execSync(
        `cd ${join(packagesDir, dir)} && bun pack --pack-destination /tmp`,
        { stdio: 'pipe' },
      )

      // Read tarball and compute hash
      const tarballContent = readFileSync(tarballPath)
      const integrityHash = bytesToHex(hash256(new Uint8Array(tarballContent)))

      // Upload tarball to DWS
      const cid = await this.uploadToDWS(
        tarballContent,
        `${pkg.name}-${pkg.version}.tgz`,
        'application/gzip',
      )
      console.log(`  Uploaded to CID: ${cid}`)

      // Get dependencies
      const dependencies = Object.keys(pkg.dependencies ?? {})

      // Publish to registry
      const hash = await this.walletClient.writeContract({
        address: this.config.contracts.packageRegistry,
        abi: PACKAGE_REGISTRY_ABI,
        functionName: 'publishPackage',
        args: [
          pkg.name,
          pkg.version,
          cid,
          `0x${integrityHash}` as Hex,
          dependencies,
        ],
      })

      await this.publicClient.waitForTransactionReceipt({ hash })
      console.log(`  ✅ Published: ${hash}`)

      this.result.packages.push({
        name: pkg.name,
        version: pkg.version,
        cid,
        published: true,
      })
    }
  }

  // Step 3: Build and Push Containers

  private async pushContainers(): Promise<void> {
    // Claim namespace first
    console.log('Claiming namespace "jeju"...')
    const claimHash = await this.walletClient.writeContract({
      address: this.config.contracts.containerRegistry,
      abi: CONTAINER_REGISTRY_ABI,
      functionName: 'claimNamespace',
      args: ['jeju'],
    })
    await this.publicClient.waitForTransactionReceipt({ hash: claimHash })
    console.log('  ✅ Namespace claimed')

    // Find all apps with Dockerfiles
    const appsDir = join(this.rootDir, 'apps')
    const appDirs = readdirSync(appsDir).filter((dir) => {
      const dockerPath = join(appsDir, dir, 'Dockerfile')
      return existsSync(dockerPath)
    })

    for (const app of appDirs) {
      const appPath = join(appsDir, app)
      const manifestPath = join(appPath, 'jeju-manifest.json')

      let manifest: JejuManifest = {
        name: app,
        tags: [],
      }
      if (existsSync(manifestPath)) {
        const manifestContent = readFileSync(manifestPath, 'utf-8')
        manifest = expectJson(
          manifestContent,
          JejuManifestSchema,
          `manifest for ${app}`,
        )
      }

      console.log(`Building ${app}...`)

      // Build Docker image
      const imageName = `jeju/${app}:latest`
      execSync(`docker build -t ${imageName} .`, {
        cwd: appPath,
        stdio: 'pipe',
      })

      // Get image digest
      const digest = execSync(
        `docker inspect --format='{{index .RepoDigests 0}}' ${imageName} 2>/dev/null || docker inspect --format='{{.Id}}' ${imageName}`,
        {
          encoding: 'utf-8',
        },
      ).trim()

      // Export image layers
      console.log(`  Exporting layers...`)
      const exportPath = `/tmp/${app}-image.tar`
      execSync(`docker save ${imageName} -o ${exportPath}`, { stdio: 'pipe' })

      // Upload image to DWS and get layer CIDs
      const { manifestCid, layerCids, size } = await this.uploadDockerImage(
        exportPath,
        app,
      )
      console.log(`  Manifest CID: ${manifestCid}`)
      console.log(`  Layers: ${layerCids.length}`)

      // Create repository in container registry
      const createHash = await this.walletClient.writeContract({
        address: this.config.contracts.containerRegistry,
        abi: CONTAINER_REGISTRY_ABI,
        functionName: 'createRepository',
        args: [
          app,
          'jeju',
          manifest.description || `Jeju ${app} service`,
          0, // PUBLIC
          manifest.tags ?? [],
        ],
        value: 0n,
      })

      await this.publicClient.waitForTransactionReceipt({ hash: createHash })
      const repoId = keccak256(toBytes(`jeju/${app}`))

      // Push image manifest
      const pushHash = await this.walletClient.writeContract({
        address: this.config.contracts.containerRegistry,
        abi: CONTAINER_REGISTRY_ABI,
        functionName: 'pushImage',
        args: [
          repoId,
          'latest',
          digest,
          manifestCid,
          keccak256(toBytes(manifestCid)),
          BigInt(size),
          ['amd64'],
          layerCids,
          JSON.stringify({
            builtAt: new Date().toISOString(),
            commit: this.result.git.commitHash,
          }),
        ],
        value: 0n,
      })

      await this.publicClient.waitForTransactionReceipt({ hash: pushHash })
      console.log(`  ✅ Pushed: ${pushHash}`)

      this.result.containers.push({
        name: `jeju/${app}`,
        tag: 'latest',
        digest,
        pushed: true,
      })
    }
  }

  private async uploadDockerImage(
    tarPath: string,
    name: string,
  ): Promise<{ manifestCid: string; layerCids: string[]; size: number }> {
    const tarContent = readFileSync(tarPath)
    const size = tarContent.length

    // Upload full image as a single blob (in production, would extract and dedupe layers)
    const manifestCid = await this.uploadToDWS(
      tarContent,
      `${name}-image.tar`,
      'application/x-tar',
    )

    // For now, treat the whole image as one layer
    // In production, would extract layers from the tar and upload separately
    return {
      manifestCid,
      layerCids: [manifestCid],
      size,
    }
  }

  // Step 4: Upload Frontends

  private async uploadFrontends(): Promise<void> {
    const appsDir = join(this.rootDir, 'apps')
    const appDirs = readdirSync(appsDir)

    for (const app of appDirs) {
      const manifestPath = join(appsDir, app, 'jeju-manifest.json')
      if (!existsSync(manifestPath)) continue

      const manifestContent = readFileSync(manifestPath, 'utf-8')
      const manifest = expectJson(
        manifestContent,
        JejuManifestSchema,
        `manifest for ${app}`,
      )
      const frontendConfig = manifest.decentralization?.frontend

      if (!frontendConfig) continue

      const buildDir = join(appsDir, app, frontendConfig.buildDir ?? 'dist')
      if (!existsSync(buildDir)) {
        console.log(
          `Skipping ${app}: build directory not found (${frontendConfig.buildDir ?? 'dist'})`,
        )
        console.log(`  Run: cd apps/${app} && bun run build`)
        continue
      }

      console.log(`Uploading ${app} frontend...`)

      // Create a directory listing and upload all files
      const files = this.walkDir(buildDir)
      const uploadedFiles: Array<{ path: string; cid: string }> = []

      for (const file of files) {
        const relativePath = relative(buildDir, file)
        const content = readFileSync(file)
        const cid = await this.uploadToDWS(
          content,
          relativePath,
          this.getMimeType(file),
        )
        uploadedFiles.push({ path: relativePath, cid })
      }

      // Create directory manifest
      const directoryManifest = {
        app,
        files: uploadedFiles,
        createdAt: new Date().toISOString(),
        commit: this.result.git.commitHash,
      }

      const directoryManifestContent = Buffer.from(
        JSON.stringify(directoryManifest, null, 2),
      )
      const directoryCid = await this.uploadToDWS(
        directoryManifestContent,
        `${app}-manifest.json`,
        'application/json',
      )

      console.log(`  ✅ Uploaded ${files.length} files`)
      console.log(`  Directory CID: ${directoryCid}`)

      this.result.frontends.push({
        app,
        cid: directoryCid,
        uploaded: true,
      })
    }
  }

  private walkDir(dir: string): string[] {
    const files: string[] = []
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...this.walkDir(fullPath))
      } else {
        files.push(fullPath)
      }
    }

    return files
  }

  private getMimeType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      mjs: 'application/javascript',
      json: 'application/json',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      eot: 'application/vnd.ms-fontobject',
      txt: 'text/plain',
      md: 'text/markdown',
    }
    return mimeTypes[ext ?? ''] ?? 'application/octet-stream'
  }

  // Step 5: Register JNS Names

  private async registerJNSNames(): Promise<void> {
    const appsDir = join(this.rootDir, 'apps')
    const appDirs = readdirSync(appsDir)

    // Collect all JNS names from manifests
    const namesToRegister: Array<{ name: string; app: string; cid?: string }> =
      []

    for (const app of appDirs) {
      const manifestPath = join(appsDir, app, 'jeju-manifest.json')
      if (!existsSync(manifestPath)) continue

      const jnsManifestContent = readFileSync(manifestPath, 'utf-8')
      const manifest = expectJson(
        jnsManifestContent,
        JejuManifestSchema,
        `JNS manifest for ${app}`,
      )
      if (manifest.jns?.name) {
        // Extract the label (e.g., "gateway" from "gateway.jeju")
        const label = manifest.jns.name.replace('.jeju', '')
        const frontend = this.result.frontends.find((f) => f.app === app)
        namesToRegister.push({
          name: label,
          app,
          cid: frontend?.cid,
        })
      }
    }

    // Also register core infrastructure names
    const coreNames = [
      { name: 'dws', app: 'dws' },
      { name: 'git', app: 'dws' },
      { name: 'npm', app: 'dws' },
      { name: 'registry', app: 'dws' },
      { name: 'hub', app: 'dws' },
      { name: 'storage', app: 'dws' },
    ]

    for (const core of coreNames) {
      if (!namesToRegister.find((n) => n.name === core.name)) {
        namesToRegister.push(core)
      }
    }

    // Register each name
    for (const { name, cid } of namesToRegister) {
      console.log(`Registering ${name}.jeju...`)

      // Check availability
      const available = await this.publicClient.readContract({
        address: this.config.contracts.jnsRegistrar,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'available',
        args: [name],
      })

      if (!available) {
        console.log(`  ⏭️  Already registered`)
        this.result.jns.push({
          name: `${name}.jeju`,
          node: '',
          registered: false,
        })
        continue
      }

      // Get price for 10 years
      const duration = BigInt(10 * 365 * 24 * 60 * 60) // 10 years in seconds
      const price = await this.publicClient.readContract({
        address: this.config.contracts.jnsRegistrar,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'rentPrice',
        args: [name, duration],
      })

      // Register
      const registerHash = await this.walletClient.writeContract({
        address: this.config.contracts.jnsRegistrar,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'register',
        args: [name, this.account.address, duration],
        value: price,
      })

      await this.publicClient.waitForTransactionReceipt({ hash: registerHash })
      const node = this.namehash(`${name}.jeju`)

      console.log(`  ✅ Registered: ${registerHash}`)
      console.log(`  Node: ${node}`)

      if (cid) {
        console.log(`  Content hash: ${cid}`)
      }

      this.result.jns.push({ name: `${name}.jeju`, node, registered: true })
    }
  }

  private namehash(name: string): Hex {
    let node =
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    if (name) {
      const labels = name.split('.').reverse()
      for (const label of labels) {
        const labelHash = keccak256(toBytes(label))
        node = keccak256(toBytes(node + labelHash.slice(2)))
      }
    }
    return node as Hex
  }

  // DWS Upload Helper

  private async uploadToDWS(
    content: Buffer,
    filename: string,
    contentType: string,
  ): Promise<string> {
    const formData = new FormData()
    const blob = new Blob([new Uint8Array(content)], { type: contentType })
    formData.append('file', blob, filename)
    formData.append('permanent', 'true') // Use permanent storage

    const response = await fetch(`${this.config.dwsEndpoint}/storage/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        'x-jeju-address': this.account.address,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to upload ${filename}: ${error}`)
    }

    const resultRaw = await response.json()
    const result = expectValid(
      CIDUploadResponseSchema,
      resultRaw,
      'upload response',
    )
    return result.cid
  }

  // Results

  private saveResults(): void {
    const resultPath = join(
      this.rootDir,
      `self-host-result-${this.config.network}.json`,
    )
    writeFileSync(resultPath, JSON.stringify(this.result, null, 2))
    console.log(`Results saved to: ${resultPath}`)
  }

  private printSummary(): void {
    console.log('')
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║                    SELF-HOSTING BOOTSTRAP COMPLETE                   ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')

    console.log('📦 Git Repository:')
    console.log(`   Repo ID: ${this.result.git.repoId}`)
    console.log(`   Commit: ${this.result.git.commitHash}`)
    console.log(
      `   Status: ${this.result.git.pushed ? '✅ Pushed' : '❌ Failed'}`,
    )
    console.log('')

    console.log('📚 Packages Published:')
    for (const pkg of this.result.packages) {
      const status = pkg.published ? '✅' : '❌'
      console.log(`   ${status} ${pkg.name}@${pkg.version}`)
    }
    console.log('')

    console.log('🐳 Container Images:')
    for (const container of this.result.containers) {
      const status = container.pushed ? '✅' : '❌'
      console.log(`   ${status} ${container.name}:${container.tag}`)
    }
    console.log('')

    console.log('🌐 Frontends Uploaded:')
    for (const frontend of this.result.frontends) {
      const status = frontend.uploaded ? '✅' : '❌'
      console.log(`   ${status} ${frontend.app} -> ${frontend.cid}`)
    }
    console.log('')

    console.log('🏷️  JNS Names Registered:')
    for (const jns of this.result.jns) {
      const status = jns.registered ? '✅' : '⏭️'
      console.log(`   ${status} ${jns.name}`)
    }
    console.log('')

    console.log('🎉 Jeju is now self-hosted on Jeju infrastructure.')
    console.log('')
  }
}

// CLI Entry Point

async function main() {
  const network = (process.argv[2] || 'testnet') as 'testnet' | 'mainnet'

  // Load configuration from environment
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    console.error('DEPLOYER_PRIVATE_KEY environment variable required')
    process.exit(1)
  }

  // Load contract addresses from deployment files
  const deploymentsPath = join(
    import.meta.dir,
    '../../packages/contracts/deployments',
    network,
  )
  let contracts: DeploymentConfig['contracts']

  const addressesFile = join(deploymentsPath, 'addresses.json')
  const deploymentFile = join(deploymentsPath, 'deployment.json')
  if (existsSync(addressesFile)) {
    const addressesContent = readFileSync(addressesFile, 'utf-8')
    const addresses = expectJson(
      addressesContent,
      DwsAddressesSchema,
      'DWS addresses',
    )
    contracts = {
      identityRegistry: addresses.identityRegistry as Address,
      repoRegistry: addresses.repoRegistry as Address,
      packageRegistry: addresses.packageRegistry as Address,
      containerRegistry: addresses.containerRegistry as Address,
      jnsRegistrar: addresses.jnsRegistrar as Address,
      jnsRegistry: addresses.jnsRegistry as Address,
      modelRegistry: addresses.modelRegistry as Address,
      storageManager: addresses.storageManager as Address,
    }
  } else if (existsSync(deploymentFile)) {
    const deploymentContent = readFileSync(deploymentFile, 'utf-8')
    const deployment = expectJson(
      deploymentContent,
      DwsDeploymentSchema,
      'DWS deployment',
    )
    contracts = {
      identityRegistry: deployment.contracts.identityRegistry
        .address as Address,
      repoRegistry: deployment.contracts.repoRegistry.address as Address,
      packageRegistry: deployment.contracts.packageRegistry.address as Address,
      containerRegistry: deployment.contracts.containerRegistry
        .address as Address,
      jnsRegistrar: deployment.contracts.jnsRegistrar.address as Address,
      jnsRegistry: deployment.contracts.jnsRegistry.address as Address,
      modelRegistry: deployment.contracts.modelRegistry.address as Address,
      storageManager: deployment.contracts.storageManager.address as Address,
    }
  } else {
    // Use environment variables as fallback
    const requireAddress = (key: string): Address => {
      const value = process.env[key]
      if (!value) {
        throw new Error(
          `Missing ${key}. Deploy contracts first or set env vars.`,
        )
      }
      return value as Address
    }

    contracts = {
      identityRegistry: requireAddress('IDENTITY_REGISTRY_ADDRESS'),
      repoRegistry: requireAddress('REPO_REGISTRY_ADDRESS'),
      packageRegistry: requireAddress('PACKAGE_REGISTRY_ADDRESS'),
      containerRegistry: requireAddress('CONTAINER_REGISTRY_ADDRESS'),
      jnsRegistrar: requireAddress('JNS_REGISTRAR_ADDRESS'),
      jnsRegistry: requireAddress('JNS_REGISTRY_ADDRESS'),
      modelRegistry: requireAddress('MODEL_REGISTRY_ADDRESS'),
      storageManager: requireAddress('STORAGE_MANAGER_ADDRESS'),
    }
  }

  const config: DeploymentConfig = {
    network,
    rpcUrl:
      network === 'mainnet'
        ? process.env.MAINNET_RPC_URL || 'https://mainnet.base.org'
        : process.env.TESTNET_RPC_URL || 'https://sepolia.base.org',
    privateKey: privateKey as Hex,
    contracts,
    dwsEndpoint:
      process.env.DWS_ENDPOINT ||
      (network === 'mainnet'
        ? 'https://dws.jejunetwork.org'
        : 'https://dws.testnet.jejunetwork.org'),
    ipfsGateway:
      process.env.IPFS_GATEWAY ||
      (network === 'mainnet'
        ? 'https://ipfs.jejunetwork.org'
        : 'https://ipfs.testnet.jejunetwork.org'),
  }

  const bootstrap = new SelfHostingBootstrap(config)
  await bootstrap.run()
}

main().catch((err) => {
  console.error('Bootstrap failed:', err)
  process.exit(1)
})

export { SelfHostingBootstrap, type DeploymentConfig, type BootstrapResult }
