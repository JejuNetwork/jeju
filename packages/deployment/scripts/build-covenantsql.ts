#!/usr/bin/env bun

/**
 * Build and push multi-arch CovenantSQL Docker image
 *
 * Usage:
 *   bun run scripts/build-covenantsql.ts              # Build locally
 *   bun run scripts/build-covenantsql.ts --push       # Build and push to ECR
 *   bun run scripts/build-covenantsql.ts --arm-only   # Build ARM64 only
 *   bun run scripts/build-covenantsql.ts --x86-only   # Build x86_64 only
 */

import { join } from 'node:path'
import { $ } from 'bun'
import {
  getEcrRegistry,
  getGitShortHash,
  getRequiredNetwork,
  loginToEcr,
  type NetworkType,
} from './shared'

const PUSH = process.argv.includes('--push')
const ARM_ONLY = process.argv.includes('--arm-only')
const X86_ONLY = process.argv.includes('--x86-only')
const NETWORK: NetworkType = getRequiredNetwork()

const SCRIPT_DIR = import.meta.dir
const DOCKER_DIR = join(SCRIPT_DIR, '../docker/covenantsql')

function getPlatforms(): string {
  if (ARM_ONLY) return 'linux/arm64'
  if (X86_ONLY) return 'linux/amd64'
  return 'linux/amd64,linux/arm64'
}

async function setupBuildx(): Promise<string> {
  console.log('🔧 Setting up Docker buildx...\n')

  const platforms = getPlatforms()
  const requiredPlatforms = platforms.split(',')

  const buildersOutput = await $`docker buildx ls`.text()
  const lines = buildersOutput.split('\n')

  for (const preferredBuilder of ['desktop-linux', 'default']) {
    for (const line of lines) {
      if (
        line.startsWith(preferredBuilder) ||
        line.includes(`\\_ ${preferredBuilder}`)
      ) {
        const hasAllPlatforms = requiredPlatforms.every((p) =>
          buildersOutput.includes(p.replace('linux/', '')),
        )
        if (hasAllPlatforms) {
          console.log(`   Using builder: ${preferredBuilder}\n`)
          await $`docker buildx use ${preferredBuilder}`.quiet().nothrow()
          return preferredBuilder
        }
      }
    }
  }

  const hasJejuBuilder = buildersOutput.includes('jeju-multiarch')

  if (hasJejuBuilder) {
    console.log('   Removing stale jeju-multiarch builder...\n')
    await $`docker buildx rm jeju-multiarch`.quiet().nothrow()
  }

  console.log('   Creating jeju-multiarch builder...\n')
  await $`docker buildx create --name jeju-multiarch --driver docker-container --bootstrap`
  await $`docker buildx use jeju-multiarch`
  return 'jeju-multiarch'
}

async function main(): Promise<void> {
  console.log('🐳 Building CovenantSQL multi-arch image\n')
  console.log(`   Platforms: ${getPlatforms()}`)
  console.log(`   Push: ${PUSH}`)
  console.log(`   Network: ${NETWORK}\n`)

  const builder = await setupBuildx()
  console.log(`   Builder: ${builder}\n`)

  const gitHash = await getGitShortHash()
  const tag = `${NETWORK}-${gitHash}`

  let imageName = 'jeju/covenantsql'
  if (PUSH) {
    const registry = await getEcrRegistry()
    console.log(`📦 ECR Registry: ${registry}\n`)
    await loginToEcr(registry)
    imageName = `${registry}/jeju/covenantsql`
  }

  const fullTag = `${imageName}:${tag}`
  const latestTag = `${imageName}:${NETWORK}-latest`

  console.log(`🔨 Building ${fullTag}...\n`)

  const buildPlatforms = getPlatforms()
  const isMultiPlatform = buildPlatforms.includes(',')

  const buildArgs = [
    'docker',
    'buildx',
    'build',
    '--platform',
    buildPlatforms,
    '-t',
    fullTag,
    '-t',
    latestTag,
    '-f',
    join(DOCKER_DIR, 'Dockerfile'),
  ]

  if (PUSH) {
    buildArgs.push('--push')
  } else if (!isMultiPlatform) {
    buildArgs.push('--load')
  }

  buildArgs.push(DOCKER_DIR)

  const result = await $`${buildArgs}`.nothrow()

  if (result.exitCode !== 0) {
    console.error('❌ Build failed')
    process.exit(1)
  }

  console.log(`\n✅ CovenantSQL image built successfully`)
  console.log(`   Tag: ${fullTag}`)
  console.log(`   Latest: ${latestTag}`)

  if (PUSH) {
    console.log(`\n📤 Image pushed to ECR`)
  } else if (isMultiPlatform) {
    console.log(`\n⚠️  Multi-platform build complete (not loaded locally)`)
    console.log(
      `   Use --push to push to ECR, or --arm-only/--x86-only to load locally`,
    )
  } else {
    console.log(`\n💡 Image loaded locally. Use --push to push to ECR`)
  }
}

main()
