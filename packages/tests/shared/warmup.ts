/**
 * App Warmup - Pre-compiles Next.js apps and visits pages to cache them
 */

import { spawn } from 'bun';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { chromium, type Browser } from 'playwright';

export interface AppConfig {
  name: string;
  path: string;
  port: number;
  routes: string[];
  isNextJs: boolean;
}

export interface WarmupOptions {
  apps?: string[];
  visitPages?: boolean;
  buildApps?: boolean;
  timeout?: number;
  headless?: boolean;
}

export interface WarmupResult {
  success: boolean;
  apps: AppWarmupResult[];
  duration: number;
}

export interface AppWarmupResult {
  name: string;
  success: boolean;
  pagesVisited: number;
  buildTime?: number;
  errors: string[];
}

const DEFAULT_ROUTES = ['/', '/about', '/settings'];

export function discoverAppsForWarmup(rootDir = process.cwd()): AppConfig[] {
  const appsDir = join(rootDir, 'apps');
  if (!existsSync(appsDir)) return [];

  const apps: AppConfig[] = [];

  for (const appName of readdirSync(appsDir)) {
    if (appName.startsWith('.') || appName === 'node_modules') continue;

    const appPath = join(appsDir, appName);
    try {
      if (!statSync(appPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const manifestPath = join(appPath, 'jeju-manifest.json');
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const mainPort = manifest.ports?.main;
    if (!mainPort) continue;

    // Only include apps with test configs
    const hasTestConfig = existsSync(join(appPath, 'synpress.config.ts')) ||
                          existsSync(join(appPath, 'playwright.config.ts'));
    if (!hasTestConfig) continue;

    // Check if it's a Next.js app
    const packagePath = join(appPath, 'package.json');
    let isNextJs = false;
    if (existsSync(packagePath)) {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
      isNextJs = !!(pkg.dependencies?.next || pkg.devDependencies?.next);
    }

    apps.push({
      name: appName,
      path: appPath,
      port: mainPort,
      routes: manifest.warmupRoutes || DEFAULT_ROUTES,
      isNextJs,
    });
  }

  return apps;
}

async function isAppRunning(port: number, timeout = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(`http://localhost:${port}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

async function buildApp(
  appConfig: AppConfig,
  timeout = 300000
): Promise<{ success: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  console.log(`  Building ${appConfig.name}...`);

  return new Promise((resolve) => {
    const proc = spawn({
      cmd: ['bun', 'run', 'build'],
      cwd: appConfig.path,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeoutId = setTimeout(() => {
      proc.kill();
      resolve({ success: false, duration: Date.now() - startTime, error: 'Build timeout' });
    }, timeout);

    proc.exited.then((exitCode) => {
      clearTimeout(timeoutId);
      resolve({
        success: exitCode === 0,
        duration: Date.now() - startTime,
        error: exitCode !== 0 ? `Build exited with code ${exitCode}` : undefined,
      });
    });
  });
}

async function visitPages(
  browser: Browser,
  appConfig: AppConfig,
  timeout = 30000
): Promise<{ visited: number; errors: string[] }> {
  const errors: string[] = [];
  let visited = 0;
  const context = await browser.newContext();
  const page = await context.newPage();
  const baseUrl = `http://localhost:${appConfig.port}`;

  for (const route of appConfig.routes) {
    try {
      const response = await page.goto(`${baseUrl}${route}`, { timeout, waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      
      if (status >= 500) {
        errors.push(`${route}: HTTP ${status}`);
      } else if (status === 404) {
        // 404 is expected for non-existent routes - warmup still works
        visited++;
      } else if (status >= 200 && status < 400) {
        visited++;
      } else {
        errors.push(`${route}: HTTP ${status}`);
      }
      
      await page.waitForTimeout(300); // Brief pause between pages
    } catch (error) {
      errors.push(`${route}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await context.close();
  return { visited, errors };
}

export async function warmupApps(options: WarmupOptions = {}): Promise<WarmupResult> {
  const startTime = Date.now();
  const {
    apps: appFilter,
    visitPages: doVisitPages = true,
    buildApps: doBuild = false,
    timeout = 60000,
    headless = true,
  } = options;

  console.log('\n' + '='.repeat(70));
  console.log('APP WARMUP');
  console.log('='.repeat(70) + '\n');

  let allApps = discoverAppsForWarmup();
  if (appFilter?.length) {
    allApps = allApps.filter(app => appFilter.includes(app.name));
  }

  if (allApps.length === 0) {
    console.log('No apps to warm up');
    return { success: true, apps: [], duration: Date.now() - startTime };
  }

  console.log(`Found ${allApps.length} app(s): ${allApps.map(a => a.name).join(', ')}\n`);

  const results: AppWarmupResult[] = [];
  let browser: Browser | null = null;

  if (doVisitPages) {
    console.log('Starting browser...');
    browser = await chromium.launch({ headless });
  }

  for (const appConfig of allApps) {
    console.log(`\n[${appConfig.name}]`);
    const appResult: AppWarmupResult = {
      name: appConfig.name,
      success: true,
      pagesVisited: 0,
      errors: [],
    };

    if (doBuild && appConfig.isNextJs) {
      const buildResult = await buildApp(appConfig, timeout * 5);
      appResult.buildTime = buildResult.duration;
      if (!buildResult.success) {
        appResult.success = false;
        appResult.errors.push(buildResult.error || 'Build failed');
        console.log(`    ❌ Build failed: ${buildResult.error}`);
        results.push(appResult);
        continue;
      }
      console.log(`    ✅ Build completed in ${(buildResult.duration / 1000).toFixed(1)}s`);
    }

    const isRunning = await isAppRunning(appConfig.port);
    if (!isRunning) {
      console.log(`    ⚠️  Not running on port ${appConfig.port}`);
      appResult.errors.push(`App not running on port ${appConfig.port}`);
      results.push(appResult);
      continue;
    }

    console.log(`    ✅ Running on port ${appConfig.port}`);

    if (doVisitPages && browser) {
      const visitResult = await visitPages(browser, appConfig, timeout);
      appResult.pagesVisited = visitResult.visited;
      appResult.errors.push(...visitResult.errors);

      if (visitResult.errors.length > 0) {
        appResult.success = false;
        console.log(`    ⚠️  ${visitResult.errors.length} page error(s)`);
      } else {
        console.log(`    ✅ Visited ${visitResult.visited} page(s)`);
      }
    }

    results.push(appResult);
  }

  if (browser) await browser.close();

  const duration = Date.now() - startTime;
  const allSuccess = results.every(r => r.success);

  console.log('\n' + '='.repeat(70));
  console.log(allSuccess ? '✅ WARMUP COMPLETE' : '⚠️  WARMUP COMPLETED WITH ERRORS');
  console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log('='.repeat(70) + '\n');

  return { success: allSuccess, apps: results, duration };
}

export async function quickWarmup(appNames?: string[]): Promise<void> {
  const apps = discoverAppsForWarmup().filter(
    app => !appNames || appNames.includes(app.name)
  );

  console.log('Quick warmup: visiting home pages...');

  for (const app of apps) {
    if (await isAppRunning(app.port)) {
      try {
        const response = await fetch(`http://localhost:${app.port}/`);
        if (response.ok) {
          console.log(`  ✅ ${app.name}`);
        } else if (response.status >= 500) {
          console.log(`  ❌ ${app.name} (${response.status} error)`);
        } else {
          console.log(`  ⚠️  ${app.name} (${response.status})`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`  ❌ ${app.name} (${msg})`);
      }
    } else {
      console.log(`  ⏭️  ${app.name} (not running)`);
    }
  }
}
