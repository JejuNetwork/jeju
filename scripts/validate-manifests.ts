/**
 * Validate all jeju-manifest.json files
 * Ensures CDN, JNS, and decentralization settings are properly configured
 */

import { readdirSync, existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

interface ValidationResult {
  app: string;
  path: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  features: {
    jns: boolean;
    cdn: boolean;
    ipfs: boolean;
    serviceWorker: boolean;
    offlineSupport: boolean;
  };
}

function discoverAppsInDirectory(baseDir: string): string[] {
  const apps: string[] = [];
  if (!existsSync(baseDir)) return apps;

  const entries = readdirSync(baseDir);
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'README.md' || entry === 'tests') continue;
    
    const appPath = join(baseDir, entry);
    const stats = statSync(appPath);
    if (!stats.isDirectory()) continue;
    
    const manifestPath = join(appPath, 'jeju-manifest.json');
    if (existsSync(manifestPath)) {
      apps.push(appPath);
    }
  }
  return apps;
}

function validateManifest(appPath: string): ValidationResult {
  const manifestPath = join(appPath, 'jeju-manifest.json');
  const errors: string[] = [];
  const warnings: string[] = [];
  const features = {
    jns: false,
    cdn: false,
    ipfs: false,
    serviceWorker: false,
    offlineSupport: false,
  };

  if (!existsSync(manifestPath)) {
    return {
      app: appPath.split('/').pop() ?? 'unknown',
      path: appPath,
      valid: false,
      errors: ['No jeju-manifest.json found'],
      warnings: [],
      features,
    };
  }

  const content = readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(content);

  // Check JNS configuration
  if (manifest.jns?.name) {
    features.jns = true;
  } else {
    warnings.push('No JNS name configured');
  }

  // Check CDN configuration
  const cdn = manifest.decentralization?.cdn;
  if (cdn?.enabled) {
    features.cdn = true;
    
    if (cdn.serviceWorker) {
      features.serviceWorker = true;
    }
  }

  // Check frontend decentralization
  const frontend = manifest.decentralization?.frontend;
  if (frontend?.ipfs) {
    features.ipfs = true;
  }
  
  // Check robustness
  const robustness = manifest.decentralization?.robustness;
  if (robustness?.offlineSupport) {
    features.offlineSupport = true;
  }

  // Check for missing health check
  if (!manifest.healthCheck?.url && !manifest.healthCheck?.endpoint) {
    warnings.push('No health check endpoint configured');
  }

  // Check agent configuration
  if (manifest.agent?.enabled && !manifest.agent.jnsName) {
    warnings.push('Agent enabled but no JNS name for agent');
  }

  // Validate required fields
  if (!manifest.name) {
    errors.push('Missing required field: name');
  }
  if (!manifest.version) {
    errors.push('Missing required field: version');
  }

  return {
    app: manifest.name || appPath.split('/').pop() || 'unknown',
    path: appPath,
    valid: errors.length === 0,
    errors,
    warnings,
    features,
  };
}

function printResults(results: ValidationResult[]): void {
  console.log('\n📋 Manifest Validation Results\n');
  
  const valid = results.filter(r => r.valid);
  const invalid = results.filter(r => !r.valid);

  // Print summary table
  console.log('┌─────────────────────────┬───────┬──────┬──────┬─────┬────────────────┐');
  console.log('│ App                     │ Valid │ JNS  │ CDN  │ SW  │ Offline        │');
  console.log('├─────────────────────────┼───────┼──────┼──────┼─────┼────────────────┤');
  
  for (const result of results) {
    const app = result.app.padEnd(23).slice(0, 23);
    const validStr = result.valid ? '  ✅  ' : '  ❌  ';
    const jns = result.features.jns ? '  ✅ ' : '  ❌ ';
    const cdn = result.features.cdn ? '  ✅ ' : '  ❌ ';
    const sw = result.features.serviceWorker ? ' ✅ ' : ' ❌ ';
    const offline = result.features.offlineSupport ? '      ✅       ' : '      ❌       ';
    console.log(`│ ${app} │${validStr}│${jns}│${cdn}│${sw}│${offline}│`);
  }
  
  console.log('└─────────────────────────┴───────┴──────┴──────┴─────┴────────────────┘');

  // Print errors
  if (invalid.length > 0) {
    console.log('\n❌ Apps with Errors:\n');
    for (const result of invalid) {
      console.log(`  ${result.app}:`);
      for (const error of result.errors) {
        console.log(`    ❌ ${error}`);
      }
    }
  }

  // Print warnings
  const withWarnings = results.filter(r => r.warnings.length > 0);
  if (withWarnings.length > 0) {
    console.log('\n⚠️  Warnings:\n');
    for (const result of withWarnings) {
      console.log(`  ${result.app}:`);
      for (const warning of result.warnings) {
        console.log(`    ⚠️  ${warning}`);
      }
    }
  }

  // Summary
  const totalFeatures = results.reduce((acc, r) => ({
    jns: acc.jns + (r.features.jns ? 1 : 0),
    cdn: acc.cdn + (r.features.cdn ? 1 : 0),
    ipfs: acc.ipfs + (r.features.ipfs ? 1 : 0),
    serviceWorker: acc.serviceWorker + (r.features.serviceWorker ? 1 : 0),
    offlineSupport: acc.offlineSupport + (r.features.offlineSupport ? 1 : 0),
  }), { jns: 0, cdn: 0, ipfs: 0, serviceWorker: 0, offlineSupport: 0 });

  console.log('\n📊 Summary:');
  console.log(`   Total apps: ${results.length}`);
  console.log(`   Valid: ${valid.length} | Invalid: ${invalid.length}`);
  console.log(`   JNS configured: ${totalFeatures.jns}/${results.length}`);
  console.log(`   CDN enabled: ${totalFeatures.cdn}/${results.length}`);
  console.log(`   IPFS deployment: ${totalFeatures.ipfs}/${results.length}`);
  console.log(`   Service Workers: ${totalFeatures.serviceWorker}/${results.length}`);
  console.log(`   Offline Support: ${totalFeatures.offlineSupport}/${results.length}`);
  console.log('');
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  
  // Discover all apps
  const coreApps = discoverAppsInDirectory(join(rootDir, 'apps'));
  const vendorApps = discoverAppsInDirectory(join(rootDir, 'vendor'));
  const allApps = [...coreApps, ...vendorApps];

  console.log(`\nDiscovered ${allApps.length} apps (${coreApps.length} core, ${vendorApps.length} vendor)\n`);

  // Validate each app
  const results: ValidationResult[] = [];
  
  for (const appPath of allApps) {
    const result = validateManifest(appPath);
    results.push(result);
  }

  printResults(results);

  // Exit with error if any invalid
  const hasErrors = results.some(r => !r.valid);
  process.exit(hasErrors ? 1 : 0);
}

main().catch(console.error);

