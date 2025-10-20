#!/usr/bin/env bun
/**
 * Validate All Jeju Manifests
 * 
 * Checks that all jeju-manifest.json files are valid according to the schema
 * 
 * Usage: bun run scripts/validate-manifests.ts
 */

import { discoverAllApps } from './shared/discover-apps';
import { readFileSync } from 'fs';
import { join } from 'path';

const COLORS = {
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  CYAN: '\x1b[36m',
};

function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║              📋 Jeju Manifest Validation                    ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const apps = discoverAllApps();

  if (apps.length === 0) {
    console.log(`${COLORS.YELLOW}⚠️  No apps with manifests found${COLORS.RESET}\n`);
    process.exit(0);
  }

  console.log(`${COLORS.CYAN}Found ${apps.length} app(s) with jeju-manifest.json${COLORS.RESET}\n`);

  let valid = 0;
  let invalid = 0;
  let warnings = 0;

  for (const app of apps) {
    const manifestPath = join(app.path, 'jeju-manifest.json');
    
    console.log(`\n${COLORS.CYAN}Validating ${app.type}/${app.name}...${COLORS.RESET}`);

    // Check required fields
    const errors: string[] = [];
    const warns: string[] = [];

    // Validate type matches location
    if (app.type === 'core' && !app.path.includes('/apps/')) {
      errors.push(`Type is "core" but app is not in apps/ directory`);
    }
    if (app.type === 'vendor' && !app.path.includes('/vendor/')) {
      errors.push(`Type is "vendor" but app is not in vendor/ directory`);
    }

    // Validate has dev command
    if (!app.manifest.commands?.dev) {
      warns.push('No dev command defined');
    }

    // Validate has at least one port
    if (!app.manifest.ports || Object.keys(app.manifest.ports).length === 0) {
      warns.push('No ports defined');
    }

    // Validate port ranges
    if (app.manifest.ports) {
      for (const [portName, portNum] of Object.entries(app.manifest.ports)) {
        if (app.type === 'core' && (portNum < 4000 || portNum >= 5000)) {
          warns.push(`Port ${portName}:${portNum} outside core app range (4000-4999)`);
        }
        if (app.type === 'vendor' && (portNum < 5000 || portNum >= 6000)) {
          warns.push(`Port ${portName}:${portNum} outside vendor app range (5000-5999)`);
        }
      }
    }

    // Check package.json exists
    if (!app.exists) {
      warns.push('package.json not found - app may not be installed');
    }

    // Print results
    if (errors.length > 0) {
      console.log(`  ${COLORS.RED}❌ INVALID${COLORS.RESET}`);
      for (const error of errors) {
        console.log(`    ${COLORS.RED}• ${error}${COLORS.RESET}`);
      }
      invalid++;
    } else if (warns.length > 0) {
      console.log(`  ${COLORS.YELLOW}⚠️  VALID (with warnings)${COLORS.RESET}`);
      for (const warn of warns) {
        console.log(`    ${COLORS.YELLOW}• ${warn}${COLORS.RESET}`);
      }
      warnings++;
      valid++;
    } else {
      console.log(`  ${COLORS.GREEN}✅ VALID${COLORS.RESET}`);
      valid++;
    }

    // Show manifest details
    console.log(`    Type: ${app.manifest.type}`);
    console.log(`    Version: ${app.manifest.version}`);
    console.log(`    Enabled: ${app.manifest.enabled}`);
    console.log(`    Auto-start: ${app.manifest.autoStart !== false}`);
    if (app.manifest.ports) {
      console.log(`    Ports: ${Object.entries(app.manifest.ports).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`  Total: ${apps.length}`);
  console.log(`  ${COLORS.GREEN}Valid: ${valid}${COLORS.RESET}`);
  console.log(`  ${COLORS.YELLOW}Warnings: ${warnings}${COLORS.RESET}`);
  console.log(`  ${COLORS.RED}Invalid: ${invalid}${COLORS.RESET}`);
  console.log('');

  if (invalid > 0) {
    console.log(`${COLORS.RED}❌ Some manifests are invalid!${COLORS.RESET}`);
    console.log(`   Fix errors and run: bun run scripts/validate-manifests.ts\n`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`${COLORS.YELLOW}⚠️  All manifests valid but some have warnings${COLORS.RESET}`);
    console.log(`   Review warnings above\n`);
    process.exit(0);
  } else {
    console.log(`${COLORS.GREEN}✅ All manifests valid!${COLORS.RESET}\n`);
    process.exit(0);
  }
}

main();

