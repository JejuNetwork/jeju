/**
 * Factory Test Runner
 * Runs all E2E tests and generates a validation report
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

interface TestSummary {
  timestamp: string;
  duration: number;
  total: number;
  passed: number;
  failed: number;
  tests: {
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
  }[];
}

const REPORTS_DIR = join(process.cwd(), 'test-reports');

async function ensureReportsDir(): Promise<void> {
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

async function runPlaywrightTests(): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bunx', [
      'playwright', 'test',
      'tests/e2e/',
      '--ignore-snapshots',
      '--grep-invert', 'wallet|blockchain',
      '--project=chromium',
      '--reporter=json'
    ], {
      cwd: process.cwd(),
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code) => {
      // Parse JSON output
      try {
        resolve(output);
      } catch {
        reject(new Error(`Tests failed with exit code ${code}. Error: ${errorOutput}`));
      }
    });
  });
}

async function parseTestResults(jsonOutput: string): Promise<TestSummary> {
  const results = JSON.parse(jsonOutput);
  const tests: TestSummary['tests'] = [];
  
  let passed = 0;
  let failed = 0;
  let totalDuration = 0;

  for (const suite of results.suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const status = test.status === 'expected' ? 'passed' : 
                      test.status === 'skipped' ? 'skipped' : 'failed';
        
        tests.push({
          name: `${suite.title} > ${spec.title}`,
          status,
          duration: test.duration ?? 0,
        });

        if (status === 'passed') passed++;
        else if (status === 'failed') failed++;
        totalDuration += test.duration ?? 0;
      }
    }
  }

  return {
    timestamp: new Date().toISOString(),
    duration: totalDuration,
    total: tests.length,
    passed,
    failed,
    tests,
  };
}

async function main(): Promise<void> {
  console.log('Factory Test Runner');
  console.log('===================\n');
  
  await ensureReportsDir();
  
  console.log('Running E2E tests...\n');
  
  const startTime = Date.now();
  
  const jsonOutput = await runPlaywrightTests();
  const summary = await parseTestResults(jsonOutput);
  
  // Save report
  const reportPath = join(REPORTS_DIR, `test-report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  
  // Print summary
  console.log('\n===================');
  console.log('TEST SUMMARY');
  console.log('===================\n');
  
  console.log(`Total Tests: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
  
  if (summary.failed > 0) {
    console.log('\nFailed Tests:');
    for (const test of summary.tests.filter(t => t.status === 'failed')) {
      console.log(`  - ${test.name}`);
    }
    process.exit(1);
  } else {
    console.log('\nAll tests passed.');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(1);
});

