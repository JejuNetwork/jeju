/**
 * Unified App Discovery Utility
 * Discovers both core apps (apps/) and vendor apps (vendor/)
 * based on jeju-manifest.json files
 */

import { readdirSync, existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

// Schema for jeju manifest validation
const JejuManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/),
  type: z.enum(['core', 'vendor']),
  description: z.string().optional(),
  commands: z.object({
    dev: z.string().optional(),
    build: z.string().optional(),
    test: z.string().optional(),
    start: z.string().optional(),
  }).optional(),
  ports: z.record(z.number()).optional(),
  dependencies: z.array(z.enum(['contracts', 'config', 'shared', 'scripts', 'indexer', 'localnet'])).optional(),
  optional: z.boolean().default(true),
  enabled: z.boolean().default(true),
  autoStart: z.boolean().default(true),
  tags: z.array(z.string()).optional(),
  healthCheck: z.object({
    url: z.string().optional(),
    interval: z.number().optional(),
  }).optional(),
});

export type JejuManifest = z.infer<typeof JejuManifestSchema>;

export interface JejuApp {
  name: string;
  path: string;
  manifest: JejuManifest;
  exists: boolean;
  type: 'core' | 'vendor';
}

/**
 * Discover all Jeju apps in a directory
 */
function discoverAppsInDirectory(
  baseDir: string,
  type: 'core' | 'vendor'
): JejuApp[] {
  const apps: JejuApp[] = [];

  // Check if directory exists
  if (!existsSync(baseDir)) {
    return apps;
  }

  // Read directory contents
  const entries = readdirSync(baseDir);

  for (const entry of entries) {
    // Skip hidden files and specific files
    if (entry.startsWith('.') || entry === 'README.md' || entry.endsWith('.schema.json') || entry === 'tests') {
      continue;
    }

    const appPath = join(baseDir, entry);

    // Check if it's a directory
    const stats = statSync(appPath);
    if (!stats.isDirectory()) {
      continue;
    }

    // Look for jeju-manifest.json
    const manifestPath = join(appPath, 'jeju-manifest.json');
    
    if (!existsSync(manifestPath)) {
      continue;
    }

    // Load and validate manifest
    const manifestContent = readFileSync(manifestPath, 'utf-8');
    const manifestData = JSON.parse(manifestContent);
    
    const result = JejuManifestSchema.safeParse(manifestData);
    
    if (!result.success) {
      console.error(`[JejuApps] ${entry}: Invalid manifest:`, result.error.errors);
      continue;
    }

    const manifest = result.data;

    // Check if app is enabled
    if (!manifest.enabled) {
      continue;
    }

    apps.push({
      name: manifest.name,
      path: appPath,
      manifest,
      exists: existsSync(join(appPath, 'package.json')) || existsSync(join(appPath, 'bun.lockb')),
      type,
    });
  }

  return apps;
}

/**
 * Discover all Jeju apps (core + vendor)
 */
export function discoverAllApps(rootDir: string = process.cwd()): JejuApp[] {
  const coreApps = discoverAppsInDirectory(join(rootDir, 'apps'), 'core');
  const vendorApps = discoverAppsInDirectory(join(rootDir, 'vendor'), 'vendor');
  
  return [...coreApps, ...vendorApps];
}

/**
 * Discover only core apps
 */
export function discoverCoreApps(rootDir: string = process.cwd()): JejuApp[] {
  return discoverAppsInDirectory(join(rootDir, 'apps'), 'core');
}

/**
 * Discover only vendor apps
 */
export function discoverVendorApps(rootDir: string = process.cwd()): JejuApp[] {
  return discoverAppsInDirectory(join(rootDir, 'vendor'), 'vendor');
}

/**
 * Get a specific app by name
 */
export function getApp(name: string, rootDir: string = process.cwd()): JejuApp | null {
  const apps = discoverAllApps(rootDir);
  return apps.find(app => app.name === name) || null;
}

/**
 * Check if an app exists and is enabled
 */
export function hasApp(name: string, rootDir: string = process.cwd()): boolean {
  const app = getApp(name, rootDir);
  return app !== null && app.exists;
}

/**
 * Get all enabled apps that should auto-start
 */
export function getAutoStartApps(rootDir: string = process.cwd()): JejuApp[] {
  return discoverAllApps(rootDir).filter(
    app => app.manifest.enabled && app.manifest.autoStart !== false && app.exists
  );
}

/**
 * Display apps summary
 */
export function displayAppsSummary(rootDir: string = process.cwd()): void {
  const coreApps = discoverCoreApps(rootDir);
  const vendorApps = discoverVendorApps(rootDir);

  if (coreApps.length === 0 && vendorApps.length === 0) {
    console.log('\n📦 Jeju Apps: None discovered');
    return;
  }

  console.log('\n📦 Jeju Apps Discovered:');

  if (coreApps.length > 0) {
    console.log('\n🏢 Core Apps:');
    for (const app of coreApps) {
      const status = app.exists ? '✅' : '⚠️';
      const name = app.manifest.displayName || app.name;
      
      console.log(`  ${status} ${name} (${app.manifest.version})`);
      
      if (app.manifest.description) {
        console.log(`     ${app.manifest.description}`);
      }
      
      if (app.manifest.ports) {
        const portList = Object.entries(app.manifest.ports)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ');
        console.log(`     Ports: ${portList}`);
      }
      
      if (!app.exists) {
        console.log(`     ⚠️  Not initialized`);
      }
    }
  }

  if (vendorApps.length > 0) {
    console.log('\n🎮 Vendor Apps:');
    for (const app of vendorApps) {
      const status = app.exists ? '✅' : '⚠️';
      const name = app.manifest.displayName || app.name;
      
      console.log(`  ${status} ${name} (${app.manifest.version})`);
      
      if (app.manifest.description) {
        console.log(`     ${app.manifest.description}`);
      }
      
      if (app.manifest.ports) {
        const portList = Object.entries(app.manifest.ports)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ');
        console.log(`     Ports: ${portList}`);
      }
      
      if (!app.exists) {
        console.log(`     ⚠️  Not initialized - run: git submodule update --init vendor/${app.name}`);
      }
    }
  }

  const total = coreApps.length + vendorApps.length;
  const enabled = [...coreApps, ...vendorApps].filter(a => a.exists).length;
  
  console.log(`\n  Total: ${total} app(s) | Enabled: ${enabled} | Core: ${coreApps.length} | Vendor: ${vendorApps.length}\n`);
}

/**
 * Get app command
 */
export function getAppCommand(
  appName: string,
  command: 'dev' | 'build' | 'test' | 'start',
  rootDir: string = process.cwd()
): string | null {
  const app = getApp(appName, rootDir);
  
  if (!app || !app.exists) {
    return null;
  }

  return app.manifest.commands?.[command] || null;
}

export { JejuManifestSchema };

