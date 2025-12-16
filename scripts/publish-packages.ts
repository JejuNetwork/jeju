#!/usr/bin/env bun
/**
 * @deprecated Migrate to CLI: `jeju publish`
 * 
 * This script will be migrated to CLI. For now, use:
 *   bun run scripts/publish-packages.ts
 * 
 * Publish network packages to npm
 * 
 * Handles:
 * - Converting workspace:* to real versions
 * - Building packages in correct order
 * - Publishing to npm
 * - Restoring workspace:* after publish
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = join(import.meta.dir, '..');

// Packages in publish order (dependencies first)
const PACKAGES = [
  'types',
  'config', 
  'contracts',
  'sdk',
  'cli',
];

interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function getPackagePath(pkg: string): string {
  return join(ROOT, 'packages', pkg);
}

function readPackageJson(pkg: string): PackageJson {
  const path = join(getPackagePath(pkg), 'package.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writePackageJson(pkg: string, data: PackageJson): void {
  const path = join(getPackagePath(pkg), 'package.json');
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function getVersions(): Map<string, string> {
  const versions = new Map<string, string>();
  for (const pkg of PACKAGES) {
    const data = readPackageJson(pkg);
    versions.set(data.name, data.version);
  }
  return versions;
}

function replaceWorkspaceRefs(deps: Record<string, string> | undefined, versions: Map<string, string>): Record<string, string> | undefined {
  if (!deps) return deps;
  
  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith('workspace:')) {
      const realVersion = versions.get(name);
      if (realVersion) {
        result[name] = `^${realVersion}`;
      } else {
        result[name] = version; // Keep as-is if not found
      }
    } else {
      result[name] = version;
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipBuild = args.includes('--skip-build');
  
  console.log('\n📦 Network Package Publisher\n');
  
  if (dryRun) {
    console.log('🔍 DRY RUN - no changes will be published\n');
  }

  // Get current versions
  const versions = getVersions();
  console.log('Package versions:');
  for (const [name, version] of versions) {
    console.log(`  ${name}: ${version}`);
  }
  console.log();

  // Store original package.json contents for restoration
  const originals = new Map<string, string>();
  
  try {
    // Phase 1: Replace workspace:* references
    console.log('Phase 1: Replacing workspace:* references...\n');
    
    for (const pkg of PACKAGES) {
      const path = join(getPackagePath(pkg), 'package.json');
      originals.set(pkg, readFileSync(path, 'utf-8'));
      
      const data = readPackageJson(pkg);
      
      data.dependencies = replaceWorkspaceRefs(data.dependencies, versions);
      data.peerDependencies = replaceWorkspaceRefs(data.peerDependencies, versions);
      data.devDependencies = replaceWorkspaceRefs(data.devDependencies, versions);
      
      writePackageJson(pkg, data);
      console.log(`  ✓ ${pkg}`);
    }
    
    // Phase 2: Build packages
    if (!skipBuild) {
      console.log('\nPhase 2: Building packages...\n');
      
      for (const pkg of PACKAGES) {
        const pkgPath = getPackagePath(pkg);
        const pkgJson = readPackageJson(pkg);
        
        if (pkgJson.scripts?.build) {
          console.log(`  Building ${pkg}...`);
          execSync('bun run build', { cwd: pkgPath, stdio: 'inherit' });
        }
      }
    }
    
    // Phase 3: Publish
    console.log('\nPhase 3: Publishing to npm...\n');
    
    for (const pkg of PACKAGES) {
      const pkgPath = getPackagePath(pkg);
      const pkgJson = readPackageJson(pkg);
      
      console.log(`  Publishing ${pkgJson.name}@${pkgJson.version}...`);
      
      if (!dryRun) {
        try {
          execSync('npm publish --access public', { cwd: pkgPath, stdio: 'inherit' });
          console.log(`  ✓ Published ${pkgJson.name}`);
        } catch (error) {
          console.error(`  ✗ Failed to publish ${pkgJson.name}`);
          throw error;
        }
      } else {
        console.log(`  [dry-run] Would publish ${pkgJson.name}@${pkgJson.version}`);
      }
    }
    
    console.log('\n✅ All packages published successfully\n');
    
  } finally {
    // Phase 4: Restore original package.json files
    console.log('Phase 4: Restoring workspace:* references...\n');
    
    for (const pkg of PACKAGES) {
      const original = originals.get(pkg);
      if (original) {
        const path = join(getPackagePath(pkg), 'package.json');
        writeFileSync(path, original);
        console.log(`  ✓ ${pkg}`);
      }
    }
  }
}

main().catch((error) => {
  console.error('\n❌ Publish failed:', error.message);
  process.exit(1);
});

