#!/usr/bin/env bun
// Unified build script for ElizaOS Agent Server
// Builds everything: backend, Linux binary, and Podman image
//
// Environment variables:
// - CLEAN_CACHE=true  : Remove existing images and containers before build
// - NO_CACHE=true     : Disable Podman build cache (--no-cache flag)
//
// Examples:
//   bun build-all.js                       # Normal build (uses cache)
//   CLEAN_CACHE=true bun build-all.js      # Clean existing images first
//   NO_CACHE=true bun build-all.js         # Force rebuild layers
//   CLEAN_CACHE=true NO_CACHE=true bun build-all.js  # Full clean rebuild

import { $ } from 'bun';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect available container runtime
async function getContainerRuntime() {
  // Check for Podman first (preferred), then Docker
  try {
    await $`podman --version`.quiet();
    return 'podman';
  } catch {
    try {
      await $`docker info`.quiet();
      return 'docker';
    } catch {
      throw new Error(
        'Neither Podman nor Docker found or running. Please install Podman or Docker.'
      );
    }
  }
}

async function cleanContainerCache() {
  console.log('🧹 Cleaning container cache and removing old agent images...');

  try {
    // Detect container runtime
    let runtime;
    try {
      runtime = await getContainerRuntime();
    } catch {
      console.log('⚠️  No container runtime available, skipping container cache cleanup');
      return;
    }

    // Remove existing agent container images to force fresh build
    const agentImages = ['eliza-agent:latest', 'eliza-agent:latest', 'eliza-agent-working:latest'];

    for (const image of agentImages) {
      try {
        console.log(`🗑️  Removing existing image: ${image}`);
        await $`${runtime} rmi ${image}`.quiet();
        console.log(`✅ Removed ${image}`);
      } catch (error) {
        // Image might not exist, which is fine
        console.log(`ℹ️  Image ${image} not found (this is ok)`);
      }
    }

    // Stop and remove any running agent containers
    const containerNames = ['eliza-agent', 'eliza-agent'];
    for (const name of containerNames) {
      try {
        console.log(`🛑 Stopping and removing container: ${name}`);
        await $`${runtime} stop ${name}`.quiet();
        await $`${runtime} rm ${name}`.quiet();
        console.log(`✅ Removed container ${name}`);
      } catch (error) {
        // Container might not exist, which is fine
        console.log(`ℹ️  Container ${name} not found (this is ok)`);
      }
    }

    // Clean dangling images and build cache
    try {
      console.log('🧹 Cleaning dangling images and build cache...');
      await $`${runtime} image prune -f`.quiet();
      await $`${runtime} system prune -f`.quiet();
      console.log('✅ Container cache cleaned');
    } catch (error) {
      console.warn('⚠️  Failed to clean build cache:', error.message);
    }

    console.log('✅ Container cache cleanup completed\n');
  } catch (error) {
    console.warn('⚠️  Container cache cleanup failed:', error.message);
    console.log('⚠️  Continuing with build process...\n');
  }
}

