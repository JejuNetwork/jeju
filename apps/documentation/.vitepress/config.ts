import { defineConfig } from 'vitepress';
import { getNetworkName } from '@jejunetwork/config';

export default defineConfig({
  title: 'Jeju Network',
  description: 'The L2 Built for Agents - 200ms blocks, gasless transactions, native agent infrastructure',
  base: '/jeju/',
  ignoreDeadLinks: [
    /^http:\/\/localhost/,
    /\/api\/.*\/README/,
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
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:locale', content: 'en' }],
    ['meta', { name: 'og:site_name', content: 'Jeju Network' }],
    ['meta', { name: 'og:title', content: 'Jeju - The L2 Built for Agents' }],
    ['meta', { name: 'og:description', content: 'OP-Stack L2 with 200ms blocks, gasless transactions, and native agent infrastructure.' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Jeju',

    nav: [
      { text: 'Get Started', link: '/getting-started/quick-start' },
      { text: 'Build', link: '/build/overview' },
      { text: 'Integrate', link: '/integrate/overview' },
      { text: 'Operate', link: '/operate/overview' },
      {
        text: 'Reference',
        items: [
          { text: 'Applications', link: '/applications/gateway' },
          { text: 'Packages', link: '/packages/sdk' },
          { text: 'Deployment', link: '/deployment/overview' },
        ],
      },
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Quick Start', link: '/getting-started/quick-start' },
            { text: 'Networks', link: '/getting-started/networks' },
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
          text: 'Build on Jeju',
          items: [
            { text: 'Overview', link: '/build/overview' },
          ],
        },
        {
          text: 'SDK',
          collapsed: false,
          items: [
            { text: 'SDK Overview', link: '/packages/sdk' },
          ],
        },
      ],

      '/integrate/': [
        {
          text: 'Cross-Chain Integration',
          items: [
            { text: 'Overview', link: '/integrate/overview' },
            { text: 'EIL (Instant Bridging)', link: '/integrate/eil' },
            { text: 'OIF (Intents)', link: '/integrate/oif' },
          ],
        },
        {
          text: 'Become a Provider',
          items: [
            { text: 'Become an XLP', link: '/integrate/become-xlp' },
            { text: 'Become a Solver', link: '/integrate/become-solver' },
          ],
        },
      ],

      '/operate/': [
        {
          text: 'Node Operations',
          items: [
            { text: 'Overview', link: '/operate/overview' },
            { text: 'Run RPC Node', link: '/operate/rpc-node' },
            { text: 'Run Compute Node', link: '/operate/compute-node' },
            { text: 'Run Storage Node', link: '/operate/storage-node' },
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
          text: 'Core Apps',
          items: [
            { text: 'Gateway', link: '/applications/gateway' },
            { text: 'Bazaar', link: '/applications/bazaar' },
            { text: 'Crucible', link: '/applications/crucible' },
            { text: 'Factory', link: '/applications/factory' },
            { text: 'DWS', link: '/applications/dws' },
            { text: 'Indexer', link: '/applications/indexer' },
            { text: 'Autocrat', link: '/applications/autocrat' },
          ],
        },
      ],

      '/packages/': [
        {
          text: 'Core Packages',
          items: [
            { text: 'SDK', link: '/packages/sdk' },
            { text: 'Contracts', link: '/packages/contracts' },
            { text: 'CLI', link: '/packages/cli' },
            { text: 'OAuth3', link: '/packages/oauth3' },
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
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 Jeju Network',
    },

    search: { provider: 'local' },

    editLink: {
      pattern: 'https://github.com/elizaos/jeju/edit/main/apps/documentation/:path',
      text: 'Edit this page on GitHub',
    },

    outline: { level: [2, 3] },

    lastUpdated: {
      text: 'Updated at',
      formatOptions: { dateStyle: 'short' },
    },
  },
});
