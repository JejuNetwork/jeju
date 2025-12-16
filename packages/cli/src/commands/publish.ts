/**
 * jeju publish - Publish workspace packages to npm
 * 
 * Handles:
 * - Converting workspace:* to real versions
 * - Building packages in correct order
 * - Publishing to npm
 * - Restoring workspace:* after publish
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execa } from 'execa';
import { logger } from '../lib/logger';
import { findMonorepoRoot } from '../lib/system';

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
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export const publishCommand = new Command('publish')
  .description('Publish workspace packages to npm')
  .option('--dry-run', 'Simulate without publishing')
  .option('--skip-build', 'Skip building packages')
  .option('--package <name>', 'Publish specific package only')
  .action(async (options) => {
    const rootDir = findMonorepoRoot();
    const dryRun = options.dryRun === true;
    const skipBuild = options.skipBuild === true;
    const singlePackage = options.package;

    logger.header('PUBLISH PACKAGES');

    if (dryRun) {
      logger.warn('DRY RUN - no packages will be published');
      logger.newline();
    }

    const packagesToPublish = singlePackage
      ? [singlePackage]
      : PACKAGES;

    // Get current versions
    const versions = getVersions(rootDir);
    logger.subheader('Package Versions');
    for (const [name, version] of versions) {
      logger.keyValue(name, version);
    }
    logger.newline();

    // Store original package.json contents for restoration
    const originals = new Map<string, string>();

    try {
      // Phase 1: Replace workspace:* references
      logger.step('Replacing workspace:* references');
      for (const pkg of packagesToPublish) {
        const pkgPath = getPackagePath(rootDir, pkg);
        if (!existsSync(pkgPath)) {
          logger.warn(`Package not found: ${pkg}`);
          continue;
        }

        const packageJsonPath = join(pkgPath, 'package.json');
        originals.set(pkg, readFileSync(packageJsonPath, 'utf-8'));

        const data = readPackageJson(rootDir, pkg);
        data.dependencies = replaceWorkspaceRefs(data.dependencies, versions);
        data.peerDependencies = replaceWorkspaceRefs(data.peerDependencies, versions);
        data.devDependencies = replaceWorkspaceRefs(data.devDependencies, versions);
        writePackageJson(rootDir, pkg, data);
      }
      logger.success('References updated');
      logger.newline();

      // Phase 2: Build packages
      if (!skipBuild) {
        logger.step('Building packages');
        for (const pkg of packagesToPublish) {
          const pkgPath = getPackagePath(rootDir, pkg);
          if (!existsSync(pkgPath)) continue;

          const pkgJson = readPackageJson(rootDir, pkg);
          if (pkgJson.scripts?.build) {
            logger.info(`  Building ${pkg}...`);
            if (!dryRun) {
              await execa('bun', ['run', 'build'], { cwd: pkgPath, stdio: 'pipe' });
            }
          }
        }
        logger.success('Packages built');
        logger.newline();
      }

      // Phase 3: Publish
      logger.step('Publishing to npm');
      for (const pkg of packagesToPublish) {
        const pkgPath = getPackagePath(rootDir, pkg);
        if (!existsSync(pkgPath)) continue;

        const pkgJson = readPackageJson(rootDir, pkg);
        logger.info(`  ${pkgJson.name}@${pkgJson.version}`);

        if (!dryRun) {
          await execa('npm', ['publish', '--access', 'public'], {
            cwd: pkgPath,
            stdio: 'pipe',
          });
          logger.success(`  Published ${pkgJson.name}`);
        } else {
          logger.info(`  [dry-run] Would publish ${pkgJson.name}@${pkgJson.version}`);
        }
      }

      logger.newline();
      logger.success('All packages published');
    } finally {
      // Phase 4: Restore original package.json files
      logger.newline();
      logger.step('Restoring workspace:* references');
      for (const pkg of packagesToPublish) {
        const original = originals.get(pkg);
        if (original) {
          const packageJsonPath = join(getPackagePath(rootDir, pkg), 'package.json');
          writeFileSync(packageJsonPath, original);
        }
      }
      logger.success('References restored');
    }
  });

function getPackagePath(rootDir: string, pkg: string): string {
  return join(rootDir, 'packages', pkg);
}

function readPackageJson(rootDir: string, pkg: string): PackageJson {
  const path = join(getPackagePath(rootDir, pkg), 'package.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writePackageJson(rootDir: string, pkg: string, data: PackageJson): void {
  const path = join(getPackagePath(rootDir, pkg), 'package.json');
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function getVersions(rootDir: string): Map<string, string> {
  const versions = new Map<string, string>();
  for (const pkg of PACKAGES) {
    const pkgPath = getPackagePath(rootDir, pkg);
    if (!existsSync(pkgPath)) continue;
    const data = readPackageJson(rootDir, pkg);
    versions.set(data.name, data.version);
  }
  return versions;
}

function replaceWorkspaceRefs(
  deps: Record<string, string> | undefined,
  versions: Map<string, string>
): Record<string, string> | undefined {
  if (!deps) return deps;

  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith('workspace:')) {
      const realVersion = versions.get(name);
      if (realVersion) {
        result[name] = `^${realVersion}`;
      } else {
        result[name] = version;
      }
    } else {
      result[name] = version;
    }
  }
  return result;
}

