#!/usr/bin/env bun
/**
 * Testnet Readiness Check (Decentralized Deployment)
 *
 * Validates testnet deployment health:
 * - RPC endpoint connectivity
 * - Contract deployments
 * - DWS services
 * - App accessibility via JNS
 *
 * Usage:
 *   bun run scripts/verify/check-testnet-readiness.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, http, namehash } from 'viem'

const ROOT = join(import.meta.dir, '../../../..')

interface CheckResult {
  category: string
  name: string
  status: 'pass' | 'fail' | 'warn'
  message: string
}

const results: CheckResult[] = []

function addResult(
  category: string,
  name: string,
  status: 'pass' | 'fail' | 'warn',
  message: string,
): void {
  results.push({ category, name, status, message })
  const icon = status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : '❌'
  console.log(`${icon}  ${name}: ${message}`)
}

async function checkRPCEndpoint(
  name: string,
  url: string,
  category: string,
): Promise<boolean> {
  try {
    const client = createPublicClient({ transport: http(url) })
    const blockNumber = await client.getBlockNumber()
    addResult(category, name, 'pass', `Block #${blockNumber}`)
    return true
  } catch (error) {
    addResult(category, name, 'fail', `Not reachable: ${error}`)
    return false
  }
}

async function checkDWSEndpoint(
  name: string,
  url: string,
  category: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`)
    if (response.ok) {
      const data = await response.json()
      addResult(category, name, 'pass', data.status ?? 'healthy')
      return true
    }
    addResult(category, name, 'fail', `HTTP ${response.status}`)
    return false
  } catch (error) {
    addResult(category, name, 'fail', `Not reachable: ${error}`)
    return false
  }
}

// Exported for potential use by other scripts
export async function checkJNSResolution(
  name: string,
  jnsName: string,
  resolverUrl: string,
  category: string,
): Promise<boolean> {
  try {
    // Compute node hash for potential contract calls
    void namehash(jnsName)
    const response = await fetch(
      `${resolverUrl}/resolve?name=${encodeURIComponent(jnsName)}`,
    )
    if (response.ok) {
      const data = (await response.json()) as { contenthash?: string }
      if (data.contenthash) {
        addResult(
          category,
          name,
          'pass',
          `CID: ${data.contenthash.slice(0, 20)}...`,
        )
        return true
      }
    }
    addResult(category, name, 'warn', 'No contenthash set')
    return false
  } catch (error) {
    addResult(category, name, 'warn', `Resolution failed: ${error}`)
    return false
  }
}

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   🔍 TESTNET READINESS CHECK                                             ║
║                                                                          ║
║   Verifying decentralized deployment health                              ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
`)

  // Check deployment file
  const deploymentFile = join(
    ROOT,
    'packages/contracts/deployments/testnet-dws.json',
  )
  const hasDeployment = existsSync(deploymentFile)

  // Chain connectivity
  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 Chain Connectivity')
  console.log(`${'═'.repeat(70)}\n`)

  await checkRPCEndpoint(
    'Jeju Testnet RPC',
    'https://testnet-rpc.jejunetwork.org',
    'Chain',
  )

  // DWS Services
  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 DWS Services')
  console.log(`${'═'.repeat(70)}\n`)

  await checkDWSEndpoint(
    'DWS API',
    'https://dws.testnet.jejunetwork.org',
    'DWS',
  )

  await checkDWSEndpoint(
    'IPFS Gateway',
    'https://ipfs.testnet.jejunetwork.org',
    'DWS',
  )

  // Contract Deployments
  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 Contract Deployments')
  console.log(`${'═'.repeat(70)}\n`)

  if (hasDeployment) {
    try {
      const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'))
      const contracts = deployment.contracts ?? deployment

      if (contracts.StorageManager ?? contracts.storageManager) {
        addResult(
          'Contracts',
          'StorageManager',
          'pass',
          contracts.StorageManager ?? contracts.storageManager,
        )
      } else {
        addResult('Contracts', 'StorageManager', 'fail', 'Not deployed')
      }

      if (contracts.WorkerRegistry ?? contracts.workerRegistry) {
        addResult(
          'Contracts',
          'WorkerRegistry',
          'pass',
          contracts.WorkerRegistry ?? contracts.workerRegistry,
        )
      } else {
        addResult('Contracts', 'WorkerRegistry', 'fail', 'Not deployed')
      }

      if (contracts.JNSRegistry ?? contracts.jnsRegistry) {
        addResult(
          'Contracts',
          'JNSRegistry',
          'pass',
          contracts.JNSRegistry ?? contracts.jnsRegistry,
        )
      } else {
        addResult('Contracts', 'JNSRegistry', 'fail', 'Not deployed')
      }
    } catch (error) {
      addResult('Contracts', 'Deployment File', 'fail', `Parse error: ${error}`)
    }
  } else {
    addResult(
      'Contracts',
      'Deployment File',
      'warn',
      'testnet-dws.json not found',
    )
  }

  // App Accessibility
  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 App Accessibility')
  console.log(`${'═'.repeat(70)}\n`)

  const apps = ['dws', 'oauth3', 'autocrat', 'crucible', 'bazaar']
  for (const app of apps) {
    try {
      const url = `https://${app}.testnet.jejunetwork.org`
      const response = await fetch(url, { method: 'HEAD' })
      if (response.ok || response.status === 405 || response.status === 302) {
        addResult('Apps', app, 'pass', `Accessible at ${url}`)
      } else {
        addResult('Apps', app, 'warn', `HTTP ${response.status}`)
      }
    } catch (_error) {
      addResult('Apps', app, 'warn', 'Not accessible')
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 Summary')
  console.log(`${'═'.repeat(70)}\n`)

  const passed = results.filter((r) => r.status === 'pass').length
  const warned = results.filter((r) => r.status === 'warn').length
  const failed = results.filter((r) => r.status === 'fail').length

  console.log(`Total Checks: ${results.length}`)
  console.log(`✅ Passed: ${passed}`)
  console.log(`⚠️ Warnings: ${warned}`)
  console.log(`❌ Failed: ${failed}`)

  const criticalFailed = results.filter(
    (r) =>
      r.status === 'fail' &&
      (r.category === 'Chain' || r.category === 'Contracts'),
  ).length

  if (criticalFailed > 0) {
    console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  ❌ TESTNET NOT READY                                                    ║
║                                                                          ║
║  Critical checks failed. Run deployment first:                           ║
║  NETWORK=testnet bun run packages/deployment/scripts/deploy/dws-bootstrap.ts ║
╚══════════════════════════════════════════════════════════════════════════╝
`)
    process.exit(1)
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  ✅ TESTNET READY                                                        ║
║                                                                          ║
║  Decentralized deployment is operational.                                ║
╚══════════════════════════════════════════════════════════════════════════╝
`)
}

main().catch((error) => {
  console.error('❌ Readiness check failed:', error.message)
  process.exit(1)
})
