#!/usr/bin/env bun
/**
 * Crucible Deployment Script
 *
 * Deploys Crucible to DWS infrastructure:
 * 1. Builds frontend and API
 * 2. Uploads static assets to IPFS with staticFiles mapping
 * 3. Registers backend worker with DWS
 * 4. Verifies deployment is working
 *
 * Uses the standardized deployment utility from @jejunetwork/shared
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getCurrentNetwork } from '@jejunetwork/config'
import { deployAndVerify, getDWSUrlForNetwork } from '@jejunetwork/shared'

const APP_DIR = resolve(import.meta.dir, '..')

async function ensureBuild(): Promise<void> {
  const requiredFiles = ['./dist/api/index.js', './dist/web/index.html']

  for (const file of requiredFiles) {
    if (!existsSync(resolve(APP_DIR, file))) {
      console.log('[Crucible] Build not found, running build first...')
      const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
        cwd: APP_DIR,
        stdout: 'inherit',
        stderr: 'inherit',
      })
      const exitCode = await proc.exited
      if (exitCode !== 0) {
        throw new Error('Build failed')
      }
      return
    }
  }

  console.log('[Crucible] Build found')
}

async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              Crucible Deployment to DWS                    ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const network = getCurrentNetwork()
  const dwsUrl = getDWSUrlForNetwork(network)

  console.log(`Network:  ${network}`)
  console.log(`DWS:      ${dwsUrl}`)
  console.log('')

  // Build if needed
  await ensureBuild()

  // Deploy using standardized utility with verification
  const result = await deployAndVerify({
    name: 'crucible',
    jnsName: 'crucible.jeju',
    frontendDir: resolve(APP_DIR, 'dist/web'),
    workerPath: resolve(APP_DIR, 'dist/api/index.js'),
    apiPaths: [
      '/api/*',
      '/health',
      '/a2a/*',
      '/mcp/*',
      '/agents/*',
      '/rooms/*',
    ],
    spa: true,
    dwsUrl,
    skipSourceMaps: true,
  })

  console.log('')
  console.log('[Crucible] Deployment complete.')
  console.log('\nEndpoints:')
  console.log(`   Frontend: ${result.appUrl}`)
  console.log(`   Health: ${result.healthUrl}`)
  console.log(`   Frontend CID: ${result.frontendCid}`)
  if (result.backendWorkerId) {
    console.log(`   Worker CID: ${result.backendWorkerId}`)
  }
}

deploy().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
