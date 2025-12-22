/**
 * System Content Manifest Builder
 * 
 * Generates manifest of all system content that nodes must seed:
 * - All apps in apps/
 * - Contract ABIs
 * - JNS records
 * - Documentation
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import { createHash } from 'crypto';
import type {
  SystemContentManifest,
  SystemAppEntry,
  SystemABIEntry,
  SystemJNSEntry,
} from './types';

// ============================================================================
// Types
// ============================================================================

interface JejuManifest {
  name: string;
  displayName?: string;
  version: string;
  type?: string;
  description?: string;
  jns?: {
    name?: string;
    url?: string;
  };
  decentralization?: {
    frontend?: {
      buildDir?: string;
    };
  };
  dependencies?: string[];
}

// ============================================================================
// System Manifest Builder
// ============================================================================

export class SystemManifestBuilder {
  private rootDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
  }

  /**
   * Build complete system content manifest
   */
  async build(): Promise<SystemContentManifest> {
    console.log('[SystemManifest] Building system content manifest...');
    
    const [apps, abis, jnsRecords] = await Promise.all([
      this.collectApps(),
      this.collectABIs(),
      this.collectJNSRecords(),
    ]);

    const totalSize = apps.reduce((sum, a) => sum + a.size, 0) +
      abis.reduce((sum, a) => sum + a.size, 0);

    const manifest: SystemContentManifest = {
      version: '1.0.0',
      generatedAt: Date.now(),
      apps,
      abis,
      jnsRecords,
      totalSize,
      totalItems: apps.length + abis.length + jnsRecords.length,
    };

    console.log(`[SystemManifest] Built manifest: ${manifest.totalItems} items, ${(manifest.totalSize / 1024 / 1024).toFixed(2)} MB`);
    return manifest;
  }

  /**
   * Collect all apps from apps/ directory
   */
  private async collectApps(): Promise<SystemAppEntry[]> {
    const appsDir = join(this.rootDir, 'apps');
    const entries: SystemAppEntry[] = [];

    const appDirs = await readdir(appsDir).catch(() => []);
    
    for (const appDir of appDirs) {
      const appPath = join(appsDir, appDir);
      const appStat = await stat(appPath).catch(() => null);
      if (!appStat?.isDirectory()) continue;

      // Read jeju-manifest.json
      const manifestPath = join(appPath, 'jeju-manifest.json');
      const manifestContent = await readFile(manifestPath, 'utf-8').catch(() => null);
      if (!manifestContent) continue;

      const manifest: JejuManifest = JSON.parse(manifestContent);
      
      // Find build directory
      const buildDir = await this.findBuildDir(appPath, manifest);
      if (!buildDir) {
        console.log(`[SystemManifest] No build dir for ${appDir}, skipping`);
        continue;
      }

      // Calculate size of build directory
      const size = await this.calculateDirSize(buildDir);
      
      // Generate CID from manifest + build hash
      const buildHash = await this.hashDirectory(buildDir);
      const cid = this.generateCid(manifest.name, manifest.version, buildHash);

      entries.push({
        name: manifest.name,
        displayName: manifest.displayName ?? manifest.name,
        version: manifest.version,
        cid,
        size,
        buildDir: buildDir.replace(this.rootDir, ''),
        jnsName: manifest.jns?.name,
        dependencies: manifest.dependencies ?? [],
      });

      console.log(`[SystemManifest] Added app: ${manifest.name} (${(size / 1024).toFixed(1)} KB)`);
    }

    return entries;
  }

  /**
   * Collect all contract ABIs
   */
  private async collectABIs(): Promise<SystemABIEntry[]> {
    const abiPaths = [
      join(this.rootDir, 'packages/sdk/src/contracts/abis'),
      join(this.rootDir, 'packages/contracts/out'),
    ];

    const entries: SystemABIEntry[] = [];
    const seenContracts = new Set<string>();

    for (const abiPath of abiPaths) {
      const exists = await stat(abiPath).catch(() => null);
      if (!exists) continue;

      const files = await this.listJsonFiles(abiPath);
      
      for (const file of files) {
        const contractName = basename(file, '.json');
        if (seenContracts.has(contractName)) continue;
        seenContracts.add(contractName);

        const content = await readFile(file, 'utf-8');
        const size = Buffer.byteLength(content);
        const hash = createHash('sha256').update(content).digest('hex');
        const cid = `abi-${contractName}-${hash.slice(0, 8)}`;

        entries.push({
          contractName,
          version: '1.0.0',
          cid,
          size,
          networks: {},  // Filled in during deployment
        });
      }
    }

    console.log(`[SystemManifest] Collected ${entries.length} contract ABIs`);
    return entries;
  }

  /**
   * Collect JNS records for all apps
   */
  private async collectJNSRecords(): Promise<SystemJNSEntry[]> {
    const appsDir = join(this.rootDir, 'apps');
    const entries: SystemJNSEntry[] = [];

    const appDirs = await readdir(appsDir).catch(() => []);
    
    for (const appDir of appDirs) {
      const manifestPath = join(appsDir, appDir, 'jeju-manifest.json');
      const content = await readFile(manifestPath, 'utf-8').catch(() => null);
      if (!content) continue;

      const manifest: JejuManifest = JSON.parse(content);
      if (!manifest.jns?.name) continue;

      // Find the app's CID
      const buildDir = await this.findBuildDir(join(appsDir, appDir), manifest);
      const buildHash = buildDir ? await this.hashDirectory(buildDir) : 'pending';
      const contentCid = this.generateCid(manifest.name, manifest.version, buildHash);

      entries.push({
        name: manifest.jns.name,
        contentCid,
        resolver: '0x0000000000000000000000000000000000000000', // Filled during deployment
        owner: '0x0000000000000000000000000000000000000000',
        ttl: 3600,
      });
    }

    console.log(`[SystemManifest] Collected ${entries.length} JNS records`);
    return entries;
  }

  /**
   * Find build directory for an app
   */
  private async findBuildDir(appPath: string, manifest: JejuManifest): Promise<string | null> {
    // Check manifest-specified build dir
    if (manifest.decentralization?.frontend?.buildDir) {
      const dir = join(appPath, manifest.decentralization.frontend.buildDir);
      if (await this.dirExists(dir)) return dir;
    }

    // Common build directories
    const candidates = ['dist', 'build', 'out', '.next', 'public'];
    
    for (const candidate of candidates) {
      const dir = join(appPath, candidate);
      if (await this.dirExists(dir)) return dir;
    }

    return null;
  }

  /**
   * Calculate total size of directory
   */
  private async calculateDirSize(dir: string): Promise<number> {
    let totalSize = 0;
    
    const traverse = async (path: string): Promise<void> => {
      const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
      
      for (const entry of entries) {
        const fullPath = join(path, entry.name);
        if (entry.isDirectory()) {
          await traverse(fullPath);
        } else {
          const fileStat = await stat(fullPath).catch(() => null);
          if (fileStat) totalSize += fileStat.size;
        }
      }
    };

    await traverse(dir);
    return totalSize;
  }

  /**
   * Hash directory contents
   */
  private async hashDirectory(dir: string): Promise<string> {
    const hash = createHash('sha256');
    
    const traverse = async (path: string): Promise<void> => {
      const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      
      for (const entry of entries) {
        const fullPath = join(path, entry.name);
        if (entry.isDirectory()) {
          hash.update(`dir:${entry.name}`);
          await traverse(fullPath);
        } else {
          const content = await readFile(fullPath).catch(() => Buffer.from(''));
          hash.update(`file:${entry.name}:${content.length}`);
          hash.update(content);
        }
      }
    };

    await traverse(dir);
    return hash.digest('hex');
  }

  /**
   * List all JSON files in directory
   */
  private async listJsonFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    const traverse = async (path: string): Promise<void> => {
      const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
      
      for (const entry of entries) {
        const fullPath = join(path, entry.name);
        if (entry.isDirectory()) {
          await traverse(fullPath);
        } else if (extname(entry.name) === '.json') {
          files.push(fullPath);
        }
      }
    };

    await traverse(dir);
    return files;
  }

  /**
   * Generate deterministic CID from components
   */
  private generateCid(name: string, version: string, hash: string): string {
    const combined = `${name}:${version}:${hash}`;
    return createHash('sha256').update(combined).digest('hex').slice(0, 46);
  }

  /**
   * Check if directory exists
   */
  private async dirExists(path: string): Promise<boolean> {
    const s = await stat(path).catch(() => null);
    return s?.isDirectory() ?? false;
  }
}

