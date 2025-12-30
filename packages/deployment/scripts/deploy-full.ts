#!/usr/bin/env bun

/**
 * Full deployment pipeline for testnet/mainnet
 *
 * Architecture: Decentralization-First
 * - Chain infrastructure deploys via Terraform/Kubernetes (L1/L2 nodes only)
 * - ALL apps deploy via DWS (on-chain provisioning)
 *
 * Steps:
 * 1. Validate configurations
 * 2. Deploy CHAIN infrastructure (Terraform) - nodes, sequencer, etc.
 * 3. Build and push Docker images (chain components only)
 * 4. Deploy chain infrastructure to Kubernetes (Helmfile)
 * 5. Bootstrap DWS and deploy ALL apps on-chain
 * 6. Verify deployment
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/deploy-full.ts
 *   NETWORK=mainnet bun run scripts/deploy-full.ts
 */

import { join } from 'node:path'
import { $ } from 'bun'
import { getRequiredNetwork, type NetworkType } from './shared'

const ROOT = join(import.meta.dir, '..')

const NETWORK: NetworkType = getRequiredNetwork()

interface DeploymentSteps {
  VALIDATE: boolean
  TERRAFORM: boolean
  IMAGES: boolean
  SQLIT_IMAGE: boolean
  KUBERNETES: boolean
  DWS_APPS: boolean
  VERIFY: boolean
}

const STEPS: DeploymentSteps = {
  VALIDATE: process.env.SKIP_VALIDATE !== 'true',
  TERRAFORM: process.env.SKIP_TERRAFORM !== 'true',
  IMAGES: process.env.SKIP_IMAGES !== 'true',
  SQLIT_IMAGE:
    process.env.BUILD_SQLIT_IMAGE === 'true' ||
    process.env.USE_ARM64_SQLit === 'true',
  KUBERNETES: process.env.SKIP_KUBERNETES !== 'true',
  DWS_APPS: process.env.SKIP_DWS_APPS !== 'true',
  VERIFY: process.env.SKIP_VERIFY !== 'true',
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n${'━'.repeat(60)}`)
  console.log(`📋 ${name}`)
  console.log(`${'━'.repeat(60)}\n`)
  await fn()
}

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚀 JEJU ${NETWORK.toUpperCase()} DEPLOYMENT                              ║
║                                                              ║
║   Architecture: Decentralization-First                       ║
║   - Chain infrastructure: Terraform/K8s                      ║
║   - All apps: DWS (on-chain provisioning)                    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`)

  if (NETWORK === 'mainnet') {
    console.log('⚠️  MAINNET DEPLOYMENT - Proceeding with extra caution\n')
  }

  const startTime = Date.now()

  if (STEPS.VALIDATE) {
    await step('Validating configurations', async () => {
      const result =
        await $`bun run ${join(ROOT, 'scripts/validate.ts')}`.nothrow()
      if (result.exitCode !== 0) throw new Error('Validation failed')
    })
  }

  if (STEPS.TERRAFORM) {
    await step('Deploying CHAIN infrastructure (Terraform)', async () => {
      console.log('ℹ️  Only chain-level infrastructure (L1/L2 nodes, sequencer)')
      console.log('ℹ️  Apps will deploy via DWS (on-chain)\n')
      await $`NETWORK=${NETWORK} bun run ${join(ROOT, 'scripts/terraform.ts')} plan`
      await $`NETWORK=${NETWORK} bun run ${join(ROOT, 'scripts/terraform.ts')} apply`
    })
  }

  if (STEPS.IMAGES) {
    await step(
      'Building and pushing Docker images (chain components)',
      async () => {
        await $`NETWORK=${NETWORK} bun run ${join(ROOT, 'scripts/build-images.ts')} --push`
      },
    )
  }

  if (STEPS.SQLIT_IMAGE) {
    await step('Building and pushing SQLit multi-arch image', async () => {
      await $`NETWORK=${NETWORK} bun run ${join(ROOT, 'scripts/build-sqlit.ts')} --push`
    })
  }

  if (STEPS.KUBERNETES) {
    await step('Deploying CHAIN infrastructure to Kubernetes', async () => {
      console.log('ℹ️  Helmfile only deploys chain infrastructure now.')
      console.log('ℹ️  Apps deploy via DWS (on-chain provisioning)\n')
      await $`NETWORK=${NETWORK} bun run ${join(ROOT, 'scripts/helmfile.ts')} sync`
    })
  }

  if (STEPS.DWS_APPS) {
    await step('Deploying ALL apps via DWS (on-chain)', async () => {
      console.log('ℹ️  Frontends -> IPFS')
      console.log('ℹ️  Workers -> On-chain registry')
      console.log('ℹ️  JNS names -> Bound to content\n')
      await $`NETWORK=${NETWORK} bun run ${join(ROOT, 'scripts/deploy/dws-bootstrap.ts')}`
    })
  }

  if (STEPS.VERIFY) {
    await step('Verifying deployment', async () => {
      console.log('Checking chain infrastructure...')
      await $`kubectl get pods -n op-stack`.nothrow()
      await $`kubectl get pods -n rpc`.nothrow()
      await $`kubectl get pods -n l1`.nothrow()

      console.log('\nChecking DWS apps deployment...')
      const deploymentsFile = join(
        ROOT,
        `../contracts/deployments/${NETWORK}-dws-apps.json`,
      )
      const result = await $`cat ${deploymentsFile}`.nothrow()
      if (result.exitCode === 0) {
        console.log('✅ DWS apps deployed successfully')
      }
    })
  }

  const duration = Math.round((Date.now() - startTime) / 1000)

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ✅ DEPLOYMENT COMPLETE                                      ║
║   Network: ${NETWORK.padEnd(47)}║
║   Duration: ${(`${duration}s`).padEnd(45)}║
║                                                              ║
║   ARCHITECTURE:                                              ║
║   - Chain infra: Terraform/K8s (L1/L2 nodes, sequencer)      ║
║   - All apps: DWS (frontends on IPFS, workers on-chain)     ║
║                                                              ║
║   Apps are now 100%% decentralized.                            ║
║   Anyone can deploy apps using: jeju deploy app <name>       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`)
}

main().catch((err: Error) => {
  console.error('\n❌ Deployment failed:', err.message)
  process.exit(1)
})
