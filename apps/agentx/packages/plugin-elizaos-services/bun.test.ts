// Bun test configuration for ElizaOS Services plugin package
export default {
  // Test patterns
  testMatch: ['src/**/*.test.{js,ts}', 'src/**/*.spec.{js,ts}', 'src/__tests__/**/*.{js,ts}'],

  // Coverage configuration
  coverage: {
    reporter: ['text', 'json', 'html'],
    include: ['src/**/*'],
    exclude: [
      'src/test/**',
      'src/**/*.test.*',
      'src/**/*.spec.*',
      'src/__tests__/**',
      'src/**/*.d.ts',
    ],
  },

  // Test timeout
  timeout: 120000, // Longer timeout for sandbox and integration tests

  // Environment
  env: {
    NODE_ENV: 'test',
    E2B_TEST_MODE: 'true',
  },
};
