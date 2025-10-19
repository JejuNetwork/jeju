#!/usr/bin/env node

/**
 * Script to test sandbox-based Claude Code generation
 *
 * Usage:
 *   ANTHROPIC_API_KEY=your_key E2B_API_KEY=your_key bun run scripts/test-sandbox-generation.ts
 */

// Import the test function
import { testSandboxGeneration } from '../src/__tests__/e2e/sandbox-generation-test';

// Check for required environment variables
const requiredKeys = ['ANTHROPIC_API_KEY', 'E2B_API_KEY'];
const missingKeys = requiredKeys.filter((key) => !process.env[key]);

if (missingKeys.length > 0) {
  console.error('❌ Missing required environment variables:', missingKeys.join(', '));
  console.log('\nUsage:');
  console.log(
    '  ANTHROPIC_API_KEY=your_key E2B_API_KEY=your_key bun run scripts/test-sandbox-generation.ts'
  );
  process.exit(1);
}

console.log('🔑 API Keys configured:');
console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY?.substring(0, 10)}...`);
console.log(`  E2B_API_KEY: ${process.env.E2B_API_KEY?.substring(0, 10)}...`);
console.log('');

// Run the test
testSandboxGeneration()
  .then(() => {
    console.log('\n✅ Sandbox generation test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Sandbox generation test failed:', error);
    process.exit(1);
  });
