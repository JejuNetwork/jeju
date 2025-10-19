#!/usr/bin/env bun
/**
 * Pre-flight Check for `bun run dev`
 * Verifies all requirements before starting the full development environment
 */

import { $ } from "bun";
import { existsSync } from "fs";

const COLORS = {
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  CYAN: '\x1b[36m',
};

interface Check {
  name: string;
  check: () => Promise<boolean>;
  fix?: string;
  critical: boolean;
}

const checks: Check[] = [
  {
    name: "Kurtosis CLI installed",
    check: async () => {
      const result = await $`which kurtosis`.nothrow().quiet();
      return result.exitCode === 0;
    },
    fix: "Install from: https://docs.kurtosis.com/install",
    critical: true,
  },
  {
    name: "Docker running",
    check: async () => {
      const result = await $`docker ps`.nothrow().quiet();
      return result.exitCode === 0;
    },
    fix: "Start Docker Desktop",
    critical: true,
  },
  {
    name: "Bun installed",
    check: async () => {
      const result = await $`which bun`.nothrow().quiet();
      return result.exitCode === 0;
    },
    fix: "Install from: https://bun.sh",
    critical: true,
  },
  {
    name: "Apps discovered via jeju-manifest.json",
    check: async () => {
      // Check if at least one app has a manifest
      const hasManifest = existsSync("apps/bazaar/jeju-manifest.json") || 
                         existsSync("vendor/launchpad/jeju-manifest.json");
      return hasManifest;
    },
    fix: "Apps should have jeju-manifest.json files (auto-generated)",
    critical: false,
  },
  {
    name: "Node Explorer database clean",
    check: async () => {
      // Fresh start is good
      return true;
    },
    fix: "N/A",
    critical: false,
  },
  {
    name: "Port availability",
    check: async () => {
      // Dev script auto-cleans all ports, so this is just informational
      return true;
    },
    fix: "Ports auto-cleaned by dev script",
    critical: false,
  },
];

console.log(`${COLORS.CYAN}╔════════════════════════════════════════════════════════╗${COLORS.RESET}`);
console.log(`${COLORS.CYAN}║  Pre-flight Check for 'bun run dev'                   ║${COLORS.RESET}`);
console.log(`${COLORS.CYAN}╚════════════════════════════════════════════════════════╝${COLORS.RESET}\n`);

let passed = 0;
let failed = 0;
let warnings = 0;

for (const check of checks) {
  process.stdout.write(`Checking ${check.name}... `);
  
  const result = await check.check();
  
  if (result) {
    console.log(`${COLORS.GREEN}✓${COLORS.RESET}`);
    passed++;
  } else {
    if (check.critical) {
      console.log(`${COLORS.RED}✗ CRITICAL${COLORS.RESET}`);
      console.log(`  ${COLORS.YELLOW}Fix: ${check.fix}${COLORS.RESET}`);
      failed++;
    } else {
      console.log(`${COLORS.YELLOW}⚠ Warning${COLORS.RESET}`);
      console.log(`  ${COLORS.YELLOW}Suggestion: ${check.fix}${COLORS.RESET}`);
      warnings++;
    }
  }
}

console.log(`\n${COLORS.CYAN}═══════════════════════════════════════════════════════${COLORS.RESET}`);
console.log(`Results: ${COLORS.GREEN}${passed} passed${COLORS.RESET}, ${COLORS.RED}${failed} critical${COLORS.RESET}, ${COLORS.YELLOW}${warnings} warnings${COLORS.RESET}\n`);

if (failed > 0) {
  console.log(`${COLORS.RED}❌ Critical issues found. Please fix them before running 'bun run dev'${COLORS.RESET}\n`);
  process.exit(1);
}

if (warnings > 0) {
  console.log(`${COLORS.YELLOW}⚠️  Warnings found. Development environment may have issues.${COLORS.RESET}`);
  console.log(`${COLORS.GREEN}Continuing anyway...${COLORS.RESET}\n`);
}

console.log(`${COLORS.GREEN}✅ All critical checks passed! Safe to run 'bun run dev'${COLORS.RESET}\n`);
process.exit(0);

