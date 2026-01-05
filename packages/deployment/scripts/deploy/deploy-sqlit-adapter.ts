/**
 * Deploy SQLit Adapter to Kubernetes
 *
 * Simple Bun-based SQLit HTTP adapter for testnet/development.
 * Uses local SQLite storage instead of full decentralized SQLit.
 *
 * Usage:
 *   bun run packages/deployment/scripts/deploy/deploy-sqlit-adapter.ts
 *   bun run packages/deployment/scripts/deploy/deploy-sqlit-adapter.ts --build
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '../../../..')
const ADAPTER_DIR = join(ROOT_DIR, 'packages/sqlit/adapter')
const MANIFEST_PATH = join(
  ROOT_DIR,
  'packages/deployment/kubernetes/manifests/sqlit-adapter-testnet.yaml',
)

// AWS ECR config
const AWS_REGION = 'us-east-1'
const AWS_ACCOUNT_ID = '502713364895'
const ECR_REPO = `${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/jeju/sqlit-adapter`

function run(cmd: string, options?: { cwd?: string; stdio?: 'inherit' | 'pipe' }): string {
  console.log(`$ ${cmd}`)
  const result = spawnSync('sh', ['-c', cmd], {
    cwd: options?.cwd ?? ROOT_DIR,
    stdio: options?.stdio ?? 'inherit',
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd}`)
  }
  return result.stdout ?? ''
}

async function buildAndPush(): Promise<void> {
  console.log('\n=== Building SQLit Adapter Docker Image ===\n')

  // Login to ECR
  console.log('Logging in to ECR...')
  run(
    `aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com`,
  )

  // Build image
  console.log('\nBuilding Docker image...')
  run(`docker build -t ${ECR_REPO}:latest .`, { cwd: ADAPTER_DIR })

  // Tag with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  run(`docker tag ${ECR_REPO}:latest ${ECR_REPO}:${timestamp}`)

  // Push to ECR
  console.log('\nPushing to ECR...')
  run(`docker push ${ECR_REPO}:latest`)
  run(`docker push ${ECR_REPO}:${timestamp}`)

  console.log(`\nImage pushed: ${ECR_REPO}:latest`)
  console.log(`Image pushed: ${ECR_REPO}:${timestamp}`)
}

async function deploy(): Promise<void> {
  console.log('\n=== Deploying SQLit Adapter to Kubernetes ===\n')

  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found: ${MANIFEST_PATH}`)
  }

  // Apply manifest
  console.log('Applying Kubernetes manifest...')
  run(`kubectl apply -f ${MANIFEST_PATH}`)

  // Wait for rollout
  console.log('\nWaiting for deployment to be ready...')
  run('kubectl -n dws rollout status deployment/sqlit-adapter --timeout=300s')

  // Get pod status
  console.log('\nDeployment status:')
  run('kubectl -n dws get pods -l app=sqlit-adapter')

  // Get service info
  console.log('\nService info:')
  run('kubectl -n dws get svc sqlit-adapter')

  console.log('\n=== Deployment Complete ===')
  console.log('\nSQLit adapter is now available at:')
  console.log('  Internal: http://sqlit-adapter.dws.svc.cluster.local:8546')
  console.log('\nDWS should use this endpoint via SQLIT_BLOCK_PRODUCER_ENDPOINT env var.')
}

async function checkHealth(): Promise<boolean> {
  console.log('\n=== Checking SQLit Adapter Health ===\n')

  try {
    // Port-forward and check health
    const podName = run(
      'kubectl -n dws get pods -l app=sqlit-adapter -o jsonpath="{.items[0].metadata.name}"',
      { stdio: 'pipe' },
    ).trim()

    if (!podName) {
      console.log('No sqlit-adapter pod found')
      return false
    }

    console.log(`Found pod: ${podName}`)

    // Check logs
    console.log('\nRecent logs:')
    run(`kubectl -n dws logs ${podName} --tail=20`)

    return true
  } catch (err) {
    console.error('Health check failed:', err)
    return false
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const shouldBuild = args.includes('--build')
  const checkOnly = args.includes('--check')

  console.log('SQLit Adapter Deployment Tool')
  console.log('==============================')
  console.log(`  Adapter Dir: ${ADAPTER_DIR}`)
  console.log(`  Manifest: ${MANIFEST_PATH}`)
  console.log(`  ECR Repo: ${ECR_REPO}`)
  console.log('')

  if (checkOnly) {
    await checkHealth()
    return
  }

  if (shouldBuild) {
    await buildAndPush()
  }

  await deploy()
  await checkHealth()
}

main().catch((err) => {
  console.error('\n[ERROR]', err)
  process.exit(1)
})
