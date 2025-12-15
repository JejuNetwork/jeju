#!/usr/bin/env bun
/**
 * Register Triggers for All Apps
 * 
 * Reads jeju-manifest.json files and registers triggers with the Compute service.
 * Supports cron, webhook, and event triggers with on-chain registration.
 * 
 * Usage:
 *   bun scripts/register-triggers.ts [--app <app-name>] [--network localnet|testnet|mainnet]
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getTriggerClient, registerAppTriggers, type AppTriggersConfig, type AppTriggerConfig } from '../packages/shared/src/triggers';

interface ManifestTrigger {
  name: string;
  type: 'cron' | 'webhook' | 'event';
  cronExpression?: string;
  webhookPath?: string;
  eventTypes?: string[];
  endpoint: string;
  description?: string;
  timeout?: number;
}

interface JejuManifest {
  name: string;
  ports?: { main?: number };
  decentralization?: {
    triggers?: ManifestTrigger[];
  };
  agent?: {
    enabled?: boolean;
  };
}

interface RegisterResult {
  appName: string;
  triggersRegistered: number;
  triggerIds: string[];
  errors: string[];
}

// Get all apps with triggers defined in manifest
function getAppsWithTriggers(appsDir: string, filterApp?: string): Map<string, JejuManifest> {
  const apps = new Map<string, JejuManifest>();
  
  const appDirs = filterApp ? [filterApp] : readdirSync(appsDir);
  
  for (const appName of appDirs) {
    const manifestPath = join(appsDir, appName, 'jeju-manifest.json');
    
    if (!existsSync(manifestPath)) continue;
    
    const manifest = JSON.parse(Bun.file(manifestPath).text() as unknown as string) as JejuManifest;
    
    // Check if app has triggers defined
    if (manifest.decentralization?.triggers && manifest.decentralization.triggers.length > 0) {
      apps.set(appName, manifest);
    }
  }
  
  return apps;
}

// Convert manifest trigger to AppTriggerConfig
function convertTrigger(trigger: ManifestTrigger): AppTriggerConfig {
  return {
    name: trigger.name,
    description: trigger.description,
    type: trigger.type,
    cronExpression: trigger.cronExpression,
    webhookPath: trigger.webhookPath,
    eventTypes: trigger.eventTypes,
    endpointPath: trigger.endpoint,
    timeout: trigger.timeout,
    registerOnChain: true,
  };
}

// Register triggers for a single app
async function registerTriggersForApp(
  appName: string,
  manifest: JejuManifest,
  network: string
): Promise<RegisterResult> {
  const result: RegisterResult = {
    appName,
    triggersRegistered: 0,
    triggerIds: [],
    errors: [],
  };
  
  const triggers = manifest.decentralization?.triggers ?? [];
  if (triggers.length === 0) {
    return result;
  }
  
  // Determine app host based on network
  const appPort = manifest.ports?.main ?? 3000;
  const appHost = network === 'localnet'
    ? `http://localhost:${appPort}`
    : network === 'testnet'
    ? `https://${appName}.testnet.jeju.network`
    : `https://${appName}.jeju.network`;
  
  const config: AppTriggersConfig = {
    appName,
    appPort,
    appHost,
    triggers: triggers.map(convertTrigger),
  };
  
  console.log(`\n📱 ${appName}`);
  console.log(`   Host: ${appHost}`);
  console.log(`   Triggers: ${triggers.length}`);
  
  const registered = await registerAppTriggers(config);
  
  result.triggersRegistered = registered.length;
  result.triggerIds = registered.map((t) => t.id);
  
  for (const trigger of registered) {
    console.log(`   ✅ ${trigger.name}: ${trigger.id.slice(0, 12)}...`);
  }
  
  return result;
}

// Main
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║              ⏰  JEJU TRIGGER REGISTRATION                                    ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Parse arguments
  const args = process.argv.slice(2);
  let filterApp: string | undefined;
  let network = 'localnet';
  
  const appIndex = args.indexOf('--app');
  if (appIndex !== -1 && args[appIndex + 1]) {
    filterApp = args[appIndex + 1];
  }
  
  const networkIndex = args.indexOf('--network');
  if (networkIndex !== -1 && args[networkIndex + 1]) {
    network = args[networkIndex + 1];
  }
  
  console.log(`🌐 Network: ${network}`);
  if (filterApp) {
    console.log(`📱 App filter: ${filterApp}`);
  }
  
  // Verify trigger service is available
  const client = getTriggerClient();
  const stats = await client.getStats().catch(() => null);
  
  if (!stats) {
    console.error('\n❌ Trigger service not available. Start infrastructure first:');
    console.error('   bun run start');
    process.exit(1);
  }
  
  console.log(`\n📊 Trigger service status:`);
  console.log(`   Total triggers: ${stats.triggerCount}`);
  console.log(`   Active executions: ${stats.activeExecutions}`);
  
  // Get apps with triggers
  const appsDir = join(process.cwd(), 'apps');
  const apps = getAppsWithTriggers(appsDir, filterApp);
  
  if (apps.size === 0) {
    console.log('\n⚠️  No apps with triggers found');
    process.exit(0);
  }
  
  console.log(`\n🔍 Found ${apps.size} app(s) with triggers`);
  
  // Register triggers for each app
  const results: RegisterResult[] = [];
  
  for (const [appName, manifest] of apps) {
    const result = await registerTriggersForApp(appName, manifest, network);
    results.push(result);
  }
  
  // Summary
  const totalRegistered = results.reduce((sum, r) => sum + r.triggersRegistered, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  ✅ REGISTRATION COMPLETE                                                      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  Apps processed:    ${String(apps.size).padEnd(53)}║
║  Triggers registered: ${String(totalRegistered).padEnd(51)}║
${totalErrors > 0 ? `║  Errors:            ${String(totalErrors).padEnd(53)}║\n` : ''}║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // List all triggers
  if (totalRegistered > 0) {
    console.log('Registered triggers:');
    for (const result of results) {
      if (result.triggersRegistered > 0) {
        console.log(`  ${result.appName}:`);
        for (const id of result.triggerIds) {
          console.log(`    - ${id}`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error('❌ Registration failed:', err.message);
  process.exit(1);
});
