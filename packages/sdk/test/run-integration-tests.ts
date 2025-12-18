#!/usr/bin/env bun
/**
 * SDK Integration Test Runner
 *
 * This script orchestrates the full integration test suite for the Jeju SDK.
 * It ensures the local environment is properly set up before running tests.
 *
 * Usage:
 *   bun test/run-integration-tests.ts [--setup] [--module <name>]
 *
 * Options:
 *   --setup     Start localnet and deploy contracts before tests
 *   --module    Run tests for a specific module only
 *
 * Prerequisites:
 *   Either run with --setup or manually start:
 *   - anvil --port 9545
 *   - Deploy contracts: cd packages/contracts && forge script deploy/Deploy.s.sol
 */

import { spawn, spawnSync } from "bun";
import { existsSync } from "fs";
import { join } from "path";

const MODULES = [
  "full-sdk",
  "federation",
  "staking",
  "dws",
  "moderation",
  "perps",
  "amm",
  "agents",
  "bridge",
  "oracle",
  "sequencer",
  "cdn",
  "vpn",
  "otc",
  "messaging",
  "distributor",
  "training",
];

interface TestResult {
  module: string;
  passed: boolean;
  duration: number;
  error?: string;
}

async function checkChain(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:9545", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 }),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function startLocalnet(): Promise<void> {
  console.log("Starting localnet (anvil)...");

  const homeDir = process.env.HOME || "/home/" + process.env.USER;
  const foundryBin = join(homeDir, ".foundry/bin");
  const path = `${foundryBin}:${process.env.PATH}`;

  const proc = spawn(["anvil", "--port", "9545", "--chain-id", "1337", "--accounts", "10", "--balance", "10000"], {
    env: { ...process.env, PATH: path },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for chain to be ready
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (await checkChain()) {
      console.log("✓ Localnet started");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error("Failed to start localnet");
}

async function deployContracts(): Promise<void> {
  console.log("Deploying contracts...");

  const contractsDir = join(process.cwd(), "../contracts");
  const deployScript = join(contractsDir, "deploy/Deploy.s.sol");

  if (!existsSync(deployScript)) {
    console.log("⚠ Deploy script not found, skipping");
    return;
  }

  const homeDir = process.env.HOME || "/home/" + process.env.USER;
  const foundryBin = join(homeDir, ".foundry/bin");
  const path = `${foundryBin}:${process.env.PATH}`;

  const result = spawnSync(
    [
      "forge",
      "script",
      "deploy/Deploy.s.sol:DeployAll",
      "--rpc-url",
      "http://127.0.0.1:9545",
      "--private-key",
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      "--broadcast",
    ],
    {
      cwd: contractsDir,
      env: { ...process.env, PATH: path },
    }
  );

  if (result.exitCode === 0) {
    console.log("✓ Contracts deployed");
  } else {
    console.log("⚠ Contract deployment may have failed (contracts might already exist)");
  }
}

async function runTests(module?: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const modulesToTest = module ? [module] : MODULES;

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Running Integration Tests");
  console.log("═══════════════════════════════════════════════════════\n");

  for (const mod of modulesToTest) {
    const testFile = join(process.cwd(), `test/integration/${mod}.integration.test.ts`);

    if (!existsSync(testFile)) {
      console.log(`⚠ Test file not found: ${mod}.integration.test.ts`);
      continue;
    }

    console.log(`\n▶ Running ${mod} tests...`);
    const start = Date.now();

    const result = spawnSync(["bun", "test", testFile], {
      cwd: process.cwd(),
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    });

    const duration = Date.now() - start;
    const passed = result.exitCode === 0;

    results.push({
      module: mod,
      passed,
      duration,
      error: passed ? undefined : `Exit code: ${result.exitCode}`,
    });
  }

  return results;
}

function printSummary(results: TestResult[]): void {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Test Summary");
  console.log("═══════════════════════════════════════════════════════\n");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  for (const result of results) {
    const status = result.passed ? "✓" : "✗";
    const color = result.passed ? "\x1b[32m" : "\x1b[31m";
    console.log(`  ${color}${status}\x1b[0m ${result.module} (${result.duration}ms)`);
    if (result.error) {
      console.log(`    Error: ${result.error}`);
    }
  }

  console.log("\n───────────────────────────────────────────────────────");
  console.log(`  Passed: ${passed}  Failed: ${failed}  Total: ${results.length}`);
  console.log("───────────────────────────────────────────────────────\n");

  if (failed > 0) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shouldSetup = args.includes("--setup");
  const moduleIndex = args.indexOf("--module");
  const module = moduleIndex >= 0 ? args[moduleIndex + 1] : undefined;

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  JEJU SDK Integration Test Runner");
  console.log("═══════════════════════════════════════════════════════\n");

  // Check if chain is running
  const chainRunning = await checkChain();

  if (!chainRunning) {
    if (shouldSetup) {
      await startLocalnet();
      await deployContracts();
    } else {
      console.log("⚠ Chain not running at http://127.0.0.1:9545");
      console.log("  Start with: anvil --port 9545");
      console.log("  Or run with: --setup flag");
      process.exit(1);
    }
  } else {
    console.log("✓ Chain running at http://127.0.0.1:9545");
  }

  // Run tests
  const results = await runTests(module);
  printSummary(results);
}

main().catch((error) => {
  console.error("Test runner failed:", error);
  process.exit(1);
});
