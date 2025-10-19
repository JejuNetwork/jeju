#!/usr/bin/env bun
/**
 * @fileoverview Documentation and test coverage verification script
 * @module verify-documentation
 * 
 * Verifies that all code has proper documentation and tests.
 * Checks for:
 * - NatSpec in Solidity contracts
 * - JSDoc in TypeScript files
 * - README files in major directories
 * - Test files for all source files
 * - Test coverage metrics
 * 
 * @example Run verification
 * ```bash
 * bun run verify-documentation.ts
 * ```
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

interface VerificationResult {
  category: string;
  item: string;
  hasDocumentation: boolean;
  hasTests: boolean;
  details?: string;
}

const results: VerificationResult[] = [];

const COLORS = {
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  BLUE: '\x1b[34m',
  RESET: '\x1b[0m',
} as const;

/**
 * Check if a Solidity contract has NatSpec documentation
 */
function hasNatSpec(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  
  // Check for essential NatSpec tags
  const hasTitle = content.includes('@title');
  const hasNotice = content.includes('@notice');
  const hasAuthor = content.includes('@author');
  
  return hasTitle && hasNotice && (hasAuthor || content.includes('// SPDX'));
}

/**
 * Check if a TypeScript file has JSDoc documentation
 */
function hasJSDoc(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  
  // Check for JSDoc block comments
  const hasFileOverview = content.includes('@fileoverview') || content.includes('@module');
  const hasFunctionDocs = content.includes('/**') && content.includes('*/');
  
  // Exempt test files from JSDoc requirements
  if (filePath.includes('.test.ts') || filePath.includes('__tests__')) {
    return true;
  }
  
  return hasFileOverview || hasFunctionDocs;
}

/**
 * Check if a source file has corresponding tests
 */
function hasTestFile(sourceFile: string, _category: string): boolean {
  // Contract tests
  if (sourceFile.endsWith('.sol') && !sourceFile.includes('/test/')) {
    const contractName = sourceFile.split('/').pop()!.replace('.sol', '');
    const testFile = sourceFile.replace('/src/', '/test/').replace('.sol', '.t.sol');
    
    try {
      statSync(testFile);
      return true;
    } catch {
      // Check for integration tests
      const integrationTest = join('contracts', 'test', 'LiquiditySystem.integration.t.sol');
      try {
        const content = readFileSync(integrationTest, 'utf-8');
        return content.includes(contractName);
      } catch {
        return false;
      }
    }
  }
  
  // TypeScript tests
  if (sourceFile.endsWith('.ts') && !sourceFile.includes('.test.ts')) {
    const testFile = sourceFile.replace('.ts', '.test.ts');
    
    try {
      statSync(testFile);
      return true;
    } catch {
      return false;
    }
  }
  
  return true; // Default to true for other file types
}

/**
 * Verify Solidity contracts
 */
function verifyContracts() {
  console.log('\n📄 Verifying Smart Contracts...\n');
  
  const contractsDir = 'contracts/src';
  const files = getAllFiles(contractsDir, '.sol');
  
  for (const file of files) {
    const hasDoc = hasNatSpec(file);
    const hasTest = hasTestFile(file, 'contracts');
    
    results.push({
      category: 'Smart Contracts',
      item: file.replace('contracts/src/', ''),
      hasDocumentation: hasDoc,
      hasTests: hasTest,
    });
    
    const docIcon = hasDoc ? '✅' : '❌';
    const testIcon = hasTest ? '✅' : '❌';
    const fileName = file.split('/').pop();
    
    console.log(`   ${docIcon} ${testIcon} ${fileName}`);
  }
}

/**
 * Verify TypeScript modules
 */
function verifyTypeScript() {
  console.log('\n📄 Verifying TypeScript Modules...\n');
  
  const dirs = [
    'config',
    'scripts/shared',
    'apps/indexer/src',
  ];
  
  for (const dir of dirs) {
    const files = getAllFiles(dir, '.ts', true);
    
    for (const file of files) {
      if (file.includes('.test.ts') || file.includes('__tests__')) continue;
      if (file.includes('node_modules')) continue;
      if (file.includes('.d.ts')) continue;
      
      const hasDoc = hasJSDoc(file);
      const hasTest = hasTestFile(file, 'typescript');
      
      results.push({
        category: 'TypeScript',
        item: file,
        hasDocumentation: hasDoc,
        hasTests: hasTest,
      });
      
      const docIcon = hasDoc ? '✅' : '❌';
      const testIcon = hasTest ? '✅' : '⏭️ ';
      const fileName = file.split('/').slice(-2).join('/');
      
      console.log(`   ${docIcon} ${testIcon} ${fileName}`);
    }
  }
}

/**
 * Verify README files exist
 */
function verifyREADMEs() {
  console.log('\n📚 Verifying README Files...\n');
  
  const expectedREADMEs = [
    'README.md',
    'config/README.md',
    'contracts/README.md',
    'apps/documentation/README.md',
    'apps/indexer/README.md',
    'kubernetes/helm/README.md',
    'kurtosis/README.md',
    'apps/node-explorer/README.md',
    'TESTING.md',
    'DOCUMENTATION_SUMMARY.md',
  ];
  
  for (const readme of expectedREADMEs) {
    try {
      statSync(readme);
      console.log(`   ✅ ${readme}`);
      
      results.push({
        category: 'Documentation',
        item: readme,
        hasDocumentation: true,
        hasTests: true, // READMEs don't need tests
      });
    } catch {
      console.log(`   ❌ ${readme} - MISSING`);
      
      results.push({
        category: 'Documentation',
        item: readme,
        hasDocumentation: false,
        hasTests: false,
      });
    }
  }
}

