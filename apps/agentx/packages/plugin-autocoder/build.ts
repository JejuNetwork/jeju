#!/usr/bin/env bun

/**
 * Build script using bun build
 */

import { $ } from 'bun';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { buildConfig } from './build.config';

async function build() {
  console.log('🏗️  Building package...');

  // Clean dist directory
  await $`rm -rf dist`;

  // Build with bun
  const result = await Bun.build(buildConfig);

  if (!result.success) {
    console.error('❌ Build failed:');
    for (const message of result.logs) {
      console.error(message);
    }
    process.exit(1);
  }

  console.log(`✅ Built ${result.outputs.length} files`);

  // Generate basic TypeScript declaration file
  console.log('📝 Generating TypeScript declarations...');

  // Ensure dist directory exists
  if (!existsSync('dist')) {
    mkdirSync('dist', { recursive: true });
  }

  // Create a basic index.d.ts file
  const declarationContent = `export declare const autocoderPlugin: import("@elizaos/core").Plugin;
export default autocoderPlugin;
`;

  writeFileSync('dist/index.d.ts', declarationContent);
  console.log('✅ Basic declaration file created');

  console.log('✅ Build complete!');
}

build().catch(console.error);
