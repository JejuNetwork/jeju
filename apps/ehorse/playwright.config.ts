import { createJejuPlaywrightConfig } from '../../tests/shared/playwright.config.base';

const EHORSE_PORT = process.env.EHORSE_PORT || '5700';

export default createJejuPlaywrightConfig({
  appName: 'ehorse',
  port: parseInt(EHORSE_PORT),
  testDir: './tests/e2e',
  webServer: false,
  overrides: {
    timeout: 180000, // Extended timeout for ehorse
  },
});
