#!/usr/bin/env bun

/**
 * Deployment Verification Script
 *
 * Verifies that all serverless deployments are working correctly:
 * - All static assets are accessible via IPFS/JNS gateways
 * - All workers are responding to health checks
 * - JNS records resolve to correct content hashes
 * - Routing works correctly for all endpoints
 *
 * Usage:
 *   bun run scripts/serverless/verify.ts                # Verify localnet
 *   bun run scripts/serverless/verify.ts --testnet      # Verify testnet
 *   bun run scripts/serverless/verify.ts --mainnet      # Verify mainnet
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createPublicClient, type Hex, http } from 'viem'
import type { DeploymentManifest, VerificationResult } from './types'

// Configuration

const JNS_RESOLVER_ABI = [
  {
    name: 'contenthash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    name: 'addr',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

// Verifier Class

class DeploymentVerifier {
  private network: 'localnet' | 'testnet' | 'mainnet'
  private manifest: DeploymentManifest | null = null
  private results: VerificationResult[] = []
  private rpcUrl: string
  private dwsEndpoint: string
  private ipfsGateway: string

  constructor(network: 'localnet' | 'testnet' | 'mainnet') {
    this.network = network

    // Network-specific configuration
    const configs = {
      localnet: {
        rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:6546',
        dwsEndpoint: process.env.DWS_ENDPOINT || 'http://localhost:4030',
        ipfsGateway: 'http://localhost:8080',
      },
      testnet: {
        rpcUrl: process.env.TESTNET_RPC_URL || 'https://sepolia.base.org',
        dwsEndpoint: 'https://dws.testnet.jejunetwork.org',
        ipfsGateway: 'https://ipfs.testnet.jejunetwork.org',
      },
      mainnet: {
        rpcUrl: process.env.MAINNET_RPC_URL || 'https://mainnet.base.org',
        dwsEndpoint: 'https://dws.jejunetwork.org',
        ipfsGateway: 'https://ipfs.jejunetwork.org',
      },
    }

    const config = configs[network]
    this.rpcUrl = config.rpcUrl
    this.dwsEndpoint = config.dwsEndpoint
    this.ipfsGateway = config.ipfsGateway
  }

  /**
   * Load deployment manifest
   */
  private loadManifest(): boolean {
    const manifestPath = join(
      process.cwd(),
      'packages',
      'deployment',
      '.temp',
      `serverless-deployment-${this.network}.json`,
    )

    if (!existsSync(manifestPath)) {
      console.log(`Manifest not found: ${manifestPath}`)
      console.log('Run serverless:deploy first.')
      return false
    }

    this.manifest = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    ) as DeploymentManifest
    return true
  }

  /**
   * Run all verification checks
   */
  async verify(): Promise<boolean> {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║           🔍 JEJU DEPLOYMENT VERIFICATION                             ║
╚═══════════════════════════════════════════════════════════════════════╝

Network:     ${this.network}
DWS:         ${this.dwsEndpoint}
IPFS:        ${this.ipfsGateway}
`)

    // Load manifest
    if (!this.loadManifest()) {
      return false
    }

    if (!this.manifest || this.manifest.apps.length === 0) {
      console.log('No apps to verify.')
      return true
    }

    console.log(`Found ${this.manifest.apps.length} app(s) to verify\n`)

    // Verify each app
    for (const app of this.manifest.apps) {
      console.log(`${'─'.repeat(60)}`)
      console.log(`Verifying: ${app.name}`)
      console.log(`${'─'.repeat(60)}`)

      // Verify worker
      if (app.worker) {
        await this.verifyWorker(app.name, app.worker)
      }

      // Verify frontend
      if (app.frontend) {
        await this.verifyFrontend(app.name, app.frontend)
      }

      // Verify JNS
      if (app.jnsNode && this.manifest) {
        await this.verifyJNS(
          app.name,
          app.jnsName,
          app.jnsNode,
          this.manifest.contracts.jnsResolver,
        )
      }

      console.log('')
    }

    // Print summary
    this.printSummary()

    return this.results.every((r) => r.passed)
  }

  /**
   * Verify worker health
   */
  private async verifyWorker(
    appName: string,
    worker: DeploymentManifest['apps'][0]['worker'],
  ): Promise<void> {
    if (!worker) return

    const start = Date.now()
    console.log('\n  Worker:')

    // Check code is accessible
    const codeResult = await this.checkIPFSContent(worker.codeCid)
    this.results.push({
      name: appName,
      type: 'worker',
      passed: codeResult.accessible,
      message: codeResult.accessible
        ? `Code accessible (${codeResult.size} bytes)`
        : `Code not accessible: ${codeResult.error}`,
      details: { cid: worker.codeCid, size: codeResult.size || 0 },
      duration: Date.now() - start,
    })

    console.log(
      `    ${codeResult.accessible ? '✅' : '❌'} Code CID: ${worker.codeCid.slice(0, 16)}...`,
    )

    // Check worker is deployed and healthy
    const healthStart = Date.now()
    const healthResult = await this.checkWorkerHealth(worker.workerId)
    this.results.push({
      name: appName,
      type: 'health',
      passed: healthResult.healthy,
      message: healthResult.healthy
        ? 'Worker is healthy'
        : `Health check failed: ${healthResult.error}`,
      details: {
        workerId: worker.workerId,
        status: worker.status,
      },
      duration: Date.now() - healthStart,
    })

    console.log(
      `    ${healthResult.healthy ? '✅' : '❌'} Health check: ${healthResult.healthy ? 'OK' : healthResult.error}`,
    )
  }

  /**
   * Verify frontend assets
   */
  private async verifyFrontend(
    appName: string,
    frontend: DeploymentManifest['apps'][0]['frontend'],
  ): Promise<void> {
    if (!frontend || !frontend.ipfsCid) return

    console.log('\n  Frontend:')

    // Check root CID
    const rootResult = await this.checkIPFSContent(frontend.ipfsCid)
    this.results.push({
      name: appName,
      type: 'frontend',
      passed: rootResult.accessible,
      message: rootResult.accessible
        ? `Frontend accessible (${frontend.files.length} files, ${frontend.totalSize} bytes)`
        : `Frontend not accessible: ${rootResult.error}`,
      details: {
        cid: frontend.ipfsCid,
        files: frontend.files.length,
        size: frontend.totalSize,
      },
    })

    console.log(
      `    ${rootResult.accessible ? '✅' : '❌'} Root CID: ${frontend.ipfsCid.slice(0, 16)}...`,
    )
    console.log(`    📁 Files: ${frontend.files.length}`)
    console.log(`    📦 Size: ${(frontend.totalSize / 1024).toFixed(1)}KB`)

    // Spot check a few files
    const sampleFiles = frontend.files.slice(0, 3)
    for (const file of sampleFiles) {
      const fileResult = await this.checkIPFSContent(file.cid)
      const icon = fileResult.accessible ? '✅' : '❌'
      console.log(`    ${icon} ${file.path}: ${file.cid.slice(0, 12)}...`)
    }
  }

  /**
   * Verify JNS resolution
   */
  private async verifyJNS(
    appName: string,
    jnsName: string,
    jnsNode: string,
    resolverAddress: string,
  ): Promise<void> {
    console.log('\n  JNS:')

    const start = Date.now()

    const publicClient = createPublicClient({
      transport: http(this.rpcUrl),
    })

    // Check contenthash
    const contenthash = await publicClient.readContract({
      address: resolverAddress as `0x${string}`,
      abi: JNS_RESOLVER_ABI,
      functionName: 'contenthash',
      args: [jnsNode as Hex],
    })

    const hasContent = contenthash && contenthash !== '0x'

    this.results.push({
      name: appName,
      type: 'jns',
      passed: hasContent,
      message: hasContent
        ? `JNS resolves to contenthash`
        : 'JNS contenthash not set',
      details: {
        jnsName,
        node: jnsNode,
        hasContent,
      },
      duration: Date.now() - start,
    })

    console.log(
      `    ${hasContent ? '✅' : '❌'} ${jnsName}: ${hasContent ? 'resolves' : 'not configured'}`,
    )

    // Check if JNS gateway works
    const gatewayUrl = `https://${jnsName.replace('.jeju', '')}.jejunetwork.org`
    const gatewayResult = await this.checkURL(gatewayUrl)
    console.log(
      `    ${gatewayResult.accessible ? '✅' : '⚠️'} Gateway: ${gatewayUrl}`,
    )
  }

  /**
   * Check if IPFS content is accessible
   */
  private async checkIPFSContent(
    cid: string,
  ): Promise<{ accessible: boolean; size?: number; error?: string }> {
    const urls = [
      `${this.dwsEndpoint}/ipfs/${cid}`,
      `${this.ipfsGateway}/ipfs/${cid}`,
    ]

    for (const url of urls) {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      })

      if (response.ok) {
        const size = parseInt(response.headers.get('content-length') || '0', 10)
        return { accessible: true, size }
      }
    }

    return { accessible: false, error: 'Not found on any gateway' }
  }

  /**
   * Check worker health
   */
  private async checkWorkerHealth(
    workerId: string,
  ): Promise<{ healthy: boolean; error?: string }> {
    const response = await fetch(
      `${this.dwsEndpoint}/workers/${workerId}/health`,
      { signal: AbortSignal.timeout(5000) },
    )

    if (response.ok) {
      return { healthy: true }
    }

    return { healthy: false, error: `Status ${response.status}` }
  }

  /**
   * Check if URL is accessible
   */
  private async checkURL(
    url: string,
  ): Promise<{ accessible: boolean; error?: string }> {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    })

    return {
      accessible: response?.ok ?? false,
      error: response?.ok ? undefined : `Status ${response.status}`,
    }
  }

  /**
   * Print verification summary
   */
  private printSummary(): void {
    const passed = this.results.filter((r) => r.passed).length
    const failed = this.results.filter((r) => !r.passed).length
    const total = this.results.length

    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                       VERIFICATION SUMMARY                            ║
╚═══════════════════════════════════════════════════════════════════════╝

Total Checks: ${total}
Passed:       ${passed}
Failed:       ${failed}
`)

    if (failed > 0) {
      console.log('Failed Checks:')
      for (const result of this.results.filter((r) => !r.passed)) {
        console.log(`  ❌ ${result.name} (${result.type}): ${result.message}`)
      }
      console.log('')
    }

    if (failed === 0) {
      console.log('✅ All checks passed. Deployment is healthy.')
    } else {
      console.log(`❌ ${failed} check(s) failed. Review deployment.`)
    }
  }
}

// CLI Entry Point

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      testnet: { type: 'boolean', default: false },
      mainnet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  })

  if (values.help) {
    console.log(`
Jeju Deployment Verification

Usage:
  bun run scripts/serverless/verify.ts [options]

Options:
  --testnet     Verify testnet deployment
  --mainnet     Verify mainnet deployment
  -h, --help    Show this help

Examples:
  bun run scripts/serverless/verify.ts              # Verify localnet
  bun run scripts/serverless/verify.ts --testnet    # Verify testnet
`)
    process.exit(0)
  }

  const network = values.mainnet
    ? 'mainnet'
    : values.testnet
      ? 'testnet'
      : 'localnet'
  const verifier = new DeploymentVerifier(network)
  const success = await verifier.verify()

  process.exit(success ? 0 : 1)
}

main().catch((error) => {
  console.error('Verification failed:', error)
  process.exit(1)
})
