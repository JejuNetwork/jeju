import { createPlaywrightConfig } from '@jejunetwork/tests/playwright-only';

const OTTO_PORT = parseInt(process.env.OTTO_PORT || '4040');

export default createPlaywrightConfig({
  name: 'otto',
  port: OTTO_PORT,
  testDir: './tests',
  webServer: {
    command: 'bun run dev',
  },
});
