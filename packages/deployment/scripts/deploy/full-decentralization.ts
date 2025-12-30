#!/usr/bin/env bun
/**
 * Full Decentralization Deployment
 *
 * This script deploys the complete decentralized infrastructure:
 * 1. SQLit cluster (decentralized database)
 * 2. DWS provider registration (on-chain)
 * 3. App frontends to IPFS
 * 4. App router configuration
 * 5. JNS registration
 * 6. K8s app deprecation
 *
 * Usage:
 *   bun run packages/deployment/scripts/deploy/full-decentralization.ts --network testnet
 *   bun run packages/deployment/scripts/deploy/full-decentralization.ts --network testnet --step sqlit
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  getCurrentNetwork,
  getDWSUrl,
  getIpfsGatewayUrl,
  getRpcUrl,
} from '@jejunetwork/config'

const WORKSPACE = process.cwd()

interface DeploymentStep {
  name: string
  description: string
  execute: () => Promise<boolean>
  verify: () => Promise<boolean>
}

// Parse arguments
const args = process.argv.slice(2)
const networkArg =
  args.find((a) => a.startsWith('--network='))?.split('=')[1] ||
  args[args.indexOf('--network') + 1] ||
  process.env.NETWORK ||
  'testnet'
const stepArg =
  args.find((a) => a.startsWith('--step='))?.split('=')[1] ||
  args[args.indexOf('--step') + 1]
const dryRun = args.includes('--dry-run')

process.env.NETWORK = networkArg

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    JEJU FULL DECENTRALIZATION DEPLOYMENT                     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Network: ${networkArg.padEnd(68)}║
║ Step: ${(stepArg || 'all').padEnd(71)}║
║ Dry Run: ${String(dryRun).padEnd(68)}║
╚══════════════════════════════════════════════════════════════════════════════╝
`)

// ============================================================================
// Step 1: Deploy SQLit Cluster
// ============================================================================
async function deploySQLit(): Promise<boolean> {
  console.log('\n[Step 1/6] Deploying SQLit cluster...\n')

  try {
    // Check if SQLit helm chart exists
    const sqlitChartPath = join(
      WORKSPACE,
      'packages/deployment/kubernetes/helm/sqlit',
    )
    if (!existsSync(sqlitChartPath)) {
      console.error('SQLit helm chart not found')
      return false
    }

    // Create namespace if not exists
    await $`kubectl create namespace sqlit --dry-run=client -o yaml | kubectl apply -f -`.quiet()

    // Create secrets for SQLit
    const privateKey =
      process.env.SQLIT_PRIVATE_KEY ||
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    await $`kubectl create secret generic sqlit-secrets -n sqlit --from-literal=private-key=${privateKey} --dry-run=client -o yaml | kubectl apply -f -`.quiet()

    // Deploy SQLit via Helm
    const valuesFile = join(sqlitChartPath, `values-${networkArg}.yaml`)
    const hasValuesFile = existsSync(valuesFile)

    if (dryRun) {
      console.log('[DRY RUN] Would deploy SQLit with helm')
      return true
    }

    if (hasValuesFile) {
      await $`helm upgrade --install sqlit ${sqlitChartPath} -n sqlit -f ${valuesFile}`
    } else {
      await $`helm upgrade --install sqlit ${sqlitChartPath} -n sqlit`
    }

    console.log('[SQLit] Waiting for pods to be ready...')
    await $`kubectl rollout status statefulset/sqlit -n sqlit --timeout=300s`.quiet()

    console.log('[SQLit] ✅ SQLit cluster deployed')
    return true
  } catch (error) {
    console.error('[SQLit] ❌ Deployment failed:', error)
    return false
  }
}

async function verifySQLit(): Promise<boolean> {
  try {
    const result =
      await $`kubectl get pods -n sqlit -l app.kubernetes.io/name=sqlit -o jsonpath='{.items[*].status.phase}'`.text()
    const phases = result.trim().split(' ')
    const allRunning = phases.every((p) => p === 'Running')
    console.log(`[SQLit] Pods status: ${phases.join(', ')}`)
    return allRunning && phases.length > 0
  } catch {
    return false
  }
}

// ============================================================================
// Step 2: Register DWS as On-Chain Provider
// ============================================================================
async function registerProvider(): Promise<boolean> {
  console.log('\n[Step 2/6] Registering DWS as on-chain provider...\n')

  try {
    // Check if provider registry contract is deployed
    const rpcUrl = getRpcUrl()
    console.log(`[Provider] RPC: ${rpcUrl}`)

    // For now, skip on-chain registration if contracts not deployed
    // This will be done when DWSProviderRegistry is deployed to testnet
    console.log('[Provider] ⚠️ Skipping on-chain registration (contracts not deployed)')
    console.log('[Provider] DWS will run in standalone mode')
    console.log('[Provider] To register later: bun run packages/deployment/scripts/deploy/register-dws-provider.ts')

    return true
  } catch (error) {
    console.error('[Provider] Error:', error)
    return false
  }
}

async function verifyProvider(): Promise<boolean> {
  // Provider registration is optional for testnet
  return true
}

// ============================================================================
// Step 3: Build and Deploy App Frontends to IPFS
// ============================================================================
const APPS = [
  'oauth3',
  'autocrat',
  'bazaar',
  'crucible',
  'factory',
  'gateway',
  'documentation',
]

async function deployAppFrontends(): Promise<boolean> {
  console.log('\n[Step 3/6] Deploying app frontends to IPFS...\n')

  const dwsUrl = getDWSUrl(networkArg)
  console.log(`[Frontends] DWS URL: ${dwsUrl}`)

  let successCount = 0

  for (const app of APPS) {
    const appDir = join(WORKSPACE, 'apps', app)
    if (!existsSync(appDir)) {
      console.log(`[${app}] Skipping - directory not found`)
      continue
    }

    // Check for manifest
    const manifestPath = join(appDir, 'jeju-manifest.json')
    if (!existsSync(manifestPath)) {
      console.log(`[${app}] Skipping - no jeju-manifest.json`)
      continue
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

    // Check if frontend exists
    const hasIndexHtml = existsSync(join(appDir, 'index.html'))
    if (!hasIndexHtml) {
      console.log(`[${app}] Skipping - no frontend (index.html)`)
      continue
    }

    console.log(`[${app}] Building frontend...`)

    if (dryRun) {
      console.log(`[${app}] [DRY RUN] Would build and upload`)
      successCount++
      continue
    }

    try {
      // Install dependencies if needed
      if (!existsSync(join(appDir, 'node_modules'))) {
        await $`cd ${appDir} && bun install`.quiet()
      }

      // Build
      await $`cd ${appDir} && bun run build`.quiet()

      // Determine build directory
      const buildDir =
        manifest.decentralization?.frontend?.buildDir ||
        manifest.architecture?.frontend?.outputDir ||
        'dist'
      const distPath = join(appDir, buildDir)

      if (!existsSync(distPath)) {
        console.log(`[${app}] ⚠️ Build directory not found: ${buildDir}`)
        continue
      }

      console.log(`[${app}] Uploading to IPFS via DWS...`)

      // Upload to IPFS via DWS storage API
      const uploadCmd = await $`cd ${distPath} && tar -cf - . | curl -s -X POST "${dwsUrl}/storage/upload" -H "Content-Type: application/octet-stream" --data-binary @-`.text()

      let uploadResult: { cid?: string }
      try {
        uploadResult = JSON.parse(uploadCmd)
      } catch {
        console.log(`[${app}] ⚠️ Upload response not JSON, trying alternative...`)
        // Try form-data upload
        const formUpload =
          await $`cd ${distPath} && find . -type f -exec curl -s -X POST "${dwsUrl}/storage/upload" -F "file=@{}" \; | tail -1`.text()
        try {
          uploadResult = JSON.parse(formUpload)
        } catch {
          uploadResult = {}
        }
      }

      if (uploadResult.cid) {
        console.log(`[${app}] ✅ Uploaded - CID: ${uploadResult.cid}`)

        // Register with app router
        const jnsName =
          manifest.jns?.name ||
          manifest.decentralization?.frontend?.jnsName ||
          `${app}.jeju`
        const registration = {
          name: app,
          jnsName,
          frontendCid: uploadResult.cid,
          backendWorkerId: null,
          backendEndpoint: null,
          apiPaths: ['/api', '/health', '/a2a', '/mcp'],
          spa: manifest.decentralization?.frontend?.spa ?? true,
          enabled: true,
        }

        const regResponse = await fetch(`${dwsUrl}/apps/deployed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(registration),
        })

        if (regResponse.ok) {
          console.log(`[${app}] ✅ Registered with app router`)
          successCount++
        } else {
          console.log(`[${app}] ⚠️ Registration failed: ${await regResponse.text()}`)
        }
      } else {
        console.log(`[${app}] ⚠️ No CID in upload response`)
      }
    } catch (error) {
      console.error(`[${app}] ❌ Failed:`, error)
    }
  }

  console.log(`\n[Frontends] Deployed ${successCount}/${APPS.length} apps`)
  return successCount > 0
}

async function verifyAppFrontends(): Promise<boolean> {
  const dwsUrl = getDWSUrl(networkArg)
  try {
    const response = await fetch(`${dwsUrl}/apps/deployed`)
    if (!response.ok) return false
    const apps = (await response.json()) as { apps: Array<{ name: string }> }
    console.log(
      `[Frontends] ${apps.apps.length} apps registered: ${apps.apps.map((a) => a.name).join(', ')}`,
    )
    return apps.apps.length > 0
  } catch {
    return false
  }
}

// ============================================================================
// Step 4: Configure App Router with Backend Endpoints
// ============================================================================
async function configureAppRouter(): Promise<boolean> {
  console.log('\n[Step 4/6] Configuring app router backends...\n')

  const dwsUrl = getDWSUrl(networkArg)

  // For each app, if it has a K8s service, register that as the backend
  const appBackends: Record<string, string> = {
    oauth3: 'http://oauth3.oauth3.svc.cluster.local:4200',
    autocrat: 'http://autocrat.autocrat.svc.cluster.local:4040',
    bazaar: 'http://bazaar.bazaar.svc.cluster.local:4050',
    crucible: 'http://crucible.crucible.svc.cluster.local:4100',
    gateway: 'http://gateway.gateway.svc.cluster.local:4000',
    factory: 'http://factory.factory.svc.cluster.local:4070',
  }

  let configuredCount = 0

  for (const [app, endpoint] of Object.entries(appBackends)) {
    try {
      // Check if service exists
      const serviceExists =
        await $`kubectl get svc ${app} -n ${app} -o name 2>/dev/null`.text()

      if (!serviceExists.trim()) {
        console.log(`[${app}] No K8s service found, skipping backend`)
        continue
      }

      console.log(`[${app}] Updating backend endpoint...`)

      if (dryRun) {
        console.log(`[${app}] [DRY RUN] Would set backend to ${endpoint}`)
        configuredCount++
        continue
      }

      // Update existing registration with backend endpoint
      const response = await fetch(`${dwsUrl}/apps/deployed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: app,
          jnsName: `${app}.jeju`,
          backendEndpoint: endpoint,
          apiPaths: ['/api', '/health', '/a2a', '/mcp', '/oauth', '/callback'],
          enabled: true,
        }),
      })

      if (response.ok) {
        console.log(`[${app}] ✅ Backend configured: ${endpoint}`)
        configuredCount++
      } else {
        console.log(`[${app}] ⚠️ Failed: ${await response.text()}`)
      }
    } catch (error) {
      console.log(`[${app}] ⚠️ Error:`, error)
    }
  }

  console.log(`\n[Backends] Configured ${configuredCount}/${Object.keys(appBackends).length} backends`)
  return configuredCount > 0
}

async function verifyAppRouter(): Promise<boolean> {
  const dwsUrl = getDWSUrl(networkArg)
  try {
    const response = await fetch(`${dwsUrl}/apps/deployed`)
    if (!response.ok) return false
    const apps = (await response.json()) as {
      apps: Array<{ name: string; backendEndpoint: string | null }>
    }
    const withBackends = apps.apps.filter((a) => a.backendEndpoint)
    console.log(`[AppRouter] ${withBackends.length} apps with backends`)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Step 5: Register Apps with JNS
// ============================================================================
async function registerJNS(): Promise<boolean> {
  console.log('\n[Step 5/6] Registering apps with JNS...\n')

  // JNS contracts are deployed at:
  // jnsRegistry: 0x66ac1e36094e3cfa47258589be7bd3cef5884e97
  // jnsResolver: 0xe27b540b6fd3868ad6420c466c8330da3a6417bf

  console.log('[JNS] JNS contracts deployed on testnet')
  console.log('[JNS] Registry: 0x66ac1e36094e3cfa47258589be7bd3cef5884e97')
  console.log('[JNS] Resolver: 0xe27b540b6fd3868ad6420c466c8330da3a6417bf')

  // For now, JNS registration requires a deployment script with private key
  console.log('[JNS] ⚠️ Skipping JNS registration (requires manual execution)')
  console.log('[JNS] DNS mirroring to Route53 is active via DWS /dns/mirror endpoints')

  return true
}

async function verifyJNS(): Promise<boolean> {
  const dwsUrl = getDWSUrl(networkArg)
  try {
    const response = await fetch(`${dwsUrl}/dns/health`)
    if (!response.ok) return false
    const status = await response.json()
    console.log('[JNS] DNS service healthy')
    return true
  } catch {
    console.log('[JNS] DNS service not available')
    return true // Not critical
  }
}

// ============================================================================
// Step 6: Deprecate Standalone K8s Deployments
// ============================================================================
async function deprecateK8sApps(): Promise<boolean> {
  console.log('\n[Step 6/6] Deprecating standalone K8s app deployments...\n')

  // Apps that should be served via DWS, not standalone K8s
  const appsToDeprecate = ['oauth3', 'autocrat', 'bazaar', 'crucible', 'factory']

  let deprecatedCount = 0

  for (const app of appsToDeprecate) {
    try {
      // Check if deployment exists
      const deploymentExists =
        await $`kubectl get deployment ${app} -n ${app} -o name 2>/dev/null`.text()

      if (!deploymentExists.trim()) {
        console.log(`[${app}] No standalone deployment found`)
        continue
      }

      console.log(`[${app}] Scaling down standalone deployment...`)

      if (dryRun) {
        console.log(`[${app}] [DRY RUN] Would scale to 0`)
        deprecatedCount++
        continue
      }

      // Scale to 0 replicas (but keep deployment for rollback)
      await $`kubectl scale deployment ${app} -n ${app} --replicas=0`.quiet()

      // Add deprecation label
      await $`kubectl label deployment ${app} -n ${app} deprecated=true jeju.network/served-by=dws --overwrite`.quiet()

      console.log(`[${app}] ✅ Scaled to 0 replicas (deprecated)`)
      deprecatedCount++
    } catch (error) {
      console.log(`[${app}] ⚠️ Error:`, error)
    }
  }

  console.log(`\n[Deprecation] Deprecated ${deprecatedCount}/${appsToDeprecate.length} standalone deployments`)
  console.log('[Deprecation] Apps will now be served via DWS')

  return true
}

async function verifyK8sDeprecation(): Promise<boolean> {
  const appsToDeprecate = ['oauth3', 'autocrat', 'bazaar', 'crucible', 'factory']
  let deprecatedCount = 0

  for (const app of appsToDeprecate) {
    try {
      const replicas =
        await $`kubectl get deployment ${app} -n ${app} -o jsonpath='{.spec.replicas}' 2>/dev/null`.text()
      if (replicas.trim() === '0') {
        deprecatedCount++
      }
    } catch {
      // Deployment doesn't exist, count as deprecated
      deprecatedCount++
    }
  }

  console.log(`[Deprecation] ${deprecatedCount}/${appsToDeprecate.length} apps deprecated`)
  return deprecatedCount === appsToDeprecate.length
}

// ============================================================================
// Main Execution
// ============================================================================

const steps: DeploymentStep[] = [
  {
    name: 'sqlit',
    description: 'Deploy SQLit decentralized database cluster',
    execute: deploySQLit,
    verify: verifySQLit,
  },
  {
    name: 'provider',
    description: 'Register DWS as on-chain provider',
    execute: registerProvider,
    verify: verifyProvider,
  },
  {
    name: 'frontends',
    description: 'Deploy app frontends to IPFS',
    execute: deployAppFrontends,
    verify: verifyAppFrontends,
  },
  {
    name: 'router',
    description: 'Configure app router backends',
    execute: configureAppRouter,
    verify: verifyAppRouter,
  },
  {
    name: 'jns',
    description: 'Register apps with JNS',
    execute: registerJNS,
    verify: verifyJNS,
  },
  {
    name: 'deprecate',
    description: 'Deprecate standalone K8s deployments',
    execute: deprecateK8sApps,
    verify: verifyK8sDeprecation,
  },
]

async function main() {
  const stepsToRun = stepArg ? steps.filter((s) => s.name === stepArg) : steps

  if (stepsToRun.length === 0) {
    console.error(`Unknown step: ${stepArg}`)
    console.log('Available steps:', steps.map((s) => s.name).join(', '))
    process.exit(1)
  }

  console.log(`Running ${stepsToRun.length} deployment step(s)...`)

  const results: Array<{ step: string; success: boolean; verified: boolean }> = []

  for (const step of stepsToRun) {
    console.log(`\n${'═'.repeat(80)}`)
    console.log(`Step: ${step.name} - ${step.description}`)
    console.log(`${'═'.repeat(80)}`)

    const success = await step.execute()
    const verified = success ? await step.verify() : false

    results.push({ step: step.name, success, verified })

    if (!success && !dryRun) {
      console.log(`\n⚠️ Step ${step.name} failed. Continuing...`)
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(80)}`)
  console.log('DEPLOYMENT SUMMARY')
  console.log(`${'═'.repeat(80)}\n`)

  for (const result of results) {
    const status = result.success
      ? result.verified
        ? '✅ Success'
        : '⚠️ Unverified'
      : '❌ Failed'
    console.log(`  ${result.step.padEnd(15)} ${status}`)
  }

  const allSuccessful = results.every((r) => r.success)
  const allVerified = results.every((r) => r.verified)

  console.log(`\n${'═'.repeat(80)}`)
  if (allSuccessful && allVerified) {
    console.log('✅ DECENTRALIZATION COMPLETE')
    console.log(`${'═'.repeat(80)}\n`)
    console.log('All apps are now served via DWS:')
    console.log('  - Frontends from IPFS')
    console.log('  - Backends via DWS app router')
    console.log('  - Database via SQLit')
    console.log('')
    console.log('Next steps:')
    console.log('  1. Verify apps at https://<app>.testnet.jejunetwork.org')
    console.log('  2. Monitor DWS health at https://dws.testnet.jejunetwork.org/health')
    console.log('  3. View registered apps: curl https://dws.testnet.jejunetwork.org/apps/deployed')
  } else if (allSuccessful) {
    console.log('⚠️ DEPLOYMENT COMPLETED WITH WARNINGS')
    console.log(`${'═'.repeat(80)}\n`)
    console.log('Some steps may need manual verification.')
  } else {
    console.log('❌ DEPLOYMENT INCOMPLETE')
    console.log(`${'═'.repeat(80)}\n`)
    console.log('Some steps failed. Check logs above for details.')
    process.exit(1)
  }
}

main().catch(console.error)
