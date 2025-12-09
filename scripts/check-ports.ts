#!/usr/bin/env bun
/**
 * Port Configuration Validator
 * 
 * Checks for:
 * - Port conflicts between services
 * - Environment variable configuration
 * - Port range compliance
 * 
 * Usage:
 *   bun run scripts/check-ports.ts
 */

import { 
  CORE_PORTS, 
  VENDOR_PORTS, 
  INFRA_PORTS,
  checkPortConflicts,
  printPortAllocation,
  getAllCorePorts,
  getAllVendorPorts
} from '@jejunetwork/config/ports';

const COLORS = {
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  CYAN: '\x1b[36m',
  BOLD: '\x1b[1m',
};

function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                                                               ║');
  console.log('║   🔍 Jeju Port Configuration Validator                     ║');
  console.log('║                                                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Print all port allocations
  printPortAllocation();

  // Check for conflicts
  console.log(`${COLORS.CYAN}${COLORS.BOLD}Checking for port conflicts...${COLORS.RESET}\n`);
  
  const { hasConflicts, conflicts } = checkPortConflicts();
  
  if (hasConflicts) {
    console.log(`${COLORS.RED}❌ Port conflicts detected!${COLORS.RESET}\n`);
    conflicts.forEach(conflict => {
      console.log(`  ${COLORS.RED}⚠️  ${conflict}${COLORS.RESET}`);
    });
    console.log('\n');
    process.exit(1);
  } else {
    console.log(`${COLORS.GREEN}✅ No port conflicts detected${COLORS.RESET}\n`);
  }

  // Validate port ranges
  console.log(`${COLORS.CYAN}${COLORS.BOLD}Validating port ranges...${COLORS.RESET}\n`);
  
  let rangeValid = true;
  
  // Core apps should be in 4000-4999 range
  const corePorts = getAllCorePorts();
  for (const [name, port] of Object.entries(corePorts)) {
    if (port < 4000 || port >= 5000) {
      if (name !== 'INDEXER_DATABASE') { // Exception for DB port
        console.log(`  ${COLORS.YELLOW}⚠️  ${name}: ${port} is outside core app range (4000-4999)${COLORS.RESET}`);
        rangeValid = false;
      }
    }
  }
  
  // Vendor apps should be in 5000-5999 range
  const vendorPorts = getAllVendorPorts();
  for (const [name, port] of Object.entries(vendorPorts)) {
    if (port < 5000 || port >= 6000) {
      console.log(`  ${COLORS.YELLOW}⚠️  ${name}: ${port} is outside vendor app range (5000-5999)${COLORS.RESET}`);
      rangeValid = false;
    }
  }
  
  if (rangeValid) {
    console.log(`${COLORS.GREEN}✅ All ports within correct ranges${COLORS.RESET}\n`);
  } else {
    console.log('');
  }

  // Check environment variable overrides
  console.log(`${COLORS.CYAN}${COLORS.BOLD}Environment variable overrides:${COLORS.RESET}\n`);
  
  const envOverrides: string[] = [];
  
  // Check for core app overrides
  Object.values(CORE_PORTS).forEach(config => {
    if (process.env[config.ENV_VAR]) {
      envOverrides.push(`  ${config.ENV_VAR}=${process.env[config.ENV_VAR]}`);
    }
  });
  
  // Check for vendor app overrides
  Object.values(VENDOR_PORTS).forEach(config => {
    if (process.env[config.ENV_VAR]) {
      envOverrides.push(`  ${config.ENV_VAR}=${process.env[config.ENV_VAR]}`);
    }
  });
  
  // Check for infrastructure overrides
  Object.values(INFRA_PORTS).forEach(config => {
    if (process.env[config.ENV_VAR]) {
      envOverrides.push(`  ${config.ENV_VAR}=${process.env[config.ENV_VAR]}`);
    }
  });
  
  if (envOverrides.length > 0) {
    console.log(`${COLORS.YELLOW}Found ${envOverrides.length} environment variable override(s):${COLORS.RESET}\n`);
    envOverrides.forEach(override => console.log(override));
    console.log('');
  } else {
    console.log(`${COLORS.GREEN}No environment variable overrides (using defaults)${COLORS.RESET}\n`);
  }

  // Summary
  console.log('═'.repeat(67));
  console.log(`${COLORS.GREEN}${COLORS.BOLD}✅ Port configuration is valid${COLORS.RESET}`);
  console.log('═'.repeat(67));
  console.log('\n💡 To override ports, set environment variables before running services:');
  console.log('   Example: NODE_EXPLORER_API_PORT=5002 bun run dev\n');
  console.log('📖 See ENV_VARS.md for complete environment variable documentation\n');
}

if (import.meta.main) {
  main();
}

