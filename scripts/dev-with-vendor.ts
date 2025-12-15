#!/usr/bin/env bun
/**
 * Starts only vendor apps (requires chain running separately)
 */

import { spawn, type Subprocess } from 'bun';
import { discoverVendorApps, type NetworkApp } from './shared/discover-apps';

const processes: Subprocess[] = [];

process.on('SIGINT', () => {
  for (const proc of processes) proc.kill();
  process.exit(0);
});

async function startApp(app: NetworkApp): Promise<void> {
  const devCommand = app.manifest.commands?.dev;
  if (!devCommand) return;

  const appName = app.manifest.displayName || app.name;
  console.log(`  ${appName}...`);
  
  const proc = spawn({
    cmd: devCommand.split(' '),
    cwd: app.path,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      RPC_URL: process.env.JEJU_RPC_URL || 'http://localhost:9545',
      JEJU_RPC_URL: process.env.JEJU_RPC_URL || 'http://localhost:9545',
      CHAIN_ID: '1337',
    }
  });

  processes.push(proc);

  // Log errors only
  (async () => {
    if (!proc.stderr) return;
    const stderr = proc.stderr as unknown as AsyncIterable<Uint8Array>;
    for await (const chunk of stderr) {
      const text = new TextDecoder().decode(chunk).trim();
      if (text.toLowerCase().includes('error')) {
        console.log(`[${appName}] ${text}`);
      }
    }
  })();
}

async function main() {
  console.log('Starting vendor apps...\n');

  const vendorApps = discoverVendorApps().filter(app => app.exists);
  
  if (vendorApps.length === 0) {
    console.log('No vendor apps found');
    return;
  }

  for (const app of vendorApps) {
    await startApp(app);
  }

  console.log(`\n${vendorApps.length} vendor apps started. Ctrl+C to stop.\n`);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