// ============================================================================
// Manifest Seeder
// ============================================================================

export class SystemContentSeeder {
  private rootDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
  }

  /**
   * Package and prepare system content for seeding
   */
  async packageSystemContent(
    manifest: SystemContentManifest
  ): Promise<Array<{ cid: string; name: string; data: Buffer }>> {
    const packages: Array<{ cid: string; name: string; data: Buffer }> = [];

    // Package apps
    for (const app of manifest.apps) {
      const buildDir = join(this.rootDir, app.buildDir);
      const data = await this.packageDirectory(buildDir);
      packages.push({
        cid: app.cid,
        name: `${app.name}-${app.version}.tar`,
        data,
      });
    }

    // Package ABIs
    const abiBundle: Record<string, string> = {};
    for (const abi of manifest.abis) {
      const abiPath = join(this.rootDir, 'packages/sdk/src/contracts/abis', `${abi.contractName}.json`);
      const content = await readFile(abiPath, 'utf-8').catch(() => '{}');
      abiBundle[abi.contractName] = content;
    }
    
    const abiBundleData = Buffer.from(JSON.stringify(abiBundle, null, 2));
    packages.push({
      cid: `abis-bundle-${createHash('sha256').update(abiBundleData).digest('hex').slice(0, 8)}`,
      name: 'contract-abis.json',
      data: abiBundleData,
    });

    // Package manifest itself
    const manifestData = Buffer.from(JSON.stringify(manifest, null, 2));
    packages.push({
      cid: `manifest-${createHash('sha256').update(manifestData).digest('hex').slice(0, 8)}`,
      name: 'system-manifest.json',
      data: manifestData,
    });

    console.log(`[SystemSeeder] Packaged ${packages.length} items for seeding`);
    return packages;
  }

  /**
   * Package directory as tar-like buffer
   */
  private async packageDirectory(dir: string): Promise<Buffer> {
    const files: Array<{ path: string; content: Buffer }> = [];
    
    const traverse = async (path: string, base: string): Promise<void> => {
      const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
      
      for (const entry of entries) {
        const fullPath = join(path, entry.name);
        const relativePath = join(base, entry.name);
        
        if (entry.isDirectory()) {
          await traverse(fullPath, relativePath);
        } else {
          const content = await readFile(fullPath);
          files.push({ path: relativePath, content });
        }
      }
    };

    await traverse(dir, '');
    
    // Simple JSON-based archive (in production, use actual tar)
    const archive = {
      files: files.map(f => ({
        path: f.path,
        size: f.content.length,
        content: f.content.toString('base64'),
      })),
    };
    
    return Buffer.from(JSON.stringify(archive));
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export async function buildSystemManifest(rootDir?: string): Promise<SystemContentManifest> {
  const builder = new SystemManifestBuilder(rootDir);
  return builder.build();
}

export async function packageSystemContent(
  manifest: SystemContentManifest,
  rootDir?: string
): Promise<Array<{ cid: string; name: string; data: Buffer }>> {
  const seeder = new SystemContentSeeder(rootDir);
  return seeder.packageSystemContent(manifest);
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  const manifest = await buildSystemManifest();
  console.log(JSON.stringify(manifest, null, 2));
}


