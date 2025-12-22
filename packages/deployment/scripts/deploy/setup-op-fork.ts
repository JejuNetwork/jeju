#!/usr/bin/env bun

/**
 * Setup OP Stack Fork
 *
 * Clones the Optimism monorepo and prepares it for modifications.
 * This creates a fork in vendor/optimism/ that we can modify.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'

const ROOT = join(import.meta.dir, '../..')
const VENDOR_DIR = join(ROOT, 'vendor')
const OPTIMISM_DIR = join(VENDOR_DIR, 'optimism')
const OPTIMISM_REPO = 'https://github.com/ethereum-optimism/optimism.git'
const OPTIMISM_VERSION = 'op-node/v1.9.4' // Pin to stable version

async function main() {
  console.log('🚀 Setting up OP Stack Fork')
  console.log('='.repeat(70))
  console.log('')

  // Check if already exists
  if (existsSync(OPTIMISM_DIR)) {
    console.log('⚠️  OP Stack fork already exists at:', OPTIMISM_DIR)
    console.log('   Delete it first if you want to re-clone.')
    console.log('')
    console.log('   rm -rf vendor/optimism')
    return
  }

  // Create vendor directory if needed
  if (!existsSync(VENDOR_DIR)) {
    mkdirSync(VENDOR_DIR, { recursive: true })
  }

  console.log('📦 Cloning Optimism monorepo...')
  console.log(`   Repository: ${OPTIMISM_REPO}`)
  console.log(`   Version: ${OPTIMISM_VERSION}`)
  console.log(`   Target: ${OPTIMISM_DIR}`)
  console.log('')

  try {
    // Clone the repository
    await $`git clone ${OPTIMISM_REPO} ${OPTIMISM_DIR}`.quiet()

    // Checkout specific version
    console.log(`📌 Checking out version: ${OPTIMISM_VERSION}`)
    await $`cd ${OPTIMISM_DIR} && git checkout ${OPTIMISM_VERSION}`.quiet()

    // Initialize submodules
    console.log('📚 Initializing submodules...')
    await $`cd ${OPTIMISM_DIR} && git submodule update --init --recursive`.quiet()

    console.log('')
    console.log('✅ OP Stack fork setup complete!')
    console.log('')
    console.log('Next steps:')
    console.log('  1. Start implementing contracts: packages/contracts/src/')
    console.log('  2. Modify OP Stack components in: vendor/optimism/')
    console.log('')
  } catch (error) {
    console.error('❌ Failed to setup OP Stack fork:', error)
    process.exit(1)
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

export { main as setupOptimismFork }
