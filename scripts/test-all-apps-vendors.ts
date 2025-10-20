#!/usr/bin/env bun
/**
 * Master Test Runner for All Apps and Vendors
 * Runs all tests across the entire Jeju ecosystem
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

interface TestResult {
  app: string;
  passed: boolean;
  output: string;
  error?: string;
  duration: number;
}

const VENDORS = [
  "vendor/caliguland",
  "vendor/cloud",
  "vendor/hyperscape",
  "vendor/otc-desk",
];

const APPS = [
  "apps/bazaar",
  "apps/crucible",
  "apps/documentation",
  "apps/ehorse",
  "apps/gateway",
  "apps/indexer",
  "apps/ipfs",
  "apps/leaderboard",
  "apps/monitoring",
  "apps/predimarket",
];

const ALL_TARGETS = [...VENDORS, ...APPS];

async function runTests(target: string): Promise<TestResult> {
  const startTime = Date.now();
  const targetPath = join(process.cwd(), target);
  
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🧪 Testing: ${target}`);
  console.log(`${"=".repeat(80)}\n`);

  // Check if target exists
  if (!existsSync(targetPath)) {
    return {
      app: target,
      passed: false,
      output: "",
      error: "Directory does not exist",
      duration: Date.now() - startTime,
    };
  }

  // Check if package.json exists
  const packageJsonPath = join(targetPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {
      app: target,
      passed: false,
      output: "",
      error: "No package.json found",
      duration: Date.now() - startTime,
    };
  }

  try {
    // Read package.json to check for test script
    const packageJson = await Bun.file(packageJsonPath).json();
    
    if (!packageJson.scripts?.test) {
      return {
        app: target,
        passed: false,
        output: "",
        error: "No test script defined in package.json",
        duration: Date.now() - startTime,
      };
    }

    // Run the tests
    const result = await $`cd ${targetPath} && bun run test`.nothrow().quiet();
    
    const duration = Date.now() - startTime;
    const output = result.stdout.toString() + result.stderr.toString();
    
    // Check if tests passed
    const passed = result.exitCode === 0;
    
    console.log(output);
    
    if (passed) {
      console.log(`\n✅ ${target}: ALL TESTS PASSED (${duration}ms)`);
    } else {
      console.log(`\n❌ ${target}: TESTS FAILED (${duration}ms)`);
      console.log(`Exit code: ${result.exitCode}`);
    }

    return {
      app: target,
      passed,
      output,
      error: passed ? undefined : `Exit code: ${result.exitCode}`,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`\n❌ ${target}: ERROR RUNNING TESTS (${duration}ms)`);
    console.error(error);
    
    return {
      app: target,
      passed: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      duration,
    };
  }
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                     JEJU ECOSYSTEM TEST SUITE                              ║
║                    Testing All Apps and Vendors                            ║
╚════════════════════════════════════════════════════════════════════════════╝
  `);

  const allResults: TestResult[] = [];
  let totalDuration = 0;

  // Run tests for all targets
  for (const target of ALL_TARGETS) {
    const result = await runTests(target);
    allResults.push(result);
    totalDuration += result.duration;
  }

  // Print summary
  console.log(`\n\n${"=".repeat(80)}`);
  console.log(`TEST SUMMARY`);
  console.log(`${"=".repeat(80)}\n`);

  const passed = allResults.filter((r) => r.passed);
  const failed = allResults.filter((r) => !r.passed);
  const skipped = allResults.filter((r) => r.error && (
    r.error.includes("does not exist") || 
    r.error.includes("No package.json") ||
    r.error.includes("No test script")
  ));

  console.log(`Total Targets: ${ALL_TARGETS.length}`);
  console.log(`✅ Passed: ${passed.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  console.log(`⏭️  Skipped: ${skipped.length}`);
  console.log(`⏱️  Total Duration: ${(totalDuration / 1000).toFixed(2)}s\n`);

  // List passed apps
  if (passed.length > 0) {
    console.log(`\n✅ PASSED (${passed.length}):`);
    passed.forEach((r) => {
      console.log(`   • ${r.app} (${(r.duration / 1000).toFixed(2)}s)`);
    });
  }

  // List failed apps
  if (failed.length > 0) {
    console.log(`\n❌ FAILED (${failed.length}):`);
    failed.forEach((r) => {
      console.log(`   • ${r.app}`);
      if (r.error) console.log(`     Error: ${r.error}`);
    });
  }

  // List skipped apps
  if (skipped.length > 0) {
    console.log(`\n⏭️  SKIPPED (${skipped.length}):`);
    skipped.forEach((r) => {
      console.log(`   • ${r.app} - ${r.error}`);
    });
  }

  // Exit with error if any tests failed (excluding skipped)
  const actualFailures = failed.filter((r) => !skipped.includes(r));
  if (actualFailures.length > 0) {
    console.log(`\n❌ ${actualFailures.length} app(s) have failing tests. Fix them!`);
    process.exit(1);
  }

  console.log(`\n✅ All tests passed successfully!`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error running test suite:", error);
  process.exit(1);
});

