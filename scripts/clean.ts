#!/usr/bin/env bun
/**
 * Clean Script
 * 
 * Cleans all build artifacts and stops running services:
 * - Stops localnet (Kurtosis)
 * - Removes build artifacts
 * - Cleans Docker resources
 * - Removes temporary files
 * 
 * Usage:
 *   bun run clean              # Clean build artifacts
 *   bun run clean --deep       # Deep clean (includes Docker)
 */

import { $ } from "bun";
import { rmSync, existsSync } from "fs";

const deepClean = process.argv.includes("--deep");

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🧹 JEJU CLEANUP ${deepClean ? '(DEEP)' : '       '}                          ║
║   Cleaning build artifacts                                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// Step 1: Stop localnet
console.log("1️⃣  Stopping Localnet...");
const stopResult = await $`bun run scripts/localnet/stop.ts`.nothrow();
if (stopResult.exitCode === 0) {
  console.log("   ✅ Localnet stopped\n");
} else {
  console.log("   ℹ️  No localnet running\n");
}

// Step 2: Clean build artifacts
console.log("2️⃣  Removing Build Artifacts...");

const pathsToClean = [
  "contracts/out",
  "contracts/cache",
  "apps/indexer/lib",
  "apps/indexer/.sqd",
  "apps/node-explorer/dist",
  "apps/node-explorer/.next",
  "apps/documentation/.vitepress/dist",
  "apps/documentation/.vitepress/cache",
  ".cache",
  "dist",
];

let cleaned = 0;
for (const path of pathsToClean) {
  if (existsSync(path)) {
    try {
      rmSync(path, { recursive: true, force: true });
      console.log(`   🗑️  Removed ${path}`);
      cleaned++;
    } catch (e) {
      console.log(`   ⚠️  Failed to remove ${path}`);
    }
  }
}

console.log(`   ✅ Cleaned ${cleaned} directories\n`);

// Step 3: Clean node_modules (optional)
if (deepClean) {
  console.log("3️⃣  Removing node_modules...");
  
  const nodeModulesPaths = [
    "node_modules",
    "apps/indexer/node_modules",
    "apps/node-explorer/node_modules",
  ];
  
  let cleanedModules = 0;
  for (const path of nodeModulesPaths) {
    if (existsSync(path)) {
      try {
        console.log(`   🗑️  Removing ${path}...`);
        rmSync(path, { recursive: true, force: true });
        cleanedModules++;
      } catch (e) {
        console.log(`   ⚠️  Failed to remove ${path}`);
      }
    }
  }
  
  console.log(`   ✅ Cleaned ${cleanedModules} node_modules directories\n`);
}

// Step 4: Clean Docker (optional)
if (deepClean) {
  console.log("4️⃣  Cleaning Docker Resources...");
  
  await $`docker system prune -f`.nothrow();
  
  console.log("   ✅ Docker resources cleaned\n");
}

// Step 5: Clean logs
console.log(`${deepClean ? '5️⃣' : '3️⃣'}  Removing Log Files...`);

const logPaths = [
  "logs",
  "*.log",
];

let cleanedLogs = 0;
for (const path of logPaths) {
  if (existsSync(path)) {
    try {
      rmSync(path, { recursive: true, force: true });
      console.log(`   🗑️  Removed ${path}`);
      cleanedLogs++;
    } catch (e) {
      console.log(`   ⚠️  Failed to remove ${path}`);
    }
  }
}

console.log(`   ✅ Cleaned ${cleanedLogs} log directories\n`);

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log("✅ Cleanup complete!\n");

if (deepClean) {
  console.log("💡 Next: bun install");
  console.log("");
}

console.log("💡 Next: bun run build");
console.log("");

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");


