import { createJejuPlaywrightConfig } from '../../tests/shared/playwright.config.base';

const DOCUMENTATION_PORT = process.env.DOCUMENTATION_PORT || '4004';

export default createJejuPlaywrightConfig({
  appName: 'documentation',
  port: parseInt(DOCUMENTATION_PORT),
  testDir: './tests/e2e',
});
