import { createJejuPlaywrightConfig } from '../../tests/shared/playwright.config.base';

const LEADERBOARD_PORT = process.env.LEADERBOARD_PORT || '3000';

export default createJejuPlaywrightConfig({
  appName: 'leaderboard',
  port: parseInt(LEADERBOARD_PORT),
  testDir: './tests/e2e',
});
