#!/usr/bin/env bun

/**
 * Build and push Docker images to ECR
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/build-images.ts
 *   NETWORK=testnet bun run scripts/build-images.ts --push
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  getEcrRegistry,
  getGitShortHash,
  getRequiredNetwork,
  loginToEcr,
  type NetworkType,
} from './shared'

const NETWORK: NetworkType = getRequiredNetwork()
const PUSH = process.argv.includes('--push')
const PROJECT_ROOT = join(import.meta.dir, '../../..')

interface AppConfig {
  dockerfile: string
  context: string
}

const APPS: Record<string, AppConfig> = {
  dws: { dockerfile: 'apps/dws/Dockerfile', context: '.' },
  bazaar: { dockerfile: 'apps/bazaar/Dockerfile', context: 'apps/bazaar' },
  gateway: { dockerfile: 'apps/gateway/Dockerfile', context: 'apps/gateway' },
  ipfs: { dockerfile: 'apps/ipfs/Dockerfile', context: 'apps/ipfs' },
  documentation: { dockerfile: 'apps/documentation/Dockerfile', context: '.' },
  indexer: {
    dockerfile: 'apps/indexer/Dockerfile.k8s',
    context: 'apps/indexer',
  },
}

async function main(): Promise<void> {
  console.log(`🐳 Building Docker images for ${NETWORK}\n`)

  const gitHash = await getGitShortHash()
  const tag = `${NETWORK}-${gitHash}`

  let registry = ''
  if (PUSH) {
    registry = await getEcrRegistry()
    console.log(`📦 ECR Registry: ${registry}\n`)
    await loginToEcr(registry)
  }

  for (const [app, config] of Object.entries(APPS)) {
    const dockerfilePath = join(PROJECT_ROOT, config.dockerfile)

    if (!existsSync(dockerfilePath)) {
      console.log(`⏭️  Skipping ${app} (no Dockerfile)`)
      continue
    }

    console.log(`\n🔨 Building ${app}...`)

    const imageName = PUSH ? `${registry}/jeju/${app}` : `jeju/${app}`
    const fullTag = `${imageName}:${tag}`
    const latestTag = `${imageName}:${NETWORK}-latest`

    const buildResult = await $`docker build \
      -f ${dockerfilePath} \
      -t ${fullTag} \
      -t ${latestTag} \
      --platform linux/amd64 \
      --build-arg ENVIRONMENT=${NETWORK} \
      ${join(PROJECT_ROOT, config.context)}`.nothrow()

    if (buildResult.exitCode !== 0) {
      console.error(`❌ Build failed for ${app}`)
      process.exit(1)
    }

    if (PUSH) {
      console.log(`   Pushing ${app}...`)
      await $`docker push ${fullTag}`
      await $`docker push ${latestTag}`
    }

    console.log(`   ✅ ${app}`)
  }

  console.log(`\n✅ All images built${PUSH ? ' and pushed' : ''}\n`)
}

main()
