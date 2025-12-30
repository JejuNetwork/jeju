#!/usr/bin/env tsx

/**
 * Decentralization Health Check Script
 *
 * Verifies that the Jeju infrastructure is properly decentralized
 * and not relying on centralized services.
 *
 * Usage:
 *   npx tsx scripts/health/check-decentralization.ts
 */

import { execSync } from 'node:child_process'
import { createPublicClient, http } from 'viem'

interface CheckResult {
  name: string
  category: string
  status: 'pass' | 'fail' | 'warn'
  message: string
  details?: Record<string, string | number | boolean>
}

const CONFIG = {
  rpcUrl: process.env.JEJU_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
  namespace: process.env.KUBE_NAMESPACE || 'dws',
}

const checks: CheckResult[] = []

function addCheck(check: CheckResult) {
  checks.push(check)
  const icon =
    check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌'
  console.log(`${icon} [${check.category}] ${check.name}: ${check.message}`)
}

async function checkStorageBackend() {
  try {
    // Check if storage is using IPFS instead of S3
    const configMap = execSync(
      `kubectl get configmap -n ${CONFIG.namespace} dws-config -o jsonpath='{.data.STORAGE_BACKEND}'`,
      { encoding: 'utf-8' },
    ).trim()

    if (configMap === 'ipfs' || configMap === 'ipfs,arweave') {
      addCheck({
        name: 'Storage Backend',
        category: 'Storage',
        status: 'pass',
        message: `Using decentralized storage: ${configMap}`,
      })
    } else if (configMap === 's3' || configMap.includes('s3')) {
      addCheck({
        name: 'Storage Backend',
        category: 'Storage',
        status: 'fail',
        message: `Still using centralized S3 storage: ${configMap}`,
      })
    } else {
      addCheck({
        name: 'Storage Backend',
        category: 'Storage',
        status: 'warn',
        message: `Unknown storage backend: ${configMap}`,
      })
    }
  } catch (error) {
    addCheck({
      name: 'Storage Backend',
      category: 'Storage',
      status: 'warn',
      message: `Could not determine storage backend: ${error}`,
    })
  }
}

async function checkDatabaseBackend() {
  try {
    // Check for SQLit pods instead of RDS connection
    const sqlitPods = execSync(
      `kubectl get pods -n ${CONFIG.namespace} -l app.kubernetes.io/name=sqlit -o name 2>/dev/null | wc -l`,
      { encoding: 'utf-8' },
    ).trim()

    const podCount = parseInt(sqlitPods, 10)

    if (podCount >= 3) {
      addCheck({
        name: 'Database Backend',
        category: 'Database',
        status: 'pass',
        message: `Using SQLit with ${podCount} replicas (decentralized)`,
      })
    } else if (podCount > 0) {
      addCheck({
        name: 'Database Backend',
        category: 'Database',
        status: 'warn',
        message: `SQLit running but only ${podCount} replicas (need 3 for HA)`,
      })
    } else {
      // Check for RDS connection strings
      const secrets = execSync(
        `kubectl get secrets -n ${CONFIG.namespace} -o name 2>/dev/null`,
        { encoding: 'utf-8' },
      )

      if (secrets.includes('rds') || secrets.includes('postgres-aws')) {
        addCheck({
          name: 'Database Backend',
          category: 'Database',
          status: 'fail',
          message: 'Still using AWS RDS for database',
        })
      } else {
        addCheck({
          name: 'Database Backend',
          category: 'Database',
          status: 'warn',
          message: 'SQLit not found, database backend unclear',
        })
      }
    }
  } catch (error) {
    addCheck({
      name: 'Database Backend',
      category: 'Database',
      status: 'warn',
      message: `Could not check database backend: ${error}`,
    })
  }
}

