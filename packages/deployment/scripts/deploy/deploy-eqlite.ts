/**
 * Deploy SQLit Infrastructure
 *
 * SQLit (SQLit) providers register in the unified ComputeRegistry.
 * This script deploys the Kubernetes infrastructure only.
 *
 * Usage:
 *   bun run scripts/deploy/deploy-sqlit.ts --network testnet
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '../../../..')
const HELM_DIR = join(ROOT_DIR, 'packages/deployment/kubernetes/helm/sqlit')

const NetworkSchema = z.enum(['localnet', 'testnet', 'mainnet'])
type Network = z.infer<typeof NetworkSchema>

interface DeploymentConfig {
  computeRegistry: string
  serviceRegistry: string
  creditManager: string
}

function loadDeploymentAddresses(network: Network): DeploymentConfig {
  const deployFile = join(
    ROOT_DIR,
    `packages/contracts/deployments/${network}-complete.json`,
  )

  if (!existsSync(deployFile)) {
    throw new Error(
      `Deployment file not found: ${deployFile}. Run full deployment first.`,
    )
  }

  const deployment = JSON.parse(readFileSync(deployFile, 'utf-8'))

  return {
    computeRegistry: deployment.ComputeRegistry,
    serviceRegistry: deployment.ServiceRegistry,
    creditManager: deployment.CreditManager,
  }
}

async function deployKubernetes(
  network: Network,
  config: DeploymentConfig,
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`)
  console.log('  Deploying SQLit to Kubernetes')
  console.log('='.repeat(60))

  const valuesFile = join(HELM_DIR, `values-${network}.yaml`)
  if (!existsSync(valuesFile)) {
    console.log(`  Values file not found: ${valuesFile}`)
    console.log('  Using default values')
  }

  // Update values with contract addresses from unified deployment
  let values = existsSync(valuesFile) ? readFileSync(valuesFile, 'utf-8') : ''
  values = values.replace(
    /computeRegistry: ""/,
    `computeRegistry: "${config.computeRegistry}"`,
  )
  values = values.replace(
    /serviceRegistry: ""/,
    `serviceRegistry: "${config.serviceRegistry}"`,
  )
  values = values.replace(
    /creditManager: ""/,
    `creditManager: "${config.creditManager}"`,
  )

  const tempValuesFile = join(HELM_DIR, `values-${network}-generated.yaml`)
  writeFileSync(tempValuesFile, values)

  const namespace = `sqlit-${network}`
  const releaseName = `sqlit-${network}`

  console.log(`  Namespace: ${namespace}`)
  console.log(`  Release: ${releaseName}`)
  console.log(`  ComputeRegistry: ${config.computeRegistry}`)
  console.log(`  ServiceRegistry: ${config.serviceRegistry}`)

  // Create namespace if needed
  execSync(
    `kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -`,
    {
      stdio: 'inherit',
    },
  )

  // Deploy with Helm
  execSync(
    [
      'helm',
      'upgrade',
      '--install',
      releaseName,
      HELM_DIR,
      '--namespace',
      namespace,
      '-f',
      tempValuesFile,
      '--wait',
      '--timeout',
      '10m',
    ].join(' '),
    {
      stdio: 'inherit',
    },
  )

  console.log('\nSQLit infrastructure deployed.')
  console.log(`\nTo check status:`)
  console.log(`  kubectl -n ${namespace} get pods`)
  console.log(`  kubectl -n ${namespace} get ingress`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  let network: Network = 'testnet'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--network' && args[i + 1]) {
      network = NetworkSchema.parse(args[i + 1])
      i++
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('  SQLit Infrastructure Deployment')
  console.log('='.repeat(60))
  console.log(`  Network: ${network}`)
  console.log('')
  console.log(
    '  Note: SQLit providers register in the unified ComputeRegistry',
  )
  console.log('  with serviceType = keccak256("database")')
  console.log('='.repeat(60))

  const config = loadDeploymentAddresses(network)
  await deployKubernetes(network, config)

  console.log(`\n${'='.repeat(60)}`)
  console.log('  Deployment Complete')
  console.log('='.repeat(60))
  console.log(`
  SQLit operators should register using:

    ComputeRegistry.registerDatabaseProvider(
      name,
      endpoint,
      attestationHash
    )

  Or with agent verification:

    ComputeRegistry.registerWithAgentAndService(
      name,
      endpoint,
      attestationHash,
      agentId,
      SERVICE_DATABASE  // keccak256("database")
    )
  `)
}

main().catch((err) => {
  console.error('\n[ERROR]', err)
  process.exit(1)
})