async function main() {
  const rootDir = path.join(__dirname, '..', '..', '..');
  
  // Map Node.js arch to Docker/Podman arch names
  const archMapping = {
    'x64': 'amd64',
    'arm64': 'arm64',
    'arm': 'arm/v7'
  };
  const dockerArch = archMapping[process.arch] || process.arch;
  const platform = process.env.TARGET_PLATFORM || `linux/${dockerArch}`;
  
  const useCache = process.env.USE_CACHE !== 'false';
  const cleanCache = process.env.CLEAN_CACHE === 'true';

  console.log('🚀 ElizaOS Agent Server - Complete Build Process\n');

  const runtime = await getContainerRuntime();
  console.log(`🐳 Using container runtime: ${runtime}`);

  if (cleanCache) {
    console.log('💨 Cleaning cache...');
    await $`${runtime} image rm elizaos/agent-server:latest || true`;
    console.log('   ✅ Cache cleaned');
  } else {
    console.log('💨 Skipping cache cleanup (use CLEAN_CACHE=true to force cleanup)');
  }
  console.log('');

  console.log('🔄 Ensuring fresh build artifacts...');
  await $`rm -rf ${path.join(__dirname, '..', 'dist')}`;
  await $`rm -rf ${path.join(__dirname, '..', 'dist-binaries')}`;
  console.log('  🗑️  Removing old backend build...');
  console.log('  🗑️  Removing old binaries...');
  console.log('  ✅ Clean slate for fresh builds');
  console.log('');

  console.log('📦 Step 1/4: Building backend...');
  try {
    await $`bun ${path.join(__dirname, 'build.js')}`;
    console.log('✅ Backend built successfully');
    console.log(`   ${path.join(__dirname, '..', 'dist', 'server.js')}`);
  } catch (error) {
    console.error('❌ Failed to build backend:', error);
    process.exit(1);
  }
  console.log('');

  console.log('🔨 Step 2/4: Building Linux binary...');
  try {
    const binariesDir = path.join(__dirname, '..', 'dist-binaries');
    await $`mkdir -p ${binariesDir}`;

    const backendFile = path.join(__dirname, '..', 'dist', 'server.js');

    console.log('📦 Cross-compiling for bun-linux-x64...');
    await $`bun build ${backendFile} --compile --outfile ${binariesDir}/server-linux-amd64 --target bun-linux-x64`;
    console.log('✅ Built bun-linux-x64 successfully');

    console.log('📦 Cross-compiling for bun-linux-arm64...');
    await $`bun build ${backendFile} --compile --outfile ${binariesDir}/server-linux-arm64 --target bun-linux-aarch64`;
    console.log('✅ Built bun-linux-arm64 successfully');

    console.log('✅ Linux binaries created:');
    console.log(`   ${path.join(__dirname, '..', 'dist-binaries', `server-linux-arm64`)}`);
    console.log(`   ${path.join(__dirname, '..', 'dist-binaries', `server-linux-amd64`)}`);
  } catch (error) {
    console.error('❌ Failed to build Linux binaries:', error);
    process.exit(1);
  }
  console.log('');

  console.log(`🐳 Step 3/4: Building container image with ${runtime}...`);
  const imageName = `elizaos/agent-server:latest-${platform.replace('/', '-')}`;
  const buildTimestamp = Date.now();

  const noCache = process.env.NO_CACHE === 'true';
  const cacheFlag = noCache ? '--no-cache' : '';
  const cacheMsg = noCache ? ' (no cache)' : ' (with cache)';

  // Check if we should use the format flag
  // Docker implicitly uses docker format, but Podman defaults to OCI format
  // The --format=docker flag ensures HEALTHCHECK and other Docker-specific instructions work properly
  let formatFlag = '';
  if (runtime === 'podman') {
    // Check if this version of Podman supports the --format flag
    try {
      await $`${runtime} build --help | grep -q "\\-\\-format"`.quiet();
      formatFlag = '--format=docker';
      console.log('📋 Using Docker format for better compatibility');
    } catch {
      console.log(
        '⚠️  This version of Podman does not support --format flag, using default format'
      );
      console.log('   Note: HEALTHCHECK instructions may not work as expected');
    }
  }

  console.log(`📦 Building container for platform: ${platform}${cacheMsg}`);
  await $`cd ${rootDir} && ${runtime} build ${formatFlag} ${cacheFlag} --build-arg CACHE_BUST=${buildTimestamp} --platform ${platform} -t ${imageName} -f packages/agentserver/Dockerfile .`;

  await $`${runtime} tag ${imageName} eliza-agent:latest`;

  console.log(`✅ Container image built successfully with ${runtime}`);
  console.log(`   Image: ${imageName}`);
  console.log('');

  console.log('✨ Step 4/4: Finalizing...');
  console.log('🎉 Build complete!');
  console.log(`To run the server, use: ${runtime} run -it --rm -p 7777:7777`, imageName);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  });
}

// Export functions for use by other scripts
export { main, cleanContainerCache };