async function checkContainerRegistry() {
  try {
    // Check image sources in deployments
    const images = execSync(
      `kubectl get deployments -n ${CONFIG.namespace} -o jsonpath='{.items[*].spec.template.spec.containers[*].image}' 2>/dev/null`,
      { encoding: 'utf-8' },
    )

    const awsEcr = images.includes('ecr') || images.includes('amazonaws.com')
    const gcr = images.includes('gcr.io')
    // const dockerHub = images.includes("docker.io") && !images.includes("registry.jeju");
    const decentralized = images.includes('registry.jeju')

    if (decentralized && !awsEcr && !gcr) {
      addCheck({
        name: 'Container Registry',
        category: 'Registry',
        status: 'pass',
        message: 'Using decentralized registry (registry.jeju)',
      })
    } else if (awsEcr) {
      addCheck({
        name: 'Container Registry',
        category: 'Registry',
        status: 'fail',
        message: 'Still using AWS ECR for container images',
      })
    } else if (gcr) {
      addCheck({
        name: 'Container Registry',
        category: 'Registry',
        status: 'fail',
        message: 'Still using Google Container Registry',
      })
    } else {
      addCheck({
        name: 'Container Registry',
        category: 'Registry',
        status: 'warn',
        message: 'Container registry source unclear',
        details: { images: images.split(' ').slice(0, 5) },
      })
    }
  } catch (error) {
    addCheck({
      name: 'Container Registry',
      category: 'Registry',
      status: 'warn',
      message: `Could not check container registry: ${error}`,
    })
  }
}

async function checkDnsBackend() {
  try {
    // Check for JNS DNS pods
    const jnsPods = execSync(
      `kubectl get pods -n ${CONFIG.namespace} -l app.kubernetes.io/name=jns-dns -o name 2>/dev/null | wc -l`,
      { encoding: 'utf-8' },
    ).trim()

    const podCount = parseInt(jnsPods, 10)

    if (podCount >= 2) {
      addCheck({
        name: 'DNS Backend',
        category: 'DNS',
        status: 'pass',
        message: `Using JNS DNS with ${podCount} replicas (decentralized)`,
      })
    } else if (podCount > 0) {
      addCheck({
        name: 'DNS Backend',
        category: 'DNS',
        status: 'warn',
        message: `JNS DNS running but only ${podCount} replicas`,
      })
    } else {
      // Check for Route53 references
      const ingresses = execSync(
        `kubectl get ingress -n ${CONFIG.namespace} -o yaml 2>/dev/null`,
        { encoding: 'utf-8' },
      )

      if (ingresses.includes('external-dns.alpha.kubernetes.io/hostname')) {
        addCheck({
          name: 'DNS Backend',
          category: 'DNS',
          status: 'fail',
          message: 'Still using external-dns with Route53',
        })
      } else {
        addCheck({
          name: 'DNS Backend',
          category: 'DNS',
          status: 'warn',
          message: 'DNS backend unclear, JNS DNS not found',
        })
      }
    }
  } catch (error) {
    addCheck({
      name: 'DNS Backend',
      category: 'DNS',
      status: 'warn',
      message: `Could not check DNS backend: ${error}`,
    })
  }
}

async function checkSslCertificates() {
  try {
    // Check for cert-manager certificates
    const certs = execSync(
      `kubectl get certificates -n ${CONFIG.namespace} -o name 2>/dev/null | wc -l`,
      { encoding: 'utf-8' },
    ).trim()

    const certCount = parseInt(certs, 10)

    // Check for ACM references in ingress
    const ingresses = execSync(
      `kubectl get ingress -n ${CONFIG.namespace} -o yaml 2>/dev/null`,
      { encoding: 'utf-8' },
    )

    const usesAcm =
      ingresses.includes('acm.amazonaws.com') ||
      ingresses.includes('certificate-arn')
    const usesCertManager = ingresses.includes('cert-manager.io')

    if (usesCertManager && !usesAcm && certCount > 0) {
      addCheck({
        name: 'SSL Certificates',
        category: 'SSL',
        status: 'pass',
        message: `Using cert-manager with ${certCount} certificates (decentralized)`,
      })
    } else if (usesAcm) {
      addCheck({
        name: 'SSL Certificates',
        category: 'SSL',
        status: 'fail',
        message: 'Still using AWS ACM for SSL certificates',
      })
    } else {
      addCheck({
        name: 'SSL Certificates',
        category: 'SSL',
        status: 'warn',
        message: 'SSL certificate source unclear',
      })
    }
  } catch (error) {
    addCheck({
      name: 'SSL Certificates',
      category: 'SSL',
      status: 'warn',
      message: `Could not check SSL certificates: ${error}`,
    })
  }
}

