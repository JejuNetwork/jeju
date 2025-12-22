#!/usr/bin/env bun

/**
 * Frontend Upload Automation
 *
 * Builds and uploads all frontend applications to DWS storage.
 * Creates directory listings and updates JNS records with content hashes.
 */

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ============================================================================
// Configuration
// ============================================================================

interface FrontendManifest {
  name: string
  jns?: { name: string }
  decentralization?: {
    frontend?: {
      buildDir?: string
      buildCommand?: string
    }
  }
}

interface UploadedFile {
  path: string
  cid: string
  size: number
  hash: string
  mimeType: string
}

interface FrontendUploadResult {
  app: string
  buildDir: string
  files: UploadedFile[]
  rootCid: string
  indexCid: string
  totalSize: number
  jnsName?: string
  uploadedAt: string
}

const ROOT_DIR = join(import.meta.dir, '../..')
const APPS_DIR = join(ROOT_DIR, 'apps')

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
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.map': 'application/json',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
}

// ============================================================================
// Uploader Class
// ============================================================================

class FrontendUploader {
  private dwsEndpoint: string
  private privateKey: Hex
  private account: ReturnType<typeof privateKeyToAccount>
  private network: 'testnet' | 'mainnet'
  private results: FrontendUploadResult[] = []

  constructor(network: 'testnet' | 'mainnet' = 'testnet') {
    this.network = network
    this.dwsEndpoint =
      process.env.DWS_ENDPOINT ||
      (network === 'mainnet'
        ? 'https://dws.jejunetwork.org'
        : 'https://dws.testnet.jejunetwork.org')

    this.privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex
    if (!this.privateKey) {
      throw new Error('DEPLOYER_PRIVATE_KEY environment variable required')
    }

    this.account = privateKeyToAccount(this.privateKey)
  }

  async run(): Promise<FrontendUploadResult[]> {
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║          JEJU FRONTEND UPLOAD                                        ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')
    console.log(`Network: ${this.network}`)
    console.log(`DWS Endpoint: ${this.dwsEndpoint}`)
    console.log(`Deployer: ${this.account.address}`)
    console.log('')

    // Find all apps with jeju-manifest.json
    const apps = this.discoverApps()
    console.log(`Found ${apps.length} frontends to upload`)
    console.log('')

    for (const app of apps) {
      console.log(
        '═══════════════════════════════════════════════════════════════════════',
      )
      console.log(`Uploading: ${app.name}`)
      console.log(
        '═══════════════════════════════════════════════════════════════════════',
      )

      const result = await this.uploadApp(app)
      if (result) {
        this.results.push(result)
      }
      console.log('')
    }

    // Save results
    this.saveResults()

    // Print summary
    this.printSummary()

    return this.results
  }

  private discoverApps(): Array<{
    name: string
    path: string
    manifest: FrontendManifest
  }> {
    const apps: Array<{
      name: string
      path: string
      manifest: FrontendManifest
    }> = []
    const dirs = readdirSync(APPS_DIR)

    for (const dir of dirs) {
      const appPath = join(APPS_DIR, dir)
      const manifestPath = join(appPath, 'jeju-manifest.json')

      if (!existsSync(manifestPath)) continue

      const manifest = JSON.parse(
        readFileSync(manifestPath, 'utf-8'),
      ) as FrontendManifest

      // Check if it has frontend config
      if (manifest.decentralization?.frontend) {
        apps.push({
          name: dir,
          path: appPath,
          manifest,
        })
      }
    }

    return apps
  }

