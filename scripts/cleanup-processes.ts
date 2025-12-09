#!/usr/bin/env bun
/**
 * Cleanup orphaned Jeju processes
 * 
 * Kills any orphaned bun/node processes from previous dev runs
 * Use this if dev environment crashed and left processes running
 * 
 * Usage:
 *   bun run scripts/cleanup-processes.ts
 */

import { $ } from "bun";

async function main() {
  console.log('🧹 Cleaning up orphaned Jeju processes...\n');
  
  // Stop any running Kurtosis enclaves
  console.log('1️⃣  Stopping Kurtosis localnet...');
  await $`bun run localnet:stop`.nothrow().quiet();
  console.log('   ✅ Kurtosis stopped\n');
  
  // Stop Docker containers
  console.log('2️⃣  Stopping Docker containers...');
  await $`cd apps/indexer && npm run db:down`.nothrow().quiet();
  await $`cd apps/monitoring && docker-compose down`.nothrow().quiet();
  console.log('   ✅ Docker containers stopped\n');
  
  // Kill processes on known ports
  console.log('3️⃣  Killing processes on known ports...');
  
  const portsToKill = [
    4001, // Paymaster Dashboard
    4002, // Node Explorer API
    4003, // Node Explorer UI
    4004, // Documentation
    4005, // Predimarket
    4010, // Grafana
    4350, // Indexer GraphQL
    5001, 5002, // Hyperscape
    5003, 5004, // Launchpad
    5005, // TheDesk
    5006, // Cloud
    5007, 5008, 5009, // Caliguland
    5010, // redteam
    8545, 9545, // RPC
    9090, // Prometheus
  ];
  
  let killed = 0;
  for (const port of portsToKill) {
    const result = await $`lsof -ti:${port}`.nothrow().quiet();
    if (result.exitCode === 0) {
      const pids = result.stdout.toString().trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        await $`kill -9 ${pid}`.nothrow().quiet();
        killed++;
      }
    }
  }
  
  console.log(`   ✅ Killed ${killed} processes on known ports\n`);
  
  // Clean databases
  console.log('4️⃣  Cleaning databases...');
  await $`rm -f apps/node-explorer/node-explorer.db`.nothrow().quiet();
  console.log('   ✅ Databases cleaned\n');
  
  // Kill orphaned bun dev processes
  console.log('5️⃣  Killing orphaned bun/node processes...');
  
  // Find processes running bun dev or npm dev
  const bunProcs = await $`pgrep -f "bun run dev|bun run scripts/dev|npm run dev|next dev"`.nothrow().quiet();
  if (bunProcs.exitCode === 0) {
    const pids = bunProcs.stdout.toString().trim().split('\n').filter(Boolean);
    let orphanedKilled = 0;
    for (const pid of pids) {
      // Don't kill the current process
      if (pid !== process.pid.toString()) {
        await $`kill -9 ${pid}`.nothrow().quiet();
        orphanedKilled++;
      }
    }
    console.log(`   ✅ Killed ${orphanedKilled} orphaned dev processes\n`);
  } else {
    console.log(`   ✅ No orphaned dev processes found\n`);
  }
  
  // Show remaining processes
  const remaining = await $`ps aux | grep -E "(bun|node)" | grep -v grep | wc -l`.text();
  console.log(`📊 Remaining node/bun processes: ${remaining.trim()}`);
  console.log('   (This includes system processes and is normal)\n');
  
  console.log('✅ Cleanup complete!');
  console.log('   You can now run: bun run dev\n');
}

if (import.meta.main) {
  main().catch(console.error);
}

