#!/usr/bin/env bun

/**
 * Testnet Deployment Verification
 *
 * Performs end-to-end verification of the entire Jeju testnet deployment:
 * 1. Contract deployment verification
 * 2. DWS service health checks
 * 3. Storage upload/download test
 * 4. Git operations test
 * 5. NPM registry test
 * 6. Container registry test
 * 7. Model registry test
 * 8. JNS resolution test
 * 9. Frontend accessibility test
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Address, createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { CIDUploadResponseSchema, expectValid } from '../../schemas'

// Configuration

interface VerificationResult {
  category: string
  test: string
  status: 'pass' | 'fail' | 'skip'
  message: string
  duration?: number
}

interface VerificationReport {
  network: 'testnet'
  timestamp: string
  results: VerificationResult[]
  summary: {
    total: number
    passed: number
    failed: number
    skipped: number
  }
}

const ROOT_DIR = join(import.meta.dir, '../..')

// Verifier Class

class TestnetVerifier {
  private rpcUrl: string
  private dwsEndpoint: string
  private publicClient
  private results: VerificationResult[] = []
  private addresses: Record<string, Address> = {}

  constructor() {
    this.rpcUrl = process.env.TESTNET_RPC_URL || 'https://sepolia.base.org'
    this.dwsEndpoint =
      process.env.DWS_ENDPOINT || 'https://dws.testnet.jejunetwork.org'

    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.rpcUrl),
    })

    // Load addresses
    const addressesPath = join(
      ROOT_DIR,
      'packages/contracts/deployments/testnet/addresses.json',
    )
    if (existsSync(addressesPath)) {
      this.addresses = JSON.parse(readFileSync(addressesPath, 'utf-8'))
    }
  }

  async run(): Promise<VerificationReport> {
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║          JEJU TESTNET VERIFICATION                                   ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')
    console.log(`RPC URL: ${this.rpcUrl}`)
    console.log(`DWS Endpoint: ${this.dwsEndpoint}`)
    console.log('')

    // Run all verification tests
    await this.verifyContracts()
    await this.verifyDWSHealth()
    await this.verifyStorage()
    await this.verifyGit()
    await this.verifyNPM()
    await this.verifyContainerRegistry()
    await this.verifyModelRegistry()
    await this.verifyJNS()
    await this.verifyFrontends()

    // Generate report
    const report = this.generateReport()
    this.printReport(report)

    return report
  }

  private async verifyContracts(): Promise<void> {
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Verifying Contracts')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    const contracts = [
      { name: 'IdentityRegistry', key: 'identityRegistry' },
      { name: 'ReputationRegistry', key: 'reputationRegistry' },
      { name: 'ValidationRegistry', key: 'validationRegistry' },
      { name: 'RepoRegistry', key: 'repoRegistry' },
      { name: 'PackageRegistry', key: 'packageRegistry' },
      { name: 'ContainerRegistry', key: 'containerRegistry' },
      { name: 'ModelRegistry', key: 'modelRegistry' },
      { name: 'JNSRegistry', key: 'jnsRegistry' },
      { name: 'JNSRegistrar', key: 'jnsRegistrar' },
      { name: 'JNSResolver', key: 'jnsResolver' },
      { name: 'StorageManager', key: 'storageManager' },
    ]

    for (const contract of contracts) {
      const start = Date.now()
      const address = this.addresses[contract.key]

      if (!address) {
        this.addResult('Contracts', contract.name, 'skip', 'Address not found')
        continue
      }

      const code = await this.publicClient.getCode({ address })
      const hasCode = code && code !== '0x' && code.length > 2

      if (hasCode) {
        this.addResult(
          'Contracts',
          contract.name,
          'pass',
          `Deployed at ${address}`,
          Date.now() - start,
        )
      } else {
        this.addResult(
          'Contracts',
          contract.name,
          'fail',
          `No code at ${address}`,
          Date.now() - start,
        )
      }
    }
    console.log('')
  }

  private async verifyDWSHealth(): Promise<void> {
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Verifying DWS Health')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    const endpoints = [
      { name: 'Health Check', path: '/health' },
      { name: 'API Info', path: '/api/info' },
      { name: 'Storage API', path: '/storage/info' },
      { name: 'Git API', path: '/git/info' },
      { name: 'NPM API', path: '/npm/-/ping' },
    ]

    for (const endpoint of endpoints) {
      const start = Date.now()

      const response = await fetch(`${this.dwsEndpoint}${endpoint.path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      }).catch(() => null)

      if (response?.ok) {
        this.addResult(
          'DWS Health',
          endpoint.name,
          'pass',
          `HTTP ${response.status}`,
          Date.now() - start,
        )
      } else if (response) {
        this.addResult(
          'DWS Health',
          endpoint.name,
          'fail',
          `HTTP ${response.status}`,
          Date.now() - start,
        )
      } else {
        this.addResult(
          'DWS Health',
          endpoint.name,
          'fail',
          'Connection failed',
          Date.now() - start,
        )
      }
    }
    console.log('')
  }

  private async verifyStorage(): Promise<void> {
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Verifying Storage')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    // Test upload
    const start = Date.now()
    const testContent = `Test file uploaded at ${new Date().toISOString()}`
    const testFile = new Blob([testContent], { type: 'text/plain' })

    const formData = new FormData()
    formData.append('file', testFile, 'test.txt')

    const uploadResponse = await fetch(`${this.dwsEndpoint}/storage/upload`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(30000),
    }).catch(() => null)

    if (!uploadResponse || !uploadResponse.ok) {
      this.addResult(
        'Storage',
        'Upload',
        'fail',
        'Upload failed',
        Date.now() - start,
      )
      this.addResult(
        'Storage',
        'Download',
        'skip',
        'Skipped due to upload failure',
      )
      console.log('')
      return
    }

    const uploadResultRaw = await uploadResponse.json()
    const uploadResult = expectValid(
      CIDUploadResponseSchema,
      uploadResultRaw,
      'upload response',
    )
    this.addResult(
      'Storage',
      'Upload',
      'pass',
      `CID: ${uploadResult.cid}`,
      Date.now() - start,
    )

    // Test download
    const downloadStart = Date.now()
    const downloadResponse = await fetch(
      `${this.dwsEndpoint}/ipfs/${uploadResult.cid}`,
      {
        signal: AbortSignal.timeout(30000),
      },
    ).catch(() => null)

    if (downloadResponse?.ok) {
      const content = await downloadResponse.text()
      if (content === testContent) {
        this.addResult(
          'Storage',
          'Download',
          'pass',
          'Content matches',
          Date.now() - downloadStart,
        )
      } else {
        this.addResult(
          'Storage',
          'Download',
          'fail',
          'Content mismatch',
          Date.now() - downloadStart,
        )
      }
    } else {
      this.addResult(
        'Storage',
        'Download',
        'fail',
        'Download failed',
        Date.now() - downloadStart,
      )
    }
    console.log('')
  }

  private async verifyGit(): Promise<void> {
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Verifying Git')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    const start = Date.now()

    // Test listing repos
    const response = await fetch(`${this.dwsEndpoint}/git/api/repos`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (response?.ok) {
      const repos = await response.json()
      this.addResult(
        'Git',
        'List Repos',
        'pass',
        `Found ${Array.isArray(repos) ? repos.length : 0} repos`,
        Date.now() - start,
      )
    } else {
      this.addResult(
        'Git',
        'List Repos',
        'fail',
        response ? `HTTP ${response.status}` : 'Connection failed',
        Date.now() - start,
      )
    }

    // Test info/refs endpoint (Git protocol)
    const infoStart = Date.now()
    const infoResponse = await fetch(
      `${this.dwsEndpoint}/git/jeju/jeju.git/info/refs?service=git-upload-pack`,
      {
        signal: AbortSignal.timeout(10000),
      },
    ).catch(() => null)

    if (infoResponse && (infoResponse.ok || infoResponse.status === 404)) {
      // 404 is acceptable if repo doesn't exist yet
      this.addResult(
        'Git',
        'Git Protocol',
        'pass',
        infoResponse.ok ? 'Ready' : 'No repos yet',
        Date.now() - infoStart,
      )
    } else {
      this.addResult(
        'Git',
        'Git Protocol',
        'fail',
        'Protocol not working',
        Date.now() - infoStart,
      )
    }
    console.log('')
  }

  private async verifyNPM(): Promise<void> {
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Verifying NPM Registry')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    // Test ping
    const start = Date.now()
    const pingResponse = await fetch(`${this.dwsEndpoint}/npm/-/ping`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (pingResponse?.ok) {
      this.addResult(
        'NPM',
        'Ping',
        'pass',
        'Registry responding',
        Date.now() - start,
      )
    } else {
      this.addResult(
        'NPM',
        'Ping',
        'fail',
        'Registry not responding',
        Date.now() - start,
      )
    }

    // Test package lookup
    const lookupStart = Date.now()
    const lookupResponse = await fetch(
      `${this.dwsEndpoint}/npm/@jejunetwork/sdk`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      },
    ).catch(() => null)

    if (
      lookupResponse &&
      (lookupResponse.ok || lookupResponse.status === 404)
    ) {
      this.addResult(
        'NPM',
        'Package Lookup',
        'pass',
        lookupResponse.ok ? 'Package found' : 'No packages yet',
        Date.now() - lookupStart,
      )
    } else {
      this.addResult(
        'NPM',
        'Package Lookup',
        'fail',
        'Lookup failed',
        Date.now() - lookupStart,
      )
    }
    console.log('')
  }

  private async verifyContainerRegistry(): Promise<void> {
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Verifying Container Registry')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    // Test v2 endpoint
    const start = Date.now()
    const v2Response = await fetch(`${this.dwsEndpoint}/v2/`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (v2Response && (v2Response.ok || v2Response.status === 401)) {
      // 401 is acceptable as it means the endpoint exists but needs auth
      this.addResult(
        'Container Registry',
        'V2 API',
        'pass',
        'Registry responding',
        Date.now() - start,
      )
    } else {
      this.addResult(
        'Container Registry',
        'V2 API',
        'fail',
        'Registry not responding',
        Date.now() - start,
      )
    }

    // Test catalog
    const catalogStart = Date.now()
    const catalogResponse = await fetch(`${this.dwsEndpoint}/v2/_catalog`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (
      catalogResponse &&
      (catalogResponse.ok ||
        catalogResponse.status === 404 ||
        catalogResponse.status === 401)
    ) {
      this.addResult(
        'Container Registry',
        'Catalog',
        'pass',
        catalogResponse.ok ? 'Catalog available' : 'No images yet',
        Date.now() - catalogStart,
      )
    } else {
      this.addResult(
        'Container Registry',
        'Catalog',
        'fail',
        'Catalog unavailable',
        Date.now() - catalogStart,
      )
    }
    console.log('')
  }

  private async verifyModelRegistry(): Promise<void> {
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Verifying Model Registry')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    // Test models API
    const start = Date.now()
    const response = await fetch(`${this.dwsEndpoint}/api/models`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (response?.ok) {
      const models = await response.json()
      this.addResult(
        'Models',
        'List Models',
        'pass',
        `Found ${Array.isArray(models) ? models.length : 0} models`,
        Date.now() - start,
      )
    } else if (response && response.status === 404) {
      this.addResult(
        'Models',
        'List Models',
        'pass',
        'No models yet',
        Date.now() - start,
      )
    } else {
      this.addResult(
        'Models',
        'List Models',
        'fail',
        'API not responding',
        Date.now() - start,
      )
    }
    console.log('')
  }

  private async verifyJNS(): Promise<void> {
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Verifying JNS')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    const names = ['dws.jeju', 'git.jeju', 'npm.jeju', 'gateway.jeju']

    for (const name of names) {
      const start = Date.now()

      // Test resolution via DWS
      const response = await fetch(`${this.dwsEndpoint}/jns/resolve/${name}`, {
        signal: AbortSignal.timeout(10000),
      }).catch(() => null)

      if (response?.ok) {
        this.addResult(
          'JNS',
          `Resolve ${name}`,
          'pass',
          'Resolved',
          Date.now() - start,
        )
      } else if (response && response.status === 404) {
        this.addResult(
          'JNS',
          `Resolve ${name}`,
          'pass',
          'Not registered yet',
          Date.now() - start,
        )
      } else {
        this.addResult(
          'JNS',
          `Resolve ${name}`,
          'fail',
          'Resolution failed',
          Date.now() - start,
        )
      }
    }
    console.log('')
  }

  private async verifyFrontends(): Promise<void> {
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )
    console.log('Verifying Frontends')
    console.log(
      '═══════════════════════════════════════════════════════════════════════',
    )

    // Load frontend results
    const resultPath = join(ROOT_DIR, 'frontend-upload-result-testnet.json')
    if (!existsSync(resultPath)) {
      this.addResult(
        'Frontends',
        'Load Results',
        'skip',
        'No frontend upload results found',
      )
      console.log('')
      return
    }

    const results = JSON.parse(readFileSync(resultPath, 'utf-8'))

    for (const frontend of results) {
      const start = Date.now()

      const response = await fetch(
        `${this.dwsEndpoint}/ipfs/${frontend.indexCid}`,
        {
          signal: AbortSignal.timeout(10000),
        },
      ).catch(() => null)

      if (response?.ok) {
        const content = await response.text()
        if (content.includes('<html') || content.includes('<!DOCTYPE')) {
          this.addResult(
            'Frontends',
            frontend.app,
            'pass',
            'Accessible via IPFS',
            Date.now() - start,
          )
        } else {
          this.addResult(
            'Frontends',
            frontend.app,
            'fail',
            'Invalid HTML',
            Date.now() - start,
          )
        }
      } else {
        this.addResult(
          'Frontends',
          frontend.app,
          'fail',
          'Not accessible',
          Date.now() - start,
        )
      }
    }
    console.log('')
  }

  private addResult(
    category: string,
    test: string,
    status: 'pass' | 'fail' | 'skip',
    message: string,
    duration?: number,
  ): void {
    const result: VerificationResult = {
      category,
      test,
      status,
      message,
      duration,
    }
    this.results.push(result)

    const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⏭️'
    const durationStr = duration !== undefined ? ` (${duration}ms)` : ''
    console.log(`  ${icon} ${test}: ${message}${durationStr}`)
  }

  private generateReport(): VerificationReport {
    const passed = this.results.filter((r) => r.status === 'pass').length
    const failed = this.results.filter((r) => r.status === 'fail').length
    const skipped = this.results.filter((r) => r.status === 'skip').length

    return {
      network: 'testnet',
      timestamp: new Date().toISOString(),
      results: this.results,
      summary: {
        total: this.results.length,
        passed,
        failed,
        skipped,
      },
    }
  }

  private printReport(report: VerificationReport): void {
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║                    VERIFICATION REPORT                               ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')

    const { summary } = report
    console.log('Summary:')
    console.log(`  Total:   ${summary.total}`)
    console.log(
      `  Passed:  ${summary.passed} (${((summary.passed / summary.total) * 100).toFixed(1)}%)`,
    )
    console.log(`  Failed:  ${summary.failed}`)
    console.log(`  Skipped: ${summary.skipped}`)
    console.log('')

    if (summary.failed > 0) {
      console.log('Failed Tests:')
      for (const result of report.results.filter((r) => r.status === 'fail')) {
        console.log(
          `  ❌ [${result.category}] ${result.test}: ${result.message}`,
        )
      }
      console.log('')
    }

    const overallStatus =
      summary.failed === 0
        ? '✅ ALL TESTS PASSED'
        : `❌ ${summary.failed} TESTS FAILED`
    console.log(`Overall: ${overallStatus}`)
    console.log('')

    if (summary.failed > 0) {
      console.log('Next Steps to Fix:')
      const categories = new Set(
        report.results
          .filter((r) => r.status === 'fail')
          .map((r) => r.category),
      )

      if (categories.has('Contracts')) {
        console.log(
          '  1. Deploy missing contracts: NETWORK=testnet bun run packages/deployment/scripts/deploy/testnet-babylon-full.ts',
        )
      }
      if (categories.has('DWS Health')) {
        console.log(
          '  2. Deploy DWS to Kubernetes: helm upgrade --install dws ./packages/deployment/kubernetes/helm/dws -f values-testnet.yaml',
        )
      }
      if (categories.has('Storage')) {
        console.log('  3. Check DWS storage backend configuration')
      }
      if (categories.has('Frontends')) {
        console.log(
          '  4. Upload frontends: bun run scripts/deploy/upload-frontends.ts',
        )
      }
      if (categories.has('JNS')) {
        console.log(
          '  5. Register JNS names: bun run scripts/deploy/register-jns.ts',
        )
      }
      console.log('')
    }
  }
}

// CLI Entry Point

async function main() {
  const verifier = new TestnetVerifier()
  const report = await verifier.run()

  // Exit with error code if any tests failed
  if (report.summary.failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Verification failed:', err)
  process.exit(1)
})

export { TestnetVerifier, type VerificationReport }
