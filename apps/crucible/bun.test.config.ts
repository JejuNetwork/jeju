/**
 * Bun Test Configuration
 */

export default {
  // Test files
  testMatch: ['**/*.test.ts'],
  
  // Setup/teardown
  preload: ['./tests/setup.ts'],
  
  // Timeout
  timeout: 30000, // 30 seconds for blockchain tests
  
  // Coverage
  coverage: {
    enabled: true,
    reporter: ['text', 'json', 'html'],
    exclude: [
      'node_modules/**',
      'tests/**',
      'dist/**',
      '**/*.test.ts',
      '**/*.config.ts'
    ]
  }
};

