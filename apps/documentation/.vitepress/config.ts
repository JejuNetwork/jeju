import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Jeju',
  description: 'OP-Stack L2 for Agents',
  base: '/jeju/',
  srcDir: 'docs',
  ignoreDeadLinks: [
    /^http:\/\/localhost/,
    /\/api\/.*\/README/,
    /\/build\//,
    /\/contracts\/governance/,
    /\/applications\/wallet/,
  ],

  vite: {
    server: { port: parseInt(process.env.DOCUMENTATION_PORT || '4004') },
  },

  markdown: {
    lineNumbers: true,
  },

  head: [
    ['link', { rel: 'icon', href: '/jeju/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#0EA5E9' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Jeju',

    nav: [
      { text: 'Start', link: '/getting-started/quick-start' },
      { text: 'Build', link: '/build/overview' },
      { text: 'Operate', link: '/operate/overview' },
      { text: 'Apps', link: '/applications/overview' },
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Quick Start', link: '/getting-started/quick-start' },
            { text: 'Networks', link: '/getting-started/networks' },
            { text: 'Test Accounts', link: '/getting-started/test-accounts' },
          ],
        },
      ],

      '/learn/': [
        {
          text: 'Learn',
          items: [
            { text: 'Architecture', link: '/learn/architecture' },
            { text: 'Gasless Transactions', link: '/learn/gasless' },
            { text: 'Agent Infrastructure', link: '/learn/agents' },
          ],
        },
      ],

      '/build/': [
        {
          text: 'Build',
          items: [
            { text: 'Overview', link: '/build/overview' },
          ],
        },
        {
          text: 'Packages',
          items: [
            { text: 'SDK', link: '/packages/sdk' },
            { text: 'CLI', link: '/packages/cli' },
            { text: 'OAuth3', link: '/packages/oauth3' },
            { text: 'Contracts', link: '/packages/contracts' },
          ],
        },
      ],

      '/integrate/': [
        {
          text: 'Cross-Chain',
          items: [
            { text: 'Overview', link: '/integrate/overview' },
            { text: 'EIL (Bridging)', link: '/integrate/eil' },
            { text: 'OIF (Intents)', link: '/integrate/oif' },
          ],
        },
      ],

      '/operate/': [
        {
          text: 'Operate',
          items: [
            { text: 'Overview', link: '/operate/overview' },
            { text: 'RPC Node', link: '/operate/rpc-node' },
            { text: 'Compute Node', link: '/operate/compute-node' },
            { text: 'Storage Node', link: '/operate/storage-node' },
            { text: 'XLP', link: '/operate/xlp' },
            { text: 'Solver', link: '/operate/solver' },
          ],
        },
      ],

      '/deployment/': [
        {
          text: 'Deployment',
          items: [
            { text: 'Overview', link: '/deployment/overview' },
            { text: 'Localnet', link: '/deployment/localnet' },
            { text: 'Testnet', link: '/deployment/testnet' },
            { text: 'Mainnet', link: '/deployment/mainnet' },
          ],
        },
      ],

      '/applications/': [
        {
          text: 'User Apps',
          items: [
            { text: 'Overview', link: '/applications/overview' },
            { text: 'Gateway', link: '/applications/gateway' },
            { text: 'Bazaar', link: '/applications/bazaar' },
          ],
        },
        {
          text: 'Infrastructure',
          items: [
            { text: 'DWS', link: '/applications/dws' },
            { text: 'Crucible', link: '/applications/crucible' },
            { text: 'Indexer', link: '/applications/indexer' },
            { text: 'Factory', link: '/applications/factory' },
          ],
        },
      ],

      '/packages/': [
        {
          text: 'Packages',
          items: [
            { text: 'SDK', link: '/packages/sdk' },
            { text: 'CLI', link: '/packages/cli' },
            { text: 'OAuth3', link: '/packages/oauth3' },
            { text: 'Contracts', link: '/packages/contracts' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/elizaos/jeju' },
      { icon: 'discord', link: 'https://discord.gg/elizaos' },
      { icon: 'twitter', link: 'https://twitter.com/elizaos' },
    ],

    footer: {
      message: 'MIT License',
      copyright: '© 2025 Jeju Network',
    },

    search: { provider: 'local' },

    editLink: {
      pattern: 'https://github.com/elizaos/jeju/edit/main/apps/documentation/docs/:path',
      text: 'Edit on GitHub',
    },

    outline: { level: [2, 3] },
  },
});
