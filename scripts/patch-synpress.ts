#!/usr/bin/env bun
/**
 * Patches synpress-cache for zod 4.x compatibility
 * 
 * The synpress-cache package uses zod 3.x syntax (z.function().returns())
 * which doesn't work with zod 4.x. This script patches the compiled JS files.
 * 
 * Run after bun install: bun scripts/patch-synpress.ts
 */

import { $ } from 'bun';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const BUN_CACHE = 'node_modules/.bun';

async function patchSynpressCache() {
  if (!existsSync(BUN_CACHE)) {
    console.log('No bun cache found, skipping synpress patch');
    return;
  }

  const entries = readdirSync(BUN_CACHE);
  const synpressCacheDirs = entries.filter(e => e.startsWith('@synthetixio+synpress-cache@'));

  let patchedCount = 0;

  for (const dir of synpressCacheDirs) {
    const distPath = join(BUN_CACHE, dir, 'node_modules/@synthetixio/synpress-cache/dist');
    
    // Patch index.js
    const indexPath = join(distPath, 'index.js');
    if (existsSync(indexPath)) {
      let content = readFileSync(indexPath, 'utf-8');
      const originalContent = content;
      
      // Replace zod 3.x function syntax with zod 4.x compatible version
      content = content.replace(
        /z\.function\(\)\.returns\(z\.promise\(z\.void\(\)\)\)/g,
        'z.function()'
      );
      
      if (content !== originalContent) {
        writeFileSync(indexPath, content);
        patchedCount++;
      }
    }

    // Patch cli/index.js
    const cliIndexPath = join(distPath, 'cli/index.js');
    if (existsSync(cliIndexPath)) {
      let content = readFileSync(cliIndexPath, 'utf-8');
      const originalContent = content;
      
      content = content.replace(
        /z\.function\(\)\.returns\(z\.promise\(z\.void\(\)\)\)/g,
        'z.function()'
      );
      
      if (content !== originalContent) {
        writeFileSync(cliIndexPath, content);
        patchedCount++;
      }
    }

    // Also patch source files
    const srcPath = join(BUN_CACHE, dir, 'node_modules/@synthetixio/synpress-cache/src/utils/importWalletSetupFile.ts');
    if (existsSync(srcPath)) {
      let content = readFileSync(srcPath, 'utf-8');
      const originalContent = content;
      
      content = content.replace(
        /z\.function\(\)\.returns\(z\.promise\(z\.void\(\)\)\)/g,
        'z.function() as z.ZodType<() => Promise<void>>'
      );
      
      if (content !== originalContent) {
        writeFileSync(srcPath, content);
        patchedCount++;
      }
    }
  }

  if (patchedCount > 0) {
    console.log(`✅ Patched ${patchedCount} synpress-cache files for zod 4.x compatibility`);
  } else {
    console.log('ℹ️ No synpress-cache files needed patching');
  }
}

patchSynpressCache().catch(console.error);

