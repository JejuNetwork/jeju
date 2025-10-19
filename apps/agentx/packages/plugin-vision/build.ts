#!/usr/bin/env bun

/**
 * Build script using bun build
 * Replaces tsup with native bun build functionality
 */

import { $ } from 'bun';
import { fileURLToPath } from 'url';
import { buildConfig, workersConfig } from './build.config';

async function build() {
  console.log('🏗️  Building package...');

  // Clean dist directory
  await $`rm -rf dist`;

  // Build main package
  console.log('📦 Building main package...');
  const mainResult = await Bun.build(buildConfig);

  if (!mainResult.success) {
    console.error('❌ Main build failed:');
    for (const message of mainResult.logs) {
      console.error(message);
    }
    process.exit(1);
  }

  console.log(`✅ Built ${mainResult.outputs.length} main files`);

  // Check if workers exist before building them
  const fs = await import('fs');
  const path = await import('path');
  const workersDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'workers');

  try {
    const workerFiles = fs
      .readdirSync(workersDir)
      .filter((f) => f.endsWith('.ts') && !f.includes('worker-logger'));

    if (workerFiles.length > 0) {
      console.log('👷 Building workers...');
      const workersResult = await Bun.build(workersConfig);

      if (!workersResult.success) {
        console.error('❌ Workers build failed:');
        for (const message of workersResult.logs) {
          console.error(message);
        }
        process.exit(1);
      }

      console.log(`✅ Built ${workersResult.outputs.length} worker files`);
    } else {
      console.log('ℹ️  No workers found, skipping worker build');
    }
  } catch (error) {
    console.log('ℹ️  Error checking workers:', error.message);
  }

  // Generate TypeScript declarations
  console.log('📝 Generating TypeScript declarations...');
  try {
    await $`tsc --project tsconfig.build.json`;
    console.log('✅ TypeScript declarations generated');
  } catch (error) {
    console.warn('⚠️ TypeScript declaration generation had issues, but continuing...');
  }

  console.log('✅ Build complete!');
}

build().catch(console.error);
