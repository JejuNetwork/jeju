#!/usr/bin/env bun
/**
 * Interactive Vendor Manifest Creator
 * Helps create jeju-manifest.json for new vendor apps
 * 
 * Usage: bun run scripts/vendor/create-jeju-manifest.ts <app-name>
 */

import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';


async function promptUser(question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
  process.stdout.write(prompt);
  
  // Read from stdin using Bun's stream API
  const reader = Bun.stdin.stream().getReader();
  const { value, done } = await reader.read();
  reader.releaseLock();
  
  if (done || !value) {
    return defaultValue || '';
  }
  
  const input = new TextDecoder().decode(value).trim();
  return input || defaultValue || '';
}

async function createManifest(appName: string) {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║           📝 Jeju Manifest Creator                          ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`Creating manifest for: ${appName}\n`);

  // Determine path
  const appPath = join(process.cwd(), 'vendor', appName);
  
  if (!existsSync(appPath)) {
    console.log(`⚠️  Directory not found: ${appPath}`);
    console.log(`\nCreate it first:`);
    console.log(`  mkdir -p vendor/${appName}`);
    console.log(`  # or`);
    console.log(`  git submodule add <repo-url> vendor/${appName}\n`);
    process.exit(1);
  }

  // Default values
  const defaults = {
    displayName: appName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    version: '1.0.0',
    devCommand: 'bun run dev',
  };

  console.log('Answer the following questions (press Enter for defaults):\n');

  const displayName = await promptUser('Display Name', defaults.displayName);
  const version = await promptUser('Version', defaults.version);
  const description = await promptUser('Description', 'A Jeju vendor application');
  const devCommand = await promptUser('Dev Command', defaults.devCommand);
  const mainPort = await promptUser('Main Port (optional)', '');

  const manifest = {
    name: appName,
    displayName: displayName || defaults.displayName,
    version: version || defaults.version,
    type: 'vendor',
    description: description || 'A Jeju vendor application',
    commands: {
      dev: devCommand || defaults.devCommand,
      build: 'bun run build',
      test: 'bun run test',
      start: 'bun run start',
    },
    ports: mainPort ? { main: parseInt(mainPort) } : undefined,
    dependencies: [] as string[],
    optional: true,
    enabled: true,
    autoStart: true,
  };

  // Write manifest
  const manifestPath = join(appPath, 'jeju-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\n✅ Manifest created: ${manifestPath}\n`);
  console.log('Preview:\n');
  console.log(JSON.stringify(manifest, null, 2));
  console.log('\n📝 Edit this file to add more details!\n');
}

// Main
const appName = process.argv[2];

if (!appName) {
  console.error('Usage: bun run scripts/vendor/create-jeju-manifest.ts <app-name>');
  console.error('\nExample:');
  console.error('  bun run scripts/vendor/create-jeju-manifest.ts my-app');
  process.exit(1);
}

createManifest(appName);

