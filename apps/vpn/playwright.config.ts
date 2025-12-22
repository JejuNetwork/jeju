import { createPlaywrightConfig } from '@jejunetwork/tests/playwright-only';

const VPN_PORT = parseInt(process.env.VPN_PORT || '1421');

export default createPlaywrightConfig({
  name: 'vpn',
  port: VPN_PORT,
  testDir: './tests/e2e',
  webServer: {
    command: 'bun run dev:web',
  },
});
