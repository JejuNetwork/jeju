#!/usr/bin/env bun
// Build script for creating Bun compiled binaries

import { $ } from 'bun';
import * as path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGETS = {
  local: null, // Use local platform
  'linux-amd64': 'bun-linux-x64', // Docker expects amd64, bun uses x64
  'linux-arm64': 'bun-linux-arm64',
};

async function buildBinary(target = 'local', outputDir = null) {
  console.log(`🔨 Building Bun binary for target: ${target}`);

  // Default outputDir to parent directory's dist-binaries
  if (!outputDir) {
    outputDir = path.join(__dirname, '..', 'dist-binaries');
  }

  // Ensure backend is built first
  const backendFile = path.join(__dirname, '..', 'dist', 'server.js');
  if (!existsSync(backendFile)) {
    console.log('📦 Building backend first...');
    await $`bun run build`;
  }

  // Ensure output directory exists
  await $`mkdir -p ${outputDir}`;

  // Determine output filename
  const isWindows = target.includes('windows');
  const extension = isWindows ? '.exe' : '';
  const outputFile = path.join(outputDir, `server-${target}${extension}`);

  try {
    if (target === 'local') {
      // Local compilation (current platform)
      console.log('📦 Compiling for local platform with DOM polyfills...');
      await $`bun build --compile ${backendFile} --outfile ${outputFile}`;
    } else if (TARGETS[target]) {
      // Cross-compilation with specific target
      const bunTarget = TARGETS[target];
      console.log(`📦 Cross-compiling for ${target} (${bunTarget})...`);
      await $`bun build --compile --target=${bunTarget} ${backendFile} --outfile ${outputFile}`;
    } else {
      throw new Error(
        `Unknown target: ${target}. Available targets: ${Object.keys(TARGETS).join(', ')}`
      );
    }

    // Verify the binary was created
    if (!existsSync(outputFile)) {
      throw new Error(`Binary not created: ${outputFile}`);
    }

    // Make executable (Unix-like systems)
    if (!isWindows) {
      await $`chmod +x ${outputFile}`;
    }

    // Get file info
    const stats = await $`ls -la ${outputFile}`.text();
    const fileInfo = await $`file ${outputFile}`
      .text()
      .catch(() => 'File type detection unavailable');

    console.log('✅ Binary created successfully:');
    console.log(`   File: ${outputFile}`);
    console.log(`   Info: ${stats.trim()}`);
    console.log(`   Type: ${fileInfo.trim()}`);

    return outputFile;
  } catch (error) {
    console.error(`❌ Build failed for ${target}:`, error.message);
    throw error;
  }
}

async function buildAll() {
  console.log('🚀 Building all binary targets...');

  const results = {};

  for (const [targetName] of Object.entries(TARGETS)) {
    try {
      const outputFile = await buildBinary(targetName);
      results[targetName] = { success: true, file: outputFile };
    } catch (error) {
      results[targetName] = { success: false, error: error.message };
    }
  }

  console.log('\n📊 Build Summary:');
  for (const [target, result] of Object.entries(results)) {
    if (result.success) {
      console.log(`  ✅ ${target}: ${result.file}`);
    } else {
      console.log(`  ❌ ${target}: ${result.error}`);
    }
  }

  return results;
}

// CLI interface
const args = process.argv.slice(2);
const command = args[0] || 'local';

if (command === 'all') {
  await buildAll();
} else if (Object.prototype.hasOwnProperty.call(TARGETS, command)) {
  await buildBinary(command);
} else {
  console.log('Usage: bun build-binary.js [target]');
  console.log('');
  console.log('Available targets:');
  Object.keys(TARGETS).forEach((target) => {
    console.log(`  ${target}`);
  });
  console.log('  all (build all targets)');
  process.exit(1);
}
