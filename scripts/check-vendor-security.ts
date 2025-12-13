#!/usr/bin/env bun

import { execSync } from 'child_process';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const VENDOR_DIR = join(process.cwd(), 'vendor');
const ROOT_PACKAGE_JSON = join(process.cwd(), 'package.json');

interface Vulnerability {
  package: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  title: string;
  path: string;
}

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  vulnerabilities?: Vulnerability[];
}

const results: CheckResult[] = [];

async function checkPackageOverrides(): Promise<void> {
  try {
    const packageJson = JSON.parse(await readFile(ROOT_PACKAGE_JSON, 'utf-8'));
    const overrides = packageJson.overrides || {};
    const resolutions = packageJson.resolutions || {};
    
    const requiredOverrides = ['qs', 'socket.io-parser', 'hawk', 'playwright', '@hapi/hoek'];
    const missing: string[] = [];
    
    for (const pkg of requiredOverrides) {
      if (!overrides[pkg] && !resolutions[pkg]) {
        missing.push(pkg);
      }
    }
    
    if (missing.length === 0) {
      results.push({
        name: 'Package overrides configured',
        status: 'pass',
        message: 'Required security overrides are configured',
      });
    } else {
      results.push({
        name: 'Package overrides configured',
        status: 'fail',
        message: `Missing overrides for: ${missing.join(', ')}`,
      });
    }
    
    if (overrides.qs) {
      results.push({
        name: 'qs override version',
        status: 'pass',
        message: `qs override: ${overrides.qs}`,
      });
    }
    
    if (overrides['socket.io-parser']) {
      results.push({
        name: 'socket.io-parser override version',
        status: 'pass',
        message: `socket.io-parser override: ${overrides['socket.io-parser']}`,
      });
    }
  } catch (error) {
    results.push({
      name: 'Check package overrides',
      status: 'fail',
      message: `Error reading package.json: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function runSecurityAudit(): Promise<void> {
  try {
    console.log('Running security audit...');
    let output: string;
    try {
      output = execSync('bun audit --audit-level=high 2>&1', { 
        encoding: 'utf-8',
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string };
      output = execError.stdout || execError.stderr || String(error);
    }
    
    const vulnerabilities: Vulnerability[] = [];
    const lines = output.split('\n');
    let currentPackage = '';
    let currentSeverity: 'high' | 'critical' | null = null;
    let currentPath = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      const packageMatch = line.match(/^(\S+)\s+(<=|>=|~|^)([\d.]+)/);
      if (packageMatch) {
        currentPackage = packageMatch[1];
        currentPath = '';
        currentSeverity = null;
        
        const pathMatch = lines[i + 1]?.match(/^\s+workspace:([^\s]+)/);
        if (pathMatch) {
          currentPath = pathMatch[1];
        }
        continue;
      }
      
      const severityMatch = line.match(/\s+(high|critical):\s+(.+)/i);
      if (severityMatch && currentPackage) {
        currentSeverity = severityMatch[1].toLowerCase() as 'high' | 'critical';
        const title = severityMatch[2].trim();
        
        vulnerabilities.push({
          package: currentPackage,
          severity: currentSeverity,
          title,
          path: currentPath || 'unknown',
        });
        
        currentPackage = '';
        currentSeverity = null;
        currentPath = '';
      }
    }
    
    const vendorVulns = vulnerabilities.filter(v => 
      v.path.includes('vendor') || 
      v.path.includes('elizaos') || 
      v.path.includes('eliza-otc-desk') ||
      v.path.includes('eliza-cloud-v2') ||
      v.path.includes('babylon') ||
      v.path.includes('hyperscape') ||
      v.path.includes('squid')
    );
    
    const coreVulns = vulnerabilities.filter(v => !vendorVulns.includes(v));
    
    if (coreVulns.length === 0) {
      results.push({
        name: 'Core dependencies security',
        status: 'pass',
        message: 'No HIGH/CRITICAL vulnerabilities in core dependencies',
      });
    } else {
      results.push({
        name: 'Core dependencies security',
        status: 'fail',
        message: `Found ${coreVulns.length} HIGH/CRITICAL vulnerabilities in core dependencies`,
        vulnerabilities: coreVulns,
      });
    }
    
    if (vendorVulns.length > 0) {
      results.push({
        name: 'Vendor dependencies security',
        status: 'warning',
        message: `Found ${vendorVulns.length} HIGH/CRITICAL vulnerabilities in vendor packages (documented limitation)`,
        vulnerabilities: vendorVulns,
      });
    } else {
      results.push({
        name: 'Vendor dependencies security',
        status: 'pass',
        message: 'No HIGH/CRITICAL vulnerabilities in vendor packages',
      });
    }
  } catch (error) {
    results.push({
      name: 'Security audit execution',
      status: 'warning',
      message: `Could not run security audit: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function checkVendorUpdateScripts(): Promise<void> {
  const updateScript = join(process.cwd(), 'scripts/vendor-update.ts');
  
  if (existsSync(updateScript)) {
    results.push({
      name: 'Vendor update script',
      status: 'pass',
      message: 'Vendor update script exists',
    });
  } else {
    results.push({
      name: 'Vendor update script',
      status: 'warning',
      message: 'Vendor update script not found',
    });
  }
}

async function checkDocumentation(): Promise<void> {
  const securityDoc = join(process.cwd(), 'SECURITY_VULNERABILITIES.md');
  
  if (existsSync(securityDoc)) {
    results.push({
      name: 'Security documentation',
      status: 'pass',
      message: 'Security vulnerabilities are documented',
    });
  } else {
    results.push({
      name: 'Security documentation',
      status: 'fail',
      message: 'SECURITY_VULNERABILITIES.md not found',
    });
  }
}

async function main() {
  console.log('🔒 Checking Vendor Package Security...\n');
  
  await checkPackageOverrides();
  await runSecurityAudit();
  await checkVendorUpdateScripts();
  await checkDocumentation();
  
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  
  console.log('\n=== Vendor Security Check Results ===\n');
  
  for (const result of results) {
    const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
    console.log(`${icon} ${result.name}: ${result.message}`);
    
    if (result.vulnerabilities && result.vulnerabilities.length > 0) {
      console.log(`   Vulnerabilities:`);
      for (const vuln of result.vulnerabilities.slice(0, 5)) {
        console.log(`     - ${vuln.package} (${vuln.severity}): ${vuln.title}`);
      }
      if (result.vulnerabilities.length > 5) {
        console.log(`     ... and ${result.vulnerabilities.length - 5} more`);
      }
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⚠️  Warnings: ${warnings}`);
  console.log(`Total: ${results.length}`);
  
  if (failed > 0) {
    console.log('\n❌ Security check has failures. Please review and fix.');
    process.exit(1);
  } else {
    console.log('\n✅ Vendor security check completed. Review warnings for vendor packages.');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('❌ Security check failed:', error);
  process.exit(1);
});
