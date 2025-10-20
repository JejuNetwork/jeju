import { createJejuPlaywrightConfig } from '../../tests/shared/playwright.config.base';

const CRUCIBLE_PORT = process.env.CRUCIBLE_PORT || '7777';

export default createJejuPlaywrightConfig({
  appName: 'crucible',
  port: parseInt(CRUCIBLE_PORT),
  testDir: './tests/e2e',
  webServer: false, // API server, not web UI
  overrides: {
    timeout: 120000, // 2 minutes for agent operations
  },
});