  private async uploadApp(app: {
    name: string
    path: string
    manifest: FrontendManifest
  }): Promise<FrontendUploadResult | null> {
    const decentralization = app.manifest.decentralization
    const frontendConfig = decentralization?.frontend
    if (!frontendConfig) throw new Error(`No frontend config for ${app.name}`)
    const buildDir = join(app.path, frontendConfig.buildDir || 'dist')

    // Check if build exists, if not try to build
    if (!existsSync(buildDir)) {
      console.log(`  Build directory not found, building...`)
      const buildCommand = frontendConfig.buildCommand || 'bun run build'

      try {
        execSync(buildCommand, { cwd: app.path, stdio: 'inherit' })
      } catch {
        console.error(`  Build failed for ${app.name}`)
        return null
      }

      if (!existsSync(buildDir)) {
        console.error(
          `  Build directory still not found after build: ${buildDir}`,
        )
        return null
      }
    }

    // Collect all files
    const files = this.walkDir(buildDir)
    console.log(`  Found ${files.length} files to upload`)

    // Upload each file
    const uploadedFiles: UploadedFile[] = []
    let totalSize = 0

    for (const file of files) {
      const relativePath = relative(buildDir, file)
      const content = readFileSync(file)
      const ext = extname(file)
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
      const hash = createHash('sha256').update(content).digest('hex')
      const size = content.length
      totalSize += size

      console.log(`    Uploading: ${relativePath} (${this.formatSize(size)})`)

      const cid = await this.uploadFile(content, relativePath, mimeType)

      uploadedFiles.push({
        path: relativePath,
        cid,
        size,
        hash,
        mimeType,
      })
    }

    // Create directory listing (CAR file or manifest)
    const directoryManifest = {
      name: app.name,
      version: '1.0.0',
      files: uploadedFiles.map((f) => ({
        path: f.path,
        cid: f.cid,
        size: f.size,
        hash: f.hash,
      })),
      createdAt: new Date().toISOString(),
      deployer: this.account.address,
    }

    console.log(`  Creating directory manifest...`)
    const manifestContent = Buffer.from(
      JSON.stringify(directoryManifest, null, 2),
    )
    const rootCid = await this.uploadFile(
      manifestContent,
      `${app.name}-manifest.json`,
      'application/json',
    )

    // Find index.html CID
    const indexFile = uploadedFiles.find((f) => f.path === 'index.html')
    const indexCid = indexFile?.cid || rootCid

    console.log(`  ✅ Upload complete`)
    console.log(`     Root CID: ${rootCid}`)
    console.log(`     Index CID: ${indexCid}`)
    console.log(`     Total Size: ${this.formatSize(totalSize)}`)

    return {
      app: app.name,
      buildDir,
      files: uploadedFiles,
      rootCid,
      indexCid,
      totalSize,
      jnsName: app.manifest.jns?.name,
      uploadedAt: new Date().toISOString(),
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

  private async uploadFile(
    content: Buffer,
    filename: string,
    contentType: string,
  ): Promise<string> {
    const formData = new FormData()
    const blob = new Blob([content], { type: contentType })
    formData.append('file', blob, filename)
    formData.append('permanent', 'true')

    const response = await fetch(`${this.dwsEndpoint}/storage/upload`, {
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

    const result = (await response.json()) as { cid: string }
    return result.cid
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  private saveResults(): void {
    const resultPath = join(
      ROOT_DIR,
      `frontend-upload-result-${this.network}.json`,
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
      '║                    UPLOAD COMPLETE                                   ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')

    console.log('Uploaded Frontends:')
    for (const result of this.results) {
      console.log(`  ✅ ${result.app}`)
      console.log(`     Root CID: ${result.rootCid}`)
      console.log(`     Files: ${result.files.length}`)
      console.log(`     Size: ${this.formatSize(result.totalSize)}`)
      if (result.jnsName) {
        console.log(`     JNS: ${result.jnsName}`)
      }
    }
    console.log('')

    console.log('Total Stats:')
    const totalFiles = this.results.reduce((sum, r) => sum + r.files.length, 0)
    const totalSize = this.results.reduce((sum, r) => sum + r.totalSize, 0)
    console.log(`  Apps: ${this.results.length}`)
    console.log(`  Files: ${totalFiles}`)
    console.log(`  Size: ${this.formatSize(totalSize)}`)
    console.log('')

    console.log('🚀 Next Steps:')
    console.log('   1. Update JNS records with content hashes:')
    console.log('      bun run scripts/deploy/register-jns.ts')
    console.log('')
    console.log('   2. Access frontends via JNS or IPFS gateway:')
    for (const result of this.results) {
      if (result.jnsName) {
        console.log(`      https://${result.jnsName}`)
      }
      console.log(`      ${this.dwsEndpoint}/ipfs/${result.indexCid}`)
    }
    console.log('')
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const network = (process.argv[2] || 'testnet') as 'testnet' | 'mainnet'
  const uploader = new FrontendUploader(network)
  await uploader.run()
}

main().catch((err) => {
  console.error('Upload failed:', err)
  process.exit(1)
})

export { FrontendUploader, type FrontendUploadResult }
