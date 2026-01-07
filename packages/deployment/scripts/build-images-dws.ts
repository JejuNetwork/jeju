#!/usr/bin/env bun

/**
 * Build and push Docker images to DWS Storage (IPFS)
 *
 * Replaces ECR with decentralized container image storage.
 * Images are exported, layers uploaded to IPFS, and manifests registered on-chain.
 *
 * ONLY infrastructure services that need Docker/K8s deployment.
 * Apps (bazaar, gateway, crucible, etc.) deploy to DWS via:
 *   - Static frontend -> DWS Storage (IPFS)
 *   - Workers backend -> DWS Workers (workerd)
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/build-images-dws.ts
 *   NETWORK=testnet bun run scripts/build-images-dws.ts --push
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import { getGitShortHash, getRequiredNetwork, type NetworkType } from './shared'

const NETWORK: NetworkType = getRequiredNetwork()
const PUSH = process.argv.includes('--push')
const PROJECT_ROOT = join(import.meta.dir, '../../..')
const TEMP_DIR = join(PROJECT_ROOT, '.tmp/images')

const DWS_STORAGE_URL =
  process.env.DWS_STORAGE_URL ||
  (NETWORK === 'mainnet'
    ? 'https://dws.jeju/storage'
    : NETWORK === 'testnet'
      ? 'https://dws.testnet.jejunetwork.org/storage'
      : 'http://localhost:3500/storage')

interface AppConfig {
  dockerfile: string
  context: string
  description: string
}

interface LayerInfo {
  digest: string
  cid: string
  size: number
}

interface ImageManifest {
  name: string
  tag: string
  digest: string
  layers: LayerInfo[]
  config: {
    cid: string
    digest: string
  }
  size: number
  architecture: string
  createdAt: number
}

// Infrastructure services only - these ARE the decentralized network
// Apps deploy via DWS (static + workers), not Docker
const INFRASTRUCTURE: Record<string, AppConfig> = {
  // Core DWS server - runs the infrastructure
  dws: {
    dockerfile: 'apps/dws/Dockerfile',
    context: '.',
    description: 'DWS server (storage, workers, JNS gateway)',
  },
  // IPFS node for decentralized storage
  ipfs: {
    dockerfile: 'apps/ipfs/Dockerfile',
    context: 'apps/ipfs',
    description: 'IPFS node for DWS storage backend',
  },
  // SQLit distributed database
  sqlit: {
    dockerfile: 'packages/sqlit/Dockerfile',
    context: 'packages/sqlit',
    description: 'SQLit distributed database node',
  },
  // Subsquid processor for blockchain indexing (not the app frontend)
  'indexer-processor': {
    dockerfile: 'apps/indexer/Dockerfile.k8s',
    context: 'apps/indexer',
    description: 'Subsquid processor for blockchain data indexing',
  },
}

async function uploadToDWS(
  content: Buffer,
  filename: string,
): Promise<{ cid: string; url: string }> {
  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(content)]), filename)

  const response = await fetch(`${DWS_STORAGE_URL}/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `DWS Storage upload failed for ${filename}: ${response.status} ${errorText}`,
    )
  }

  return (await response.json()) as { cid: string; url: string }
}

/**
 * Calculate SHA256 digest of content
 */
function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Extract and upload image layers from a Docker image tarball
 */
async function processImageTarball(
  tarballPath: string,
  imageName: string,
  imageTag: string,
): Promise<ImageManifest> {
  const extractDir = join(TEMP_DIR, `${imageName}-${imageTag}-extracted`)

  // Clean and create extract directory
  if (existsSync(extractDir)) {
    rmSync(extractDir, { recursive: true })
  }
  mkdirSync(extractDir, { recursive: true })

  // Extract tarball
  await $`tar -xf ${tarballPath} -C ${extractDir}`.quiet()

  // Read manifest.json
  const manifestPath = join(extractDir, 'manifest.json')
  const manifestContent = readFileSync(manifestPath, 'utf-8')
  const dockerManifest = JSON.parse(manifestContent) as Array<{
    Config: string
    RepoTags: string[]
    Layers: string[]
  }>

  if (dockerManifest.length === 0) {
    throw new Error('Empty manifest in image tarball')
  }

  const manifest = dockerManifest[0]
  const layers: LayerInfo[] = []
  let totalSize = 0

  console.log(`   Processing ${manifest.Layers.length} layers...`)

  // Upload each layer
  for (const layerPath of manifest.Layers) {
    const fullLayerPath = join(extractDir, layerPath)
    const layerContent = readFileSync(fullLayerPath)
    const layerDigest = `sha256:${sha256(layerContent)}`
    const layerSize = layerContent.length

    console.log(
      `   Uploading layer ${layerDigest.slice(0, 20)}... (${(layerSize / 1024 / 1024).toFixed(2)} MB)`,
    )

    const { cid } = await uploadToDWS(
      layerContent,
      `layer-${layerDigest.slice(7, 19)}.tar`,
    )

    layers.push({
      digest: layerDigest,
      cid,
      size: layerSize,
    })

    totalSize += layerSize
  }

  // Upload config
  const configPath = join(extractDir, manifest.Config)
  const configContent = readFileSync(configPath)
  const configDigest = `sha256:${sha256(configContent)}`

  console.log(`   Uploading config...`)
  const { cid: configCid } = await uploadToDWS(
    configContent,
    `config-${configDigest.slice(7, 19)}.json`,
  )

  // Clean up
  rmSync(extractDir, { recursive: true })

  return {
    name: imageName,
    tag: imageTag,
    digest: `sha256:${sha256(Buffer.from(JSON.stringify({ layers, config: configDigest })))}`,
    layers,
    config: {
      cid: configCid,
      digest: configDigest,
    },
    size: totalSize,
    architecture: 'amd64',
    createdAt: Date.now(),
  }
}

