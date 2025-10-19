#!/usr/bin/env node
import { ShellService } from '../../service';
import { createMockRuntime } from '../test-utils';
import shellBasicE2ETests from './shell-basic';
import shellStatefulE2ETests from './shell-stateful';
import shellAdvancedE2ETests from './shell-advanced';
import shellSecurityE2ETests from './shell-security';

// Simple test runner for local e2e testing
async function runE2ETests() {
  console.log('🧪 Running Shell Plugin E2E Tests Locally...\n');

  // Create runtime with shell service
  const runtime = createMockRuntime();
  const shellService = await ShellService.start(runtime);
  runtime.getService = <T extends any>(name: string): T | null => {
    if (name === 'SHELL') {
      return shellService as T;
    }
    return null;
  };

  const testSuites = [
    shellBasicE2ETests,
    shellStatefulE2ETests,
    shellAdvancedE2ETests,
    shellSecurityE2ETests,
  ];

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  for (const suite of testSuites) {
    console.log(`\n📦 Running suite: ${suite.name}`);
    console.log(`   ${suite.description}\n`);

    for (const test of suite.tests) {
      totalTests++;
      process.stdout.write(`   🔄 ${test.name}... `);

      try {
        await test.fn(runtime);
        passedTests++;
        console.log('✅ PASSED');
      } catch (error) {
        failedTests++;
        console.log('❌ FAILED');
        console.error(
          `      Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 Test Summary:');
  console.log(`   Total:  ${totalTests} tests`);
  console.log(`   ✅ Passed: ${passedTests} tests`);
  console.log(`   ❌ Failed: ${failedTests} tests`);
  console.log(`${'='.repeat(60)}\n`);

  // Cleanup
  await shellService.stop();

  process.exit(failedTests > 0 ? 1 : 0);
}

// Run tests
runE2ETests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
