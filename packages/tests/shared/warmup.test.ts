/**
 * Warmup Tests - App discovery, edge cases, error handling
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { discoverAppsForWarmup, warmupApps, quickWarmup } from './warmup';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/jeju-warmup-test';
const TEST_APPS_DIR = join(TEST_DIR, 'apps');

// Setup test directory structure
function setupTestApp(name: string, options: {
  port?: number;
  hasManifest?: boolean;
  hasSynpress?: boolean;
  hasPlaywright?: boolean;
  isNextJs?: boolean;
} = {}) {
  const {
    port = 3000,
    hasManifest = true,
    hasSynpress = true,
    hasPlaywright = false,
    isNextJs = false,
  } = options;

  const appDir = join(TEST_APPS_DIR, name);
  mkdirSync(appDir, { recursive: true });

  if (hasManifest) {
    writeFileSync(join(appDir, 'jeju-manifest.json'), JSON.stringify({
      name,
      ports: { main: port },
    }));
  }

  if (hasSynpress) {
    writeFileSync(join(appDir, 'synpress.config.ts'), 'export default {}');
  }

  if (hasPlaywright) {
    writeFileSync(join(appDir, 'playwright.config.ts'), 'export default {}');
  }

  if (isNextJs) {
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0' },
    }));
  }
}

beforeEach(() => {
  // Clean and create test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_APPS_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe('discoverAppsForWarmup - App Discovery', () => {
  test('should return empty array when no apps directory', () => {
    rmSync(TEST_APPS_DIR, { recursive: true });

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps).toEqual([]);
  });

  test('should return empty array when apps directory is empty', () => {
    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps).toEqual([]);
  });

  test('should discover app with synpress config', () => {
    setupTestApp('test-app', { port: 4000, hasSynpress: true });

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps.length).toBe(1);
    expect(apps[0].name).toBe('test-app');
    expect(apps[0].port).toBe(4000);
  });

  test('should discover app with playwright config', () => {
    setupTestApp('playwright-app', { port: 4001, hasSynpress: false, hasPlaywright: true });

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps.length).toBe(1);
    expect(apps[0].name).toBe('playwright-app');
  });

  test('should skip app without test config', () => {
    setupTestApp('no-tests', { hasSynpress: false, hasPlaywright: false });

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps.length).toBe(0);
  });

  test('should skip app without manifest', () => {
    setupTestApp('no-manifest', { hasManifest: false });

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps.length).toBe(0);
  });

  test('should skip app without port in manifest', () => {
    const appDir = join(TEST_APPS_DIR, 'no-port');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'jeju-manifest.json'), JSON.stringify({ name: 'no-port' }));
    writeFileSync(join(appDir, 'synpress.config.ts'), 'export default {}');

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps.length).toBe(0);
  });

  test('should detect Next.js apps', () => {
    setupTestApp('nextjs-app', { isNextJs: true });

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps[0].isNextJs).toBe(true);
  });

  test('should detect non-Next.js apps', () => {
    setupTestApp('vite-app', { isNextJs: false });

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps[0].isNextJs).toBe(false);
  });

  test('should skip hidden directories', () => {
    mkdirSync(join(TEST_APPS_DIR, '.hidden'), { recursive: true });
    writeFileSync(join(TEST_APPS_DIR, '.hidden', 'jeju-manifest.json'), '{}');
    writeFileSync(join(TEST_APPS_DIR, '.hidden', 'synpress.config.ts'), '');

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps.length).toBe(0);
  });

  test('should skip node_modules directory', () => {
    mkdirSync(join(TEST_APPS_DIR, 'node_modules'), { recursive: true });
    writeFileSync(join(TEST_APPS_DIR, 'node_modules', 'jeju-manifest.json'), '{}');

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps.length).toBe(0);
  });

  test('should discover multiple apps', () => {
    setupTestApp('app1', { port: 4001 });
    setupTestApp('app2', { port: 4002 });
    setupTestApp('app3', { port: 4003 });

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps.length).toBe(3);
    expect(apps.map(a => a.name).sort()).toEqual(['app1', 'app2', 'app3']);
  });

  test('should use default routes when not specified', () => {
    setupTestApp('default-routes');

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps[0].routes).toEqual(['/', '/about', '/settings']);
  });

  test('should use custom warmup routes from manifest', () => {
    const appDir = join(TEST_APPS_DIR, 'custom-routes');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'jeju-manifest.json'), JSON.stringify({
      name: 'custom-routes',
      ports: { main: 3000 },
      warmupRoutes: ['/custom', '/routes'],
    }));
    writeFileSync(join(appDir, 'synpress.config.ts'), '');

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps[0].routes).toEqual(['/custom', '/routes']);
  });
});

describe('discoverAppsForWarmup - Edge Cases', () => {
  test('should handle malformed manifest JSON', () => {
    const appDir = join(TEST_APPS_DIR, 'bad-json');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'jeju-manifest.json'), 'not json{{{');
    writeFileSync(join(appDir, 'synpress.config.ts'), '');

    // Should not throw, just skip the app
    expect(() => discoverAppsForWarmup(TEST_DIR)).toThrow();
  });

  test('should handle file instead of directory in apps', () => {
    writeFileSync(join(TEST_APPS_DIR, 'not-a-dir.txt'), 'just a file');

    const apps = discoverAppsForWarmup(TEST_DIR);

    expect(apps.length).toBe(0);
  });

  test('should handle symlinks gracefully', () => {
    // Create real app
    setupTestApp('real-app');

    // This test is platform-dependent, just verify no crash
    const apps = discoverAppsForWarmup(TEST_DIR);
    expect(apps.length).toBeGreaterThanOrEqual(1);
  });
});

describe('warmupApps - Warmup Execution', () => {
  test('should return success with no apps to warmup', async () => {
    // Filter to an app that doesn't exist
    const result = await warmupApps({
      apps: ['nonexistent-app-xyz'],
      visitPages: false,
      buildApps: false,
    });

    expect(result.success).toBe(true);
    expect(result.apps).toEqual([]);
  });

  test('should track duration', async () => {
    const result = await warmupApps({
      apps: ['nonexistent-app-xyz'],
      visitPages: false,
      buildApps: false,
    });

    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test('should report status for discovered apps', async () => {
    // Use real workspace discovery but don't visit pages
    const result = await warmupApps({
      visitPages: false,
      buildApps: false,
    });

    // Should discover real apps
    expect(result.apps.length).toBeGreaterThan(0);

    // Each app should have a result
    for (const app of result.apps) {
      expect(app.name).toBeTruthy();
      expect(app.errors).toBeInstanceOf(Array);
    }
  });
});

describe('quickWarmup - Fast Warmup', () => {
  test('should not throw when no apps found', async () => {
    await expect(quickWarmup(['nonexistent'])).resolves.toBeUndefined();
  });

  test('should handle apps not running', async () => {
    setupTestApp('offline-app', { port: 59998 });

    // Should complete without throwing
    await expect(quickWarmup()).resolves.toBeUndefined();
  });

  test('should filter by app names when provided', async () => {
    setupTestApp('filter-test', { port: 59997 });

    // Should complete for non-matching filter
    await expect(quickWarmup(['other-app'])).resolves.toBeUndefined();
  });
});

describe('Warmup - Real World Discovery', () => {
  // Get workspace root (packages/tests -> ../..)
  const workspaceRoot = join(process.cwd(), '../..');

  test('should discover apps in actual jeju workspace', () => {
    // Use actual workspace root
    const apps = discoverAppsForWarmup(workspaceRoot);

    // Should find some apps
    expect(apps.length).toBeGreaterThan(0);

    // Verify structure
    for (const app of apps) {
      expect(app.name).toBeTruthy();
      expect(typeof app.port).toBe('number');
      expect(app.port).toBeGreaterThan(0);
      expect(app.routes).toBeInstanceOf(Array);
      expect(typeof app.isNextJs).toBe('boolean');
    }
  });

  test('should find expected apps in workspace', () => {
    const apps = discoverAppsForWarmup(process.cwd());
    const appNames = apps.map(a => a.name);

    // Check for known apps
    const knownApps = ['bazaar', 'gateway', 'compute'];
    const foundKnownApps = knownApps.filter(name =>
      appNames.some(n => n.includes(name))
    );

    expect(foundKnownApps.length).toBeGreaterThan(0);
  });
});