/**
 * Build and push a single image to DWS Storage
 */
async function buildAndPushImage(
  name: string,
  config: AppConfig,
  tag: string,
): Promise<ImageManifest | null> {
  const dockerfilePath = join(PROJECT_ROOT, config.dockerfile)

  if (!existsSync(dockerfilePath)) {
    console.log(`⏭️  Skipping ${name} (no Dockerfile at ${config.dockerfile})`)
    return null
  }

  console.log(`\n🔨 Building ${name}...`)
  console.log(`   ${config.description}`)

  const imageName = `jeju/${name}`
  const fullTag = `${imageName}:${tag}`
  const latestTag = `${imageName}:${NETWORK}-latest`

  // Build the image
  const buildResult = await $`docker build \
    -f ${dockerfilePath} \
    -t ${fullTag} \
    -t ${latestTag} \
    --platform linux/amd64 \
    --build-arg ENVIRONMENT=${NETWORK} \
    ${join(PROJECT_ROOT, config.context)}`.nothrow()

  if (buildResult.exitCode !== 0) {
    console.error(`❌ Build failed for ${name}`)
    return null
  }

  if (!PUSH) {
    console.log(`   ✅ ${name} (build only, use --push to upload to DWS)`)
    return null
  }

  // Export image to tarball
  console.log(`   Exporting image...`)
  const tarballPath = join(TEMP_DIR, `${name}-${tag}.tar`)
  mkdirSync(TEMP_DIR, { recursive: true })

  await $`docker save ${fullTag} -o ${tarballPath}`.quiet()

  // Process and upload layers
  console.log(`   Uploading to DWS Storage...`)
  const manifest = await processImageTarball(tarballPath, name, tag)

  // Upload the manifest itself
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2))
  const { cid: manifestCid } = await uploadToDWS(
    manifestBuffer,
    `${name}-${tag}-manifest.json`,
  )

  console.log(`   ✅ ${name}`)
  console.log(`      Manifest CID: ${manifestCid}`)
  console.log(`      Image digest: ${manifest.digest.slice(0, 20)}...`)
  console.log(
    `      Total size: ${(manifest.size / 1024 / 1024).toFixed(2)} MB`,
  )
  console.log(`      Layers: ${manifest.layers.length}`)

  // Clean up tarball
  rmSync(tarballPath)

  return manifest
}

/**
 * Write registry manifest for all images
 */
async function writeRegistryManifest(
  manifests: ImageManifest[],
): Promise<void> {
  const registryManifest = {
    version: 1,
    network: NETWORK,
    createdAt: Date.now(),
    images: manifests.map((m) => ({
      name: m.name,
      tag: m.tag,
      digest: m.digest,
      layers: m.layers.map((l) => l.cid),
      configCid: m.config.cid,
      size: m.size,
    })),
  }

  const manifestBuffer = Buffer.from(JSON.stringify(registryManifest, null, 2))

  // Upload to IPFS
  const { cid } = await uploadToDWS(
    manifestBuffer,
    `registry-manifest-${NETWORK}.json`,
  )

  console.log(`\n📦 Registry Manifest`)
  console.log(`   CID: ${cid}`)
  console.log(`   Images: ${manifests.length}`)
  console.log(``)
  console.log(`   To configure Kubernetes to use DWS images:`)
  console.log(`   1. Set image.repository to: registry.jeju/<name>`)
  console.log(
    `   2. Images will be resolved via JNS -> ContainerRegistry -> IPFS`,
  )
  console.log(``)
  console.log(
    `   Pull with: dws pull registry.jeju/${manifests[0]?.name || 'dws'}:${manifests[0]?.tag || 'latest'}`,
  )
}

async function main(): Promise<void> {
  console.log(`🐳 Building infrastructure Docker images for ${NETWORK}`)
  console.log(`   Target: DWS Storage (IPFS)`)
  console.log(`   Storage URL: ${DWS_STORAGE_URL}`)
  console.log('   (Apps deploy via DWS: static frontend + workers backend)\n')

  const gitHash = await getGitShortHash()
  const tag = `${NETWORK}-${gitHash}`

  const manifests: ImageManifest[] = []

  for (const [name, config] of Object.entries(INFRASTRUCTURE)) {
    const manifest = await buildAndPushImage(name, config, tag)
    if (manifest) {
      manifests.push(manifest)
    }
  }

  if (PUSH && manifests.length > 0) {
    await writeRegistryManifest(manifests)
  }

  console.log(
    `\n✅ All infrastructure images built${PUSH ? ' and pushed to DWS Storage' : ''}\n`,
  )

  if (!PUSH) {
    console.log(`   Run with --push to upload images to DWS Storage (IPFS)\n`)
  }
}

main()
