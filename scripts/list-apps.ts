#!/usr/bin/env bun
/**
 * List all discovered Jeju apps (core + vendor)
 * Run: bun run apps:list
 */

import { discoverAllApps, displayAppsSummary } from './shared/discover-apps';

function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║                  🏪 Jeju Apps Discovery                     ║');
  console.log('║             Core Apps + Vendor Apps                          ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  displayAppsSummary();

  const apps = discoverAllApps();

  if (apps.length === 0) {
    console.log('\nℹ️  No apps found.');
    console.log('\nTo add a vendor app:');
    console.log('  1. git submodule add <repo-url> vendor/<app-name>');
    console.log('  2. Create vendor/<app-name>/jeju-manifest.json');
    console.log('  3. git submodule update --init --recursive\n');
    console.log('\nTo add a core app:');
    console.log('  1. Create apps/<app-name>');
    console.log('  2. Create apps/<app-name>/jeju-manifest.json');
    console.log('  3. Add "type": "core" to the manifest\n');
    return;
  }

  console.log('\n📋 Detailed Information:\n');

  for (const app of apps) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n🔹 ${app.manifest.displayName || app.name} [${app.type.toUpperCase()}]`);
    console.log(`   Name: ${app.name}`);
    console.log(`   Version: ${app.manifest.version}`);
    console.log(`   Path: ${app.path}`);
    console.log(`   Status: ${app.exists ? 'Installed ✅' : 'Not initialized ⚠️'}`);
    console.log(`   Auto-start: ${app.manifest.autoStart !== false ? 'Yes ✅' : 'No ⏭️'}`);
    
    if (app.manifest.commands) {
      console.log('\n   Available Commands:');
      for (const [cmd, script] of Object.entries(app.manifest.commands)) {
        if (script) {
          console.log(`     • ${cmd}: ${script}`);
        }
      }
    }
    
    if (app.manifest.ports) {
      console.log('\n   Ports:');
      for (const [name, port] of Object.entries(app.manifest.ports)) {
        console.log(`     • ${name}: ${port}`);
      }
    }
    
    if (app.manifest.dependencies && app.manifest.dependencies.length > 0) {
      console.log(`\n   Dependencies: ${app.manifest.dependencies.join(', ')}`);
    }
    
    if (app.manifest.tags && app.manifest.tags.length > 0) {
      console.log(`   Tags: ${app.manifest.tags.join(', ')}`);
    }
    
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('💡 To start all apps: bun run dev');
  console.log('💡 To start only vendor apps: bun run dev:vendor\n');
}

main();

