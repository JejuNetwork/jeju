import { defineConfig } from 'vitepress';

// Helper to reduce repetition in sidebar definitions
const sidebarSection = (text: string, base: string, items: string[][]) => [{
  text,
  items: items.map(([label, page]) => ({ text: label, link: `${base}/${page}` })),
}];

export default defineConfig({
  title: 'Jeju',
  description: 'OP-Stack L2 on Ethereum with 200ms Flashblocks',
  base: '/jeju/',
  ignoreDeadLinks: [
    /^http:\/\/localhost/,
    /\/api\/.*\/README/,
    // Planned guides (remove when created)
    /\/guides\/become-lp/,
    /\/guides\/launch-token/,
    /\/guides\/register-name/,
    /\/guides\/build-character/,
    /\/guides\/multi-agent/,
    /\/guides\/graphql-best-practices/,
    /\/guides\/custom-indexing/,
    /\/guides\/realtime-apps/,
    /\/guides\/store-agent-memory/,
    /\/guides\/ipfs-best-practices/,
  ],

  vite: {
    server: { port: parseInt(process.env.DOCUMENTATION_PORT || '4004') },
  },

  head: [
    ['link', { rel: 'icon', href: '/jeju/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#3eaf7c' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:locale', content: 'en' }],
    ['meta', { name: 'og:site_name', content: 'Jeju' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Get Started', link: '/getting-started/quick-start' },
      { text: 'Apps', link: '/applications/overview' },
      { text: 'Contracts', link: '/contracts/overview' },
      { text: 'Guides', link: '/guides/overview' },
      {
        text: 'Reference',
        items: [
          { text: 'API', link: '/api-reference/rpc' },
          { text: 'Deployment', link: '/deployment/overview' },
          { text: 'CLI Commands', link: '/reference/cli' },
          { text: 'Port Allocations', link: '/reference/ports' },
          { text: 'Contract Addresses', link: '/reference/addresses' },
        ],
      },
    ],

    sidebar: {
      '/getting-started/': sidebarSection('Getting Started', '/getting-started', [
        ['Quick Start', 'quick-start'],
        ['Networks', 'networks'],
        ['Configuration', 'configuration'],
        ['Test Accounts', 'test-accounts'],
      ]),

      '/applications/': sidebarSection('Applications', '/applications', [
        ['Overview', 'overview'],
        ['Gateway', 'gateway'],
        ['Bazaar', 'bazaar'],
        ['Compute', 'compute'],
        ['Storage', 'storage'],
        ['Crucible', 'crucible'],
        ['Indexer', 'indexer'],
        ['Facilitator', 'facilitator'],
        ['Monitoring', 'monitoring'],
      ]),

      '/contracts/': sidebarSection('Smart Contracts', '/contracts', [
        ['Overview', 'overview'],
        ['Tokens', 'tokens'],
        ['Identity (ERC-8004)', 'identity'],
        ['Payments & Paymasters', 'payments'],
        ['Open Intents (OIF)', 'oif'],
        ['Cross-Chain (EIL)', 'eil'],
        ['Compute', 'compute'],
        ['Staking', 'staking'],
        ['Name Service (JNS)', 'jns'],
        ['DeFi', 'defi'],
        ['Moderation', 'moderation'],
      ]),

      '/guides/': sidebarSection('User Guides', '/guides', [
        ['Overview', 'overview'],
        ['Become an XLP', 'become-xlp'],
        ['Become a Solver', 'become-solver'],
        ['Run an RPC Node', 'run-rpc-node'],
        ['Run a Compute Node', 'run-compute-node'],
        ['Run a Storage Node', 'run-storage-node'],
        ['Register a Token', 'register-token'],
        ['Register an Agent', 'register-agent'],
        ['Deploy an Agent', 'deploy-agent'],
        ['Gasless Transactions', 'gasless-transactions'],
      ]),

      '/api-reference/': sidebarSection('API Reference', '/api-reference', [
        ['RPC Methods', 'rpc'],
        ['GraphQL (Indexer)', 'graphql'],
        ['A2A Protocol', 'a2a'],
        ['MCP', 'mcp'],
        ['x402 Payments', 'x402'],
      ]),

      '/deployment/': sidebarSection('Deployment', '/deployment', [
        ['Overview', 'overview'],
        ['Localnet', 'localnet'],
        ['Testnet', 'testnet'],
        ['Mainnet', 'mainnet'],
        ['Contracts', 'contracts'],
        ['Infrastructure', 'infrastructure'],
      ]),

      '/reference/': sidebarSection('Reference', '/reference', [
        ['CLI Commands', 'cli'],
        ['Port Allocations', 'ports'],
        ['Environment Variables', 'env-vars'],
        ['Contract Addresses', 'addresses'],
      ]),
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/elizaos/jeju' },
      { icon: 'discord', link: 'https://discord.gg/jeju' },
      { icon: 'twitter', link: 'https://twitter.com/jejunetwork' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 Jeju',
    },

    search: { provider: 'local' },

    editLink: {
      pattern: 'https://github.com/elizaos/jeju/edit/main/apps/documentation/:path',
      text: 'Edit this page on GitHub',
    },
  },
});