/**
 * Print summary report
 */
function printSummary() {
  console.log('\n' + '═'.repeat(70));
  console.log(`${COLORS.BLUE}DOCUMENTATION & TEST COVERAGE SUMMARY${COLORS.RESET}`);
  console.log('═'.repeat(70) + '\n');
  
  const byCategory: Record<string, VerificationResult[]> = {};
  
  for (const result of results) {
    if (!byCategory[result.category]) {
      byCategory[result.category] = [];
    }
    byCategory[result.category].push(result);
  }
  
  for (const [category, items] of Object.entries(byCategory)) {
    const documented = items.filter(i => i.hasDocumentation).length;
    const tested = items.filter(i => i.hasTests).length;
    const total = items.length;
    
    const docPercent = ((documented / total) * 100).toFixed(1);
    const testPercent = ((tested / total) * 100).toFixed(1);
    
    const docColor = documented === total ? COLORS.GREEN : documented > total * 0.9 ? COLORS.YELLOW : COLORS.RED;
    const testColor = tested === total ? COLORS.GREEN : tested > total * 0.8 ? COLORS.YELLOW : COLORS.RED;
    
    console.log(`${category}:`);
    console.log(`   Documentation: ${docColor}${documented}/${total} (${docPercent}%)${COLORS.RESET}`);
    console.log(`   Tests:         ${testColor}${tested}/${total} (${testPercent}%)${COLORS.RESET}`);
    console.log('');
  }
  
  const totalItems = results.length;
  const totalDocumented = results.filter(r => r.hasDocumentation).length;
  const totalTested = results.filter(r => r.hasTests).length;
  
  console.log('─'.repeat(70));
  console.log(`${COLORS.GREEN}Overall:${COLORS.RESET}`);
  console.log(`   Files Checked:  ${totalItems}`);
  console.log(`   Documented:     ${totalDocumented}/${totalItems} (${((totalDocumented / totalItems) * 100).toFixed(1)}%)`);
  console.log(`   Tested:         ${totalTested}/${totalItems} (${((totalTested / totalItems) * 100).toFixed(1)}%)`);
  console.log('─'.repeat(70) + '\n');
  
  const missingDocs = results.filter(r => !r.hasDocumentation);
  const missingTests = results.filter(r => !r.hasTests);
  
  if (missingDocs.length > 0) {
    console.log(`${COLORS.YELLOW}⚠️  Files missing documentation (${missingDocs.length}):${COLORS.RESET}`);
    for (const item of missingDocs.slice(0, 10)) {
      console.log(`   - ${item.item}`);
    }
    if (missingDocs.length > 10) {
      console.log(`   ... and ${missingDocs.length - 10} more`);
    }
    console.log('');
  }
  
  if (missingTests.length > 0) {
    console.log(`${COLORS.YELLOW}⚠️  Files missing tests (${missingTests.length}):${COLORS.RESET}`);
    for (const item of missingTests.slice(0, 10)) {
      console.log(`   - ${item.item}`);
    }
    if (missingTests.length > 10) {
      console.log(`   ... and ${missingTests.length - 10} more`);
    }
    console.log('');
  }
  
  // Overall assessment
  const docCoverage = (totalDocumented / totalItems) * 100;
  const testCoverage = (totalTested / totalItems) * 100;
  
  if (docCoverage >= 95 && testCoverage >= 90) {
    console.log(`${COLORS.GREEN}✅ EXCELLENT COVERAGE!${COLORS.RESET}`);
    console.log('   Documentation and testing standards exceeded.\n');
    process.exit(0);
  } else if (docCoverage >= 80 && testCoverage >= 80) {
    console.log(`${COLORS.YELLOW}✅ GOOD COVERAGE${COLORS.RESET}`);
    console.log('   Documentation and testing meet minimum standards.\n');
    process.exit(0);
  } else {
    console.log(`${COLORS.RED}⚠️  INSUFFICIENT COVERAGE${COLORS.RESET}`);
    console.log('   More documentation or tests needed.\n');
    process.exit(1);
  }
}

/**
 * Get all files with specific extension recursively
 */
function getAllFiles(dir: string, ext: string, shallow: boolean = false): string[] {
  const files: string[] = [];
  
  try {
    const items = readdirSync(dir);
    
    for (const item of items) {
      const fullPath = join(dir, item);
      
      try {
        const stat = statSync(fullPath);
        
        if (stat.isDirectory() && !shallow) {
          // Skip node_modules and hidden directories
          if (!item.startsWith('.') && item !== 'node_modules' && item !== 'lib') {
            files.push(...getAllFiles(fullPath, ext, shallow));
          }
        } else if (stat.isFile() && fullPath.endsWith(ext)) {
          files.push(fullPath);
        }
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    // Directory doesn't exist
  }
  
  return files;
}

/**
 * Main verification runner
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                  ║');
  console.log('║        DOCUMENTATION & TEST COVERAGE VERIFICATION                ║');
  console.log('║                                                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  
  verifyContracts();
  verifyTypeScript();
  verifyREADMEs();
  printSummary();
}

// Run verification
main().catch((error) => {
  console.error('❌ Verification failed:', error);
  process.exit(1);
});