async function checkSequencerDecentralization() {
  try {
    // Check for multiple sequencer pods
    const sequencerPods = execSync(
      `kubectl get pods -n execution -l app.kubernetes.io/name=sequencer -o name 2>/dev/null | wc -l`,
      { encoding: 'utf-8' },
    ).trim()

    const podCount = parseInt(sequencerPods, 10)

    // Check for conductor (leader election)
    const conductorPods = execSync(
      `kubectl get pods -n execution -l app.kubernetes.io/name=conductor -o name 2>/dev/null | wc -l`,
      { encoding: 'utf-8' },
    ).trim()

    const conductorCount = parseInt(conductorPods, 10)

    if (podCount >= 3 && conductorCount >= 1) {
      addCheck({
        name: 'Sequencer Decentralization',
        category: 'Consensus',
        status: 'pass',
        message: `Multi-sequencer setup with ${podCount} sequencers and conductor`,
      })
    } else if (podCount > 1) {
      addCheck({
        name: 'Sequencer Decentralization',
        category: 'Consensus',
        status: 'warn',
        message: `Multiple sequencers (${podCount}) but no conductor for leader election`,
      })
    } else if (podCount === 1) {
      addCheck({
        name: 'Sequencer Decentralization',
        category: 'Consensus',
        status: 'fail',
        message: 'Single centralized sequencer',
      })
    } else {
      addCheck({
        name: 'Sequencer Decentralization',
        category: 'Consensus',
        status: 'warn',
        message: 'Could not determine sequencer setup',
      })
    }
  } catch (error) {
    addCheck({
      name: 'Sequencer Decentralization',
      category: 'Consensus',
      status: 'warn',
      message: `Could not check sequencer setup: ${error}`,
    })
  }
}

async function checkProviderNetwork() {
  try {
    const client = createPublicClient({
      transport: http(CONFIG.rpcUrl),
    })

    // Check DWSProviderRegistry for active providers
    // This is a simplified check - in production would call contract
    const blockNumber = await client.getBlockNumber()

    addCheck({
      name: 'Provider Network',
      category: 'Network',
      status: 'warn',
      message: `Chain is live at block ${blockNumber}, check provider count manually`,
    })
  } catch (error) {
    addCheck({
      name: 'Provider Network',
      category: 'Network',
      status: 'warn',
      message: `Could not connect to chain: ${error}`,
    })
  }
}

async function checkGovernance() {
  try {
    // Check for timelock controllers
    // const timelocks = execSync(
    //   `kubectl get deployments -A -o name 2>/dev/null | grep -i timelock | wc -l`,
    //   { encoding: "utf-8" }
    // ).trim();

    // Check ownership of critical contracts (would need contract interaction)
    addCheck({
      name: 'Governance Setup',
      category: 'Governance',
      status: 'warn',
      message: 'Verify timelock ownership of contracts manually',
    })
  } catch (error) {
    addCheck({
      name: 'Governance Setup',
      category: 'Governance',
      status: 'warn',
      message: `Could not check governance: ${error}`,
    })
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('Jeju Infrastructure Decentralization Health Check')
  console.log('='.repeat(60))
  console.log('')

  await checkStorageBackend()
  await checkDatabaseBackend()
  await checkContainerRegistry()
  await checkDnsBackend()
  await checkSslCertificates()
  await checkSequencerDecentralization()
  await checkProviderNetwork()
  await checkGovernance()

  console.log('')
  console.log('='.repeat(60))
  console.log('Summary')
  console.log('='.repeat(60))

  const passed = checks.filter((c) => c.status === 'pass').length
  const failed = checks.filter((c) => c.status === 'fail').length
  const warnings = checks.filter((c) => c.status === 'warn').length

  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`⚠️  Warnings: ${warnings}`)

  const score = Math.round((passed / checks.length) * 10)
  console.log('')
  console.log(`Decentralization Score: ${score}/10`)

  if (failed > 0) {
    console.log('')
    console.log('Failed checks require action:')
    for (const check of checks.filter((c) => c.status === 'fail')) {
      console.log(`  - [${check.category}] ${check.name}: ${check.message}`)
    }
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(console.error)
