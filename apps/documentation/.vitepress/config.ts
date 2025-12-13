import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Jeju',
  description: 'OP-Stack L2 on Ethereum with 200ms Flashblocks',
  base: '/jeju/',
  ignoreDeadLinks: [/^http:\/\/localhost/, /\/api\/.*\/README/],

  vite: {
    server: { port: parseInt(process.env.DOCUMENTATION_PORT || '4004') },
  },

  markdown: {
    lineNumbers: true,
    config: (md) => {
      // Enable mermaid
    },
  },

  head: [
    ['link', { rel: 'icon', href: '/jeju/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#0EA5E9' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:locale', content: 'en' }],
    ['meta', { name: 'og:site_name', content: 'Jeju' }],
    ['meta', { name: 'og:title', content: 'Jeju - L2 Built for Agents' }],
    ['meta', { name: 'og:description', content: 'OP-Stack L2 with 200ms blocks, gasless transactions, and native agent infrastructure.' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Jeju',

    nav: [
      { text: 'Docs', link: '/learn/why-jeju' },
      {
        text: 'Learn',
        items: [
          { text: 'Why Jeju?', link: '/learn/why-jeju' },
          { text: 'Core Concepts', link: '/learn/concepts' },
          { text: 'Architecture', link: '/learn/architecture' },
        ],
      },
      {
        text: 'Build',
        items: [
          { text: 'Quick Start', link: '/build/quick-start' },
          { text: 'Tutorials', link: '/tutorials/overview' },
          { text: 'API Reference', link: '/reference/api/rpc' },
        ],
      },
      {
        text: 'Run',
        items: [
          { text: 'Node Operators', link: '/operate/overview' },
          { text: 'Deployment', link: '/operate/deployment' },
        ],
      },
      { text: 'FAQ', link: '/faq' },
    ],

    sidebar: {
      '/learn/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Why Jeju?', link: '/learn/why-jeju' },
            { text: 'Core Concepts', link: '/learn/concepts' },
            { text: 'Architecture', link: '/learn/architecture' },
          ],
        },
        {
          text: 'Key Features',
          items: [
            { text: 'Gasless Transactions', link: '/learn/gasless' },
            { text: 'Cross-Chain Intents', link: '/learn/intents' },
            { text: 'Agent Identity', link: '/learn/agents' },
          ],
        },
      ],

      '/build/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Quick Start', link: '/build/quick-start' },
            { text: 'Networks', link: '/build/networks' },
            { text: 'Configuration', link: '/build/configuration' },
          ],
        },
        {
          text: 'Applications',
          items: [
            { text: 'Overview', link: '/build/apps/overview' },
            { text: 'Gateway', link: '/build/apps/gateway' },
            { text: 'Bazaar', link: '/build/apps/bazaar' },
            { text: 'Compute', link: '/build/apps/compute' },
            { text: 'Storage', link: '/build/apps/storage' },
            { text: 'Crucible', link: '/build/apps/crucible' },
            { text: 'Indexer', link: '/build/apps/indexer' },
          ],
        },
        {
          text: 'Smart Contracts',
          items: [
            { text: 'Overview', link: '/build/contracts/overview' },
            { text: 'Tokens', link: '/build/contracts/tokens' },
            { text: 'Identity (ERC-8004)', link: '/build/contracts/identity' },
            { text: 'Paymasters', link: '/build/contracts/paymasters' },
            { text: 'Intents (OIF)', link: '/build/contracts/oif' },
            { text: 'Bridge (EIL)', link: '/build/contracts/eil' },
          ],
        },
      ],

      '/tutorials/': [
        {
          text: 'Tutorials',
          items: [
            { text: 'Overview', link: '/tutorials/overview' },
            { text: 'Gasless NFT Drop', link: '/tutorials/gasless-nft' },
            { text: 'Trading Agent', link: '/tutorials/trading-agent' },
            { text: 'Pay-per-Query API', link: '/tutorials/x402-api' },
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
            { text: 'Become an XLP', link: '/operate/xlp' },
            { text: 'Become a Solver', link: '/operate/solver' },
          ],
        },
        {
          text: 'Deployment',
          items: [
            { text: 'Overview', link: '/operate/deployment' },
            { text: 'Localnet', link: '/operate/localnet' },
            { text: 'Testnet', link: '/operate/testnet' },
            { text: 'Mainnet', link: '/operate/mainnet' },
          ],
        },
      ],

      '/reference/': [
        {
          text: 'API Reference',
          items: [
            { text: 'RPC Methods', link: '/reference/api/rpc' },
            { text: 'GraphQL', link: '/reference/api/graphql' },
            { text: 'A2A Protocol', link: '/reference/api/a2a' },
            { text: 'MCP', link: '/reference/api/mcp' },
            { text: 'x402 Payments', link: '/reference/api/x402' },
          ],
        },
        {
          text: 'Reference Tables',
          items: [
            { text: 'Contract Addresses', link: '/reference/addresses' },
            { text: 'Port Allocations', link: '/reference/ports' },
            { text: 'Environment Variables', link: '/reference/env-vars' },
            { text: 'CLI Commands', link: '/reference/cli' },
            { text: 'Test Accounts', link: '/reference/test-accounts' },
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
