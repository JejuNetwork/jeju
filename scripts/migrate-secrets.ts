#!/usr/bin/env bun
/**
 * Migrate Secrets to Decentralized Vault
 * 
 * Reads secrets from .env files and migrates them to the KMS SecretVault.
 * Supports per-app secrets with proper access policies.
 * 
 * Usage:
 *   bun scripts/migrate-secrets.ts [--app <app-name>] [--dry-run]
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getSecretsLoader } from '../packages/shared/src/secrets';
import type { Address } from 'viem';

interface SecretMapping {
  envKey: string;
  secretName: string;
  required: boolean;
}

interface AppSecrets {
  appName: string;
  secrets: SecretMapping[];
}

interface MigrationResult {
  appName: string;
  migrated: string[];
  skipped: string[];
  errors: string[];
}

// Known secret mappings per app
const APP_SECRET_MAPPINGS: Record<string, SecretMapping[]> = {
  leaderboard: [
    { envKey: 'GITHUB_TOKEN', secretName: 'github-token', required: true },
    { envKey: 'ANTHROPIC_API_KEY', secretName: 'anthropic-api-key', required: false },
    { envKey: 'OPENAI_API_KEY', secretName: 'openai-api-key', required: false },
  ],
  council: [
    { envKey: 'ANTHROPIC_API_KEY', secretName: 'anthropic-api-key', required: true },
    { envKey: 'OLLAMA_URL', secretName: 'ollama-url', required: false },
  ],
  oracle: [
    { envKey: 'COINGECKO_API_KEY', secretName: 'coingecko-api-key', required: false },
    { envKey: 'DEFILLAMA_API_KEY', secretName: 'defillama-api-key', required: false },
  ],
  storage: [
    { envKey: 'IPFS_API_KEY', secretName: 'ipfs-api-key', required: false },
    { envKey: 'PINATA_API_KEY', secretName: 'pinata-api-key', required: false },
    { envKey: 'PINATA_SECRET_KEY', secretName: 'pinata-secret-key', required: false },
  ],
  compute: [
    { envKey: 'PRIVATE_KEY', secretName: 'operator-key', required: true },
  ],
  crucible: [
    { envKey: 'PRIVATE_KEY', secretName: 'operator-key', required: true },
    { envKey: 'ANTHROPIC_API_KEY', secretName: 'anthropic-api-key', required: false },
  ],
  gateway: [
    { envKey: 'X402_SETTLER_KEY', secretName: 'x402-settler-key', required: false },
  ],
  monitoring: [
    { envKey: 'PAGERDUTY_API_KEY', secretName: 'pagerduty-api-key', required: false },
    { envKey: 'SLACK_WEBHOOK_URL', secretName: 'slack-webhook-url', required: false },
  ],
};

// Parse .env file
function parseEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  
  if (!existsSync(path)) {
    return env;
  }
  
  const content = Bun.file(path).text() as unknown as string;
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    
    const key = trimmed.slice(0, eqIndex);
    let value = trimmed.slice(eqIndex + 1);
    
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    env[key] = value;
  }
  
  return env;
}

// Get secrets for an app from environment and .env files
function getAppSecrets(appName: string, appsDir: string): Record<string, string> {
  const secrets: Record<string, string> = {};
  
  // Load from root .env
  const rootEnv = parseEnvFile(join(process.cwd(), '.env'));
  
  // Load from app-specific .env
  const appEnv = parseEnvFile(join(appsDir, appName, '.env'));
  
  // Merge with process.env taking precedence
  const allEnv = { ...rootEnv, ...appEnv, ...process.env };
  
  // Get secrets based on mapping
  const mappings = APP_SECRET_MAPPINGS[appName] ?? [];
  
  for (const mapping of mappings) {
    const value = allEnv[mapping.envKey];
    if (value) {
      secrets[mapping.secretName] = value;
    }
  }
  
  return secrets;
}

// Migrate secrets for a single app
async function migrateAppSecrets(
  appName: string,
  secrets: Record<string, string>,
  dryRun: boolean
): Promise<MigrationResult> {
  const result: MigrationResult = {
    appName,
    migrated: [],
    skipped: [],
    errors: [],
  };
  
  if (Object.keys(secrets).length === 0) {
    return result;
  }
  
  console.log(`\n📱 ${appName}`);
  console.log(`   Found ${Object.keys(secrets).length} secret(s)`);
  
  if (dryRun) {
    for (const name of Object.keys(secrets)) {
      console.log(`   🔍 Would migrate: ${name}`);
      result.skipped.push(name);
    }
    return result;
  }
  
  // Get secrets loader for this app
  const loader = getSecretsLoader(appName);
  
  for (const [name, value] of Object.entries(secrets)) {
    const stored = await loader.store(name, value, [appName]).catch((err: Error) => {
      result.errors.push(`${name}: ${err.message}`);
      return null;
    });
    
    if (stored) {
      console.log(`   ✅ Migrated: ${name} (v${stored.version})`);
      result.migrated.push(name);
    } else {
      console.log(`   ❌ Failed: ${name}`);
    }
  }
  
  return result;
}

// Discover apps that need secrets migration
function discoverApps(appsDir: string, filterApp?: string): AppSecrets[] {
  const apps: AppSecrets[] = [];
  
  const appDirs = filterApp ? [filterApp] : readdirSync(appsDir);
  
  for (const appName of appDirs) {
    const appPath = join(appsDir, appName);
    if (!existsSync(join(appPath, 'package.json'))) continue;
    
    const mappings = APP_SECRET_MAPPINGS[appName];
    if (mappings && mappings.length > 0) {
      apps.push({
        appName,
        secrets: mappings,
      });
    }
  }
  
  return apps;
}

// Main
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║              🔐  JEJU SECRETS MIGRATION                                       ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Parse arguments
  const args = process.argv.slice(2);
  let filterApp: string | undefined;
  let dryRun = false;
  
  const appIndex = args.indexOf('--app');
  if (appIndex !== -1 && args[appIndex + 1]) {
    filterApp = args[appIndex + 1];
  }
  
  if (args.includes('--dry-run')) {
    dryRun = true;
    console.log('🔍 DRY RUN MODE - no secrets will be stored\n');
  }
  
  // Check vault availability
  const vaultEndpoint = process.env.VAULT_ENDPOINT ?? process.env.DA_ENDPOINT ?? 'http://localhost:4010';
  console.log(`🏦 Vault endpoint: ${vaultEndpoint}`);
  
  const vaultHealth = await fetch(`${vaultEndpoint}/health`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.ok)
    .catch(() => false);
  
  if (!vaultHealth && !dryRun) {
    console.error('\n❌ Vault service not available. Start infrastructure first:');
    console.error('   bun run start');
    process.exit(1);
  }
  
  // Discover apps
  const appsDir = join(process.cwd(), 'apps');
  const apps = discoverApps(appsDir, filterApp);
  
  if (apps.length === 0) {
    console.log('\n⚠️  No apps with secret mappings found');
    process.exit(0);
  }
  
  console.log(`\n🔍 Found ${apps.length} app(s) with secrets`);
  
  // Migrate secrets for each app
  const results: MigrationResult[] = [];
  
  for (const app of apps) {
    const secrets = getAppSecrets(app.appName, appsDir);
    const result = await migrateAppSecrets(app.appName, secrets, dryRun);
    results.push(result);
  }
  
  // Summary
  const totalMigrated = results.reduce((sum, r) => sum + r.migrated.length, 0);
  const totalSkipped = results.reduce((sum, r) => sum + r.skipped.length, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  ${dryRun ? '🔍 DRY RUN COMPLETE' : '✅ MIGRATION COMPLETE'}                                                      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  Apps processed:  ${String(apps.length).padEnd(55)}║
║  Secrets migrated: ${String(totalMigrated).padEnd(54)}║
║  Secrets skipped: ${String(totalSkipped).padEnd(55)}║
${totalErrors > 0 ? `║  Errors:          ${String(totalErrors).padEnd(55)}║\n` : ''}║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Show any errors
  if (totalErrors > 0) {
    console.log('\nErrors:');
    for (const result of results) {
      if (result.errors.length > 0) {
        console.log(`  ${result.appName}:`);
        for (const error of result.errors) {
          console.log(`    - ${error}`);
        }
      }
    }
  }
  
  // Provide next steps
  if (!dryRun && totalMigrated > 0) {
    console.log(`
💡 Next steps:
   1. Remove secrets from .env files
   2. Set USE_VAULT=true in your environment
   3. Restart your apps to use vault-backed secrets
`);
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
