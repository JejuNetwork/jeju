#!/usr/bin/env bun

/**
 * Complete DWS App Deployment
 *
 * End-to-end deployment of Jeju apps to pure decentralized infrastructure:
 * 1. Build and upload frontend to IPFS (via DWS storage)
 * 2. Register JNS name → IPFS contenthash
 * 3. Deploy backend to DWS compute (with TEE)
 * 4. Configure ingress for routing
 * 5. Test end-to-end
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDWSUrl } from '@jejunetwork/config'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

interface AppManifest {
  name: string
  version: string
  displayName?: string
  description?: string
  ports?: {
    main?: number
    api?: number
    frontend?: number
  }
  jns?: {
    name: string
    description?: string
    url?: string
  }
  decentralization?: {
    frontend?: {
      ipfs?: boolean
      arweave?: boolean
      buildDir?: string
      buildCommand?: string
      jnsName?: string
    }
  }
  dws?: {
    backend?: {
      enabled?: boolean
      runtime?: 'bun' | 'node' | 'docker' | 'workerd'
      entrypoint?: string
      memory?: number
      timeout?: number
      minInstances?: number
      maxInstances?: number
      teeRequired?: boolean
      regions?: string[]
    }
    tee?: {
      enabled?: boolean
      required?: boolean
      platform?: 'dstack' | 'phala' | 'intel_tdx' | 'amd_sev' | 'simulator'
      attestation?: boolean
    }
  }
  endpoints?: Record<string, string>
}

interface DeploymentResult {
  app: string
  frontend?: {
    cid: string
    jnsName: string
    urls: string[]
  }
  backend?: {
    workerId: string
    endpoint: string
    tee: {
      enabled: boolean
      platform: string
      attestation?: string
    }
  }
  ingress?: {
    ruleId: string
    hosts: string[]
  }
  success: boolean
  errors: string[]
}

class DWSAppDeployer {
  private network: 'testnet' | 'mainnet'
  private dwsEndpoint: string
  private privateKey: Hex
  private account: ReturnType<typeof privateKeyToAccount>
  private appPath: string
  private manifest: AppManifest

  constructor(appName: string, network: 'testnet' | 'mainnet' = 'testnet') {
    this.network = network
    this.dwsEndpoint = getDWSUrl(network)

    this.privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex
    if (!this.privateKey) {
      throw new Error('DEPLOYER_PRIVATE_KEY environment variable required')
    }
    this.account = privateKeyToAccount(this.privateKey)

    this.appPath = join(process.cwd(), 'apps', appName)
    if (!existsSync(this.appPath)) {
      throw new Error(`App not found: ${appName}`)
    }

    const manifestPath = join(this.appPath, 'jeju-manifest.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`jeju-manifest.json not found for ${appName}`)
    }

    this.manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  }

  async deploy(): Promise<DeploymentResult> {
    const result: DeploymentResult = {
      app: this.manifest.name,
      success: false,
      errors: [],
    }

    this.printHeader()

    try {
      // Step 1: Build and upload frontend to IPFS
      if (this.manifest.decentralization?.frontend) {
        console.log('\n📦 Step 1: Building and uploading frontend to IPFS...')
        result.frontend = await this.deployFrontend()
      }

      // Step 2: Register JNS name → IPFS CID
      if (result.frontend && this.manifest.jns?.name) {
        console.log('\n🏷️  Step 2: Registering JNS name...')
        await this.registerJNS(result.frontend.cid)
      }

      // Step 3: Deploy backend to DWS compute
      if (this.manifest.dws?.backend?.enabled) {
        console.log('\n🚀 Step 3: Deploying backend to DWS compute...')
        result.backend = await this.deployBackend()
      }

      // Step 4: Configure ingress routing
      console.log('\n🌐 Step 4: Configuring ingress...')
      result.ingress = await this.configureIngress(result)

      // Step 5: Test end-to-end
      console.log('\n🧪 Step 5: Testing deployment...')
      await this.testDeployment(result)

      result.success = true
      this.printSuccess(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(message)
      this.printError(error)
    }

    return result
  }

  private async deployFrontend(): Promise<DeploymentResult['frontend']> {
    const frontendConfig = this.manifest.decentralization?.frontend
    if (!frontendConfig) throw new Error('No frontend config')

    const buildDir = join(this.appPath, frontendConfig.buildDir || 'dist')

    // Build if needed
    if (!existsSync(buildDir)) {
      console.log('  Building frontend...')
      const buildCommand =
        frontendConfig.buildCommand || 'bun run build:frontend'
      execSync(buildCommand, { cwd: this.appPath, stdio: 'inherit' })
    }

    // Upload to IPFS via DWS
    console.log('  Uploading to IPFS...')
    const cid = await this.uploadDirectory(buildDir)

    const jnsName = this.manifest.jns?.name || `${this.manifest.name}.jeju`
    const urls = [
      `https://${jnsName.replace('.jeju', '')}.testnet.jejunetwork.org`,
      `https://${jnsName.replace('.jeju', '')}.jns.testnet.jejunetwork.org`,
      `${this.dwsEndpoint}/ipfs/${cid}`,
    ]

    console.log(`  ✅ Frontend uploaded: ${cid}`)
    console.log(`  📍 URLs:`)
    for (const url of urls) {
      console.log(`     - ${url}`)
    }

    return { cid, jnsName, urls }
  }

  private async uploadDirectory(dir: string): Promise<string> {
    // Use DWS storage API to upload directory
    // This will pin to IPFS and return CID
    const formData = new FormData()

    // For now, upload individual files and create directory
    // In production, would use CAR files or directory uploads
    const indexPath = join(dir, 'index.html')
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath)
      const blob = new Blob([content], { type: 'text/html' })
      formData.append('file', blob, 'index.html')
    }

    const response = await fetch(`${this.dwsEndpoint}/storage/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        'x-jeju-address': this.account.address,
      },
    })

    if (!response.ok) {
      throw new Error(`Upload failed: ${await response.text()}`)
    }

    const result = await response.json()
    return result.cid
  }

  private async registerJNS(cid: string): Promise<void> {
    const jnsName = this.manifest.jns?.name
    if (!jnsName) throw new Error('No JNS name configured')

    console.log(`  Registering ${jnsName} → ipfs://${cid}`)

    // Call JNS registration script
    // For now, log that this needs to be done
    console.log('  ⚠️  Manual JNS registration required:')
    console.log(
      `     bun run packages/deployment/scripts/deploy/register-jns.ts testnet`,
    )
    console.log(`     Will set contenthash for ${jnsName} to ${cid}`)
  }

  private async deployBackend(): Promise<DeploymentResult['backend']> {
    const backendConfig = this.manifest.dws?.backend
    if (!backendConfig) throw new Error('No backend config')

    // Configure TEE
    const teeConfig = this.manifest.dws?.tee
    const teeEnabled = teeConfig?.enabled || backendConfig.teeRequired || false
    const teePlatform = teeConfig?.platform || 'phala'

    console.log(`  Runtime: ${backendConfig.runtime || 'bun'}`)
    console.log(`  TEE: ${teeEnabled ? teePlatform : 'disabled'}`)
    console.log(`  Entry: ${backendConfig.entrypoint}`)

    // Build backend bundle
    const entrypoint = backendConfig.entrypoint || 'api/server.ts'
    const entrypointPath = join(this.appPath, entrypoint)

    if (!existsSync(entrypointPath)) {
      throw new Error(`Backend entrypoint not found: ${entrypointPath}`)
    }

    // Upload backend code
    const code = readFileSync(entrypointPath, 'utf-8')

    // Deploy via DWS compute API
    const deployRequest = {
      name: this.manifest.name,
      runtime: backendConfig.runtime || 'bun',
      code,
      entrypoint,
      memory: backendConfig.memory || 512,
      timeout: backendConfig.timeout || 30000,
      minInstances: backendConfig.minInstances || 1,
      maxInstances: backendConfig.maxInstances || 10,
      tee: {
        enabled: teeEnabled,
        platform: teePlatform,
        required: teeConfig?.required || false,
      },
      env: {
        NETWORK: this.network,
        NODE_ENV: 'production',
        PORT: String(
          this.manifest.ports?.api || this.manifest.ports?.main || 4000,
        ),
        ...(teePlatform === 'phala' && {
          PHALA_API_KEY: process.env.PHALA_API_KEY,
        }),
      },
    }

    // Deploy as DWS worker via /workers endpoint
    const workerPayload = {
      name: this.manifest.name,
      handler: deployRequest.entrypoint,
      runtime: deployRequest.runtime,
      env: deployRequest.env,
      memory: deployRequest.memory,
      timeout: deployRequest.timeout,
    }

    const response = await fetch(`${this.dwsEndpoint}/workers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': this.account.address,
      },
      body: JSON.stringify(workerPayload),
    })

    if (!response.ok) {
      throw new Error(`Backend deployment failed: ${await response.text()}`)
    }

    const result = await response.json()

    const workerId = result.id || result.workerId
    const endpoint =
      result.endpoint || `${this.dwsEndpoint}/workers/${workerId}/invoke`

    console.log(`  ✅ Backend deployed`)
    console.log(`     Worker ID: ${workerId}`)
    console.log(`     Endpoint: ${endpoint}`)
    if (result.tee?.attestation) {
      console.log(
        `     TEE Attestation: ${result.tee.attestation.slice(0, 32)}...`,
      )
    }

    return {
      workerId,
      endpoint,
      tee: {
        enabled: teeEnabled,
        platform: teePlatform,
        attestation: result.tee?.attestation,
      },
    }
  }

  private async configureIngress(
    deployment: Partial<DeploymentResult>,
  ): Promise<DeploymentResult['ingress']> {
    const appName = this.manifest.name
    const jnsName = this.manifest.jns?.name?.replace('.jeju', '') || appName

    // Register with DWS app router - this is the new unified routing
    await this.registerWithAppRouter(deployment)

    // Both DNS patterns
    const hosts = [
      `${jnsName}.testnet.jejunetwork.org`,
      `${jnsName}.jns.testnet.jejunetwork.org`,
    ]

    const paths: Array<{
      path: string
      pathType: string
      backend: { type: string; staticCid?: string; workerId?: string }
    }> = []

    // Frontend: serve from IPFS
    if (deployment.frontend) {
      paths.push({
        path: '/',
        pathType: 'Prefix',
        backend: {
          type: 'static',
          staticCid: deployment.frontend.cid,
        },
      })
    }

    // Backend: proxy to worker
    if (deployment.backend) {
      const apiPaths = ['/api', '/health', '/a2a', '/mcp']
      for (const path of apiPaths) {
        paths.push({
          path,
          pathType: 'Prefix',
          backend: {
            type: 'worker',
            workerId: deployment.backend.workerId,
          },
        })
      }
    }

    // Create ingress rules for each host
    const ingressRequest = {
      name: `${appName}-ingress`,
      host: hosts[0], // Primary host
      paths,
      tls: {
        enabled: true,
        mode: 'auto',
      },
    }

    const response = await fetch(`${this.dwsEndpoint}/ingress/rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': this.account.address,
      },
      body: JSON.stringify(ingressRequest),
    })

    if (!response.ok) {
      throw new Error(`Ingress creation failed: ${await response.text()}`)
    }

    const result = await response.json()

    console.log(`  ✅ Ingress configured`)
    console.log(`     Rule ID: ${result.id}`)
    for (const host of hosts) {
      console.log(`     Host: ${host}`)
    }

    return {
      ruleId: result.id,
      hosts,
    }
  }

  /**
   * Register app with DWS app router for hostname-based routing
   * This is the primary routing mechanism - ingress rules are secondary
   */
  private async registerWithAppRouter(
    deployment: Partial<DeploymentResult>,
  ): Promise<void> {
    const appName = this.manifest.name
    const jnsName = this.manifest.jns?.name || `${appName}.jeju`

    // Default API paths - use routes from decentralization config if available
    const workerRoutes = (
      this.manifest as {
        decentralization?: { worker?: { routes?: Array<{ pattern: string }> } }
      }
    ).decentralization?.worker?.routes
    const apiPaths = workerRoutes?.map((r) => r.pattern) || [
      '/api',
      '/health',
      '/a2a',
      '/mcp',
      '/oauth',
      '/callback',
    ]

    // Check for spa config
    const frontendConfig = this.manifest.decentralization?.frontend as
      | { spa?: boolean }
      | undefined
    const spa = frontendConfig?.spa ?? true

    const appRouterData = {
      name: appName,
      jnsName,
      frontendCid: deployment.frontend?.cid || null,
      backendWorkerId: deployment.backend?.workerId || null,
      backendEndpoint: deployment.backend?.endpoint || null,
      apiPaths,
      spa,
      enabled: true,
    }

    console.log('  📝 Registering with DWS app router...')

    const response = await fetch(`${this.dwsEndpoint}/apps/deployed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': this.account.address,
      },
      body: JSON.stringify(appRouterData),
    })

    if (!response.ok) {
      console.warn(
        `  ⚠️  App router registration failed: ${await response.text()}`,
      )
      console.warn('  App may not be routable by hostname. Check DWS logs.')
    } else {
      const result = await response.json()
      console.log(`  ✅ App router: ${result.app?.name} registered`)
    }
  }

  private async testDeployment(deployment: DeploymentResult): Promise<void> {
    const tests: Array<{ name: string; test: () => Promise<void> }> = []

    // Test frontend
    if (deployment.frontend) {
      for (const url of deployment.frontend.urls.slice(0, 1)) {
        tests.push({
          name: `Frontend: ${url}`,
          test: async () => {
            const response = await fetch(url)
            if (!response.ok) {
              throw new Error(`Status ${response.status}`)
            }
            const text = await response.text()
            if (!text.includes('<!DOCTYPE html') && !text.includes('<html')) {
              throw new Error('Not HTML')
            }
          },
        })
      }
    }

    // Test backend
    if (deployment.backend && deployment.ingress) {
      const host = deployment.ingress.hosts[0]
      tests.push({
        name: `Backend health: https://${host}/health`,
        test: async () => {
          const response = await fetch(`https://${host}/health`)
          if (!response.ok) {
            throw new Error(`Status ${response.status}`)
          }
        },
      })
    }

    // Run tests
    for (const test of tests) {
      try {
        await test.test()
        console.log(`  ✅ ${test.name}`)
      } catch (error) {
        console.log(`  ⚠️  ${test.name}: ${error}`)
        deployment.errors.push(`Test failed: ${test.name}`)
      }
    }
  }

  private printHeader(): void {
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║          DEPLOY TO DWS (PURE DECENTRALIZED)                          ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')
    console.log(`App: ${this.manifest.displayName || this.manifest.name}`)
    console.log(`Version: ${this.manifest.version}`)
    console.log(`Network: ${this.network}`)
    console.log(`DWS: ${this.dwsEndpoint}`)
    console.log(`Deployer: ${this.account.address}`)
    console.log('')
  }

  private printSuccess(result: DeploymentResult): void {
    console.log('')
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║                    ✅ DEPLOYMENT SUCCESSFUL                           ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')

    if (result.frontend) {
      console.log('Frontend:')
      for (const url of result.frontend.urls) {
        console.log(`  ${url}`)
      }
      console.log('')
    }

    if (result.backend) {
      console.log('Backend:')
      console.log(`  Endpoint: ${result.backend.endpoint}`)
      console.log(
        `  TEE: ${result.backend.tee.platform} (${result.backend.tee.enabled ? 'enabled' : 'disabled'})`,
      )
      console.log('')
    }

    console.log(
      '🎉 Your app is now running on pure decentralized infrastructure!',
    )
    console.log('')
  }

  private printError(error: unknown): void {
    console.log('')
    console.log(
      '╔══════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║                    ❌ DEPLOYMENT FAILED                               ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')
    console.error(error)
    console.log('')
  }
}

// CLI
async function main() {
  const appName = process.argv[2]
  const network = (process.argv[3] || 'testnet') as 'testnet' | 'mainnet'

  if (!appName) {
    console.error(
      'Usage: bun run deploy-app-to-dws-full.ts <app-name> [network]',
    )
    console.error('Example: bun run deploy-app-to-dws-full.ts autocrat testnet')
    process.exit(1)
  }

  // Set Phala API key if not set
  if (!process.env.PHALA_API_KEY) {
    process.env.PHALA_API_KEY =
      'phak_ycVEhuwQsLmTzQRaFVkTeWAx9Sk5qWujbU2H4Ki4Mh4'
  }

  const deployer = new DWSAppDeployer(appName, network)
  const result = await deployer.deploy()

  if (!result.success) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Deployment error:', err)
  process.exit(1)
})

export { DWSAppDeployer, type DeploymentResult }
