#!/usr/bin/env bun
/**
 * Enhanced Dev Script with Dynamic Vendor App Discovery
 * 
 * Discovers and starts vendor apps dynamically based on manifests
 * No hardcoded app expectations - fully optional and dynamic
 */

import { spawn } from 'bun';
import { discoverVendorApps, displayAppsSummary, type JejuApp } from './shared/discover-apps';

interface ProcessInfo {
  name: string;
  process: ReturnType<typeof spawn>;
  port?: number;
}

const runningProcesses: ProcessInfo[] = [];

// Cleanup handler
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down all services...\n');
  
  for (const proc of runningProcesses) {
    console.log(`   Stopping ${proc.name}...`);
    proc.process.kill();
  }
  
  console.log('\n✅ All services stopped\n');
  process.exit(0);
});

/**
 * Start a Jeju app
 */
async function startJejuApp(app: JejuApp): Promise<ProcessInfo | null> {
  const devCommand = app.manifest.commands?.dev;
  
  if (!devCommand) {
    console.log(`   ℹ️  ${app.manifest.displayName || app.name}: No dev command configured`);
    return null;
  }

  console.log(`   🚀 Starting ${app.manifest.displayName || app.name}...`);
  
  // Parse command (e.g., "bun run dev" -> ["bun", "run", "dev"])
  const cmdParts = devCommand.split(' ');
  
  const proc = spawn({
    cmd: cmdParts,
    cwd: app.path,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env }
  });

  // Stream output with prefix
  const prefix = `[${app.manifest.displayName || app.name}]`;
  
  if (proc.stdout) {
    for await (const chunk of proc.stdout) {
      const text = new TextDecoder().decode(chunk);
      process.stdout.write(`${prefix} ${text}`);
    }
  }

  if (proc.stderr) {
    for await (const chunk of proc.stderr) {
      const text = new TextDecoder().decode(chunk);
      process.stderr.write(`${prefix} ${text}`);
    }
  }

  const mainPort = app.manifest.ports?.main;

  return {
    name: app.manifest.displayName || app.name,
    process: proc,
    port: mainPort
  };
}

/**
 * Main function
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║               🚀 Jeju Development Environment               ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Discover vendor apps
  const vendorApps = discoverVendorApps();
  
  displayAppsSummary();

  if (vendorApps.length === 0) {
    console.log('ℹ️  No vendor apps to start\n');
    console.log('Tip: Add vendor apps as git submodules in /vendor with jeju-manifest.json\n');
    return;
  }

  // Filter to only existing/installed apps
  const availableApps = vendorApps.filter(app => app.exists);

  if (availableApps.length === 0) {
    console.log('⚠️  Vendor apps found but not initialized\n');
    console.log('Run: git submodule update --init --recursive\n');
    return;
  }

  console.log('🎬 Starting vendor apps...\n');

  // Start each vendor app
  for (const app of availableApps) {
    const procInfo = await startJejuApp(app);
    
    if (procInfo) {
      runningProcesses.push(procInfo);
      
      if (procInfo.port) {
        console.log(`   ✅ ${procInfo.name} running on port ${procInfo.port}`);
      } else {
        console.log(`   ✅ ${procInfo.name} started`);
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✨ All vendor apps running!\n');
  console.log('   Press Ctrl+C to stop all services\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Keep running
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('\n❌ Error starting vendor apps:', error);
  process.exit(1);
});

