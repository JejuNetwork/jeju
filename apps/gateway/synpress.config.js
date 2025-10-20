// Synpress configuration
// https://synpress.io/

const { defineConfig } = require('@synthetixio/synpress');

module.exports = defineConfig({
  // Test directory
  testDir: 'tests/synpress',
  
  // Synpress options
  snapshotDir: 'tests/synpress/snapshots',
  
  // Playwright options
  use: {
    baseURL: 'http://localhost:4001',
    headless: false,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  
  // Timeout
  timeout: 120000,
  
  // Workers
  workers: 1,
  fullyParallel: false,
  
  // Reporter
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/synpress-results.json' }],
  ],
});

