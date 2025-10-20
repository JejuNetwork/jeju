#!/usr/bin/env bun
/**
 * Build Script
 * 
 * Builds all components of the Jeju stack:
 * - Smart contracts (Foundry)
 * - TypeScript packages
 * - Indexer
 * - Node Explorer
 * - Documentation
 * 
 * Usage:
 *   bun run build
 */

import { $ } from "bun";

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🔨 JEJU BUILD                                        ║
║   Building all components                                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

let failed = false;

// Step 1: Build Smart Contracts
console.log("1️⃣  Building Smart Contracts (Foundry)...\n");
const contractsResult = await $`cd contracts && forge build`.nothrow();

if (contractsResult.exitCode !== 0) {
  console.error("❌ Contracts build failed\n");
  failed = true;
} else {
  console.log("✅ Contracts built successfully\n");
}

// Step 2: TypeScript Type Check
console.log("2️⃣  TypeScript Type Checking...\n");
const typecheckResult = await $`tsc --noEmit`.nothrow();

if (typecheckResult.exitCode !== 0) {
  console.error("❌ TypeScript type check failed\n");
  failed = true;
} else {
  console.log("✅ TypeScript type check passed\n");
}

// Step 3: Build Indexer
console.log("3️⃣  Building Indexer (Subsquid)...\n");
const indexerResult = await $`cd apps/indexer && npm run build`.nothrow();

if (indexerResult.exitCode !== 0) {
  console.warn("⚠️  Indexer build failed (continuing)\n");
} else {
  console.log("✅ Indexer built successfully\n");
}

// Step 4: Build Node Explorer
console.log("4️⃣  Building Node Explorer...\n");
const explorerResult = await $`cd apps/node-explorer && bun run build`.nothrow();

if (explorerResult.exitCode !== 0) {
  console.warn("⚠️  Node Explorer build failed (continuing)\n");
} else {
  console.log("✅ Node Explorer built successfully\n");
}

// Step 5: Build Documentation
console.log("5️⃣  Building Documentation (VitePress)...\n");
const docsResult = await $`vitepress build apps/documentation`.nothrow();

if (docsResult.exitCode !== 0) {
  console.warn("⚠️  Documentation build failed (continuing)\n");
} else {
  console.log("✅ Documentation built successfully\n");
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

if (failed) {
  console.log("❌ Build failed\n");
  console.log("💡 Fix errors and run: bun run build\n");
  process.exit(1);
} else {
  console.log("✅ Build complete!\n");
  console.log("💡 Next:");
  console.log("   bun run test     # Run all tests");
  console.log("   bun run dev      # Start development");
  console.log("");
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");


