import { defineConfig } from 'vocs'

export default defineConfig({
  title: 'Jeju',
  description: 'OP-Stack L2 for Agents',
  logoUrl: '/logo.svg',
  iconUrl: '/favicon.ico',
  rootDir: 'docs',

  vite: {
    cacheDir: 'node_modules/.vite',
    server: {
      allowedHosts: ['.local.jejunetwork.org'],
      strictPort: true,
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: 24005,
      },
    },
  },

  theme: {
    accentColor: '#3eaf7c',
  },

  topNav: [
    { text: 'Start', link: '/getting-started/quick-start' },
    { text: 'Build', link: '/build/overview' },
    { text: 'Operate', link: '/operate/overview' },
    { text: 'Apps', link: '/applications/overview' },
  ],

  socials: [
    { icon: 'github', link: 'https://github.com/elizaos/jeju' },
    { icon: 'discord', link: 'https://discord.gg/elizaos' },
    { icon: 'x', link: 'https://twitter.com/elizaos' },
  ],

  editLink: {
    pattern:
      'https://github.com/elizaos/jeju/edit/main/apps/documentation/docs/pages/:path',
    text: 'Edit on GitHub',
  },

  sidebar: {
    '/getting-started/': [
      {
        text: 'Getting Started',
        items: [
          { text: 'Quick Start', link: '/getting-started/quick-start' },
          { text: 'Networks', link: '/getting-started/networks' },
          { text: 'Test Accounts', link: '/getting-started/test-accounts' },
          { text: 'Configuration', link: '/getting-started/configuration' },
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
          { text: 'Concepts', link: '/learn/concepts' },
          { text: 'Intents', link: '/learn/intents' },
          { text: 'Why Jeju', link: '/learn/why-jeju' },
        ],
      },
    ],

    '/build/': [
      {
        text: 'Build',
        items: [{ text: 'Overview', link: '/build/overview' }],
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

    '/contracts/': [
      {
        text: 'Contracts',
        items: [
          { text: 'Overview', link: '/contracts/overview' },
          { text: 'Identity', link: '/contracts/identity' },
          { text: 'Payments', link: '/contracts/payments' },
          { text: 'Tokens', link: '/contracts/tokens' },
          { text: 'Staking', link: '/contracts/staking' },
          { text: 'DeFi', link: '/contracts/defi' },
          { text: 'Compute', link: '/contracts/compute' },
          { text: 'JNS', link: '/contracts/jns' },
          { text: 'EIL', link: '/contracts/eil' },
          { text: 'OIF', link: '/contracts/oif' },
          { text: 'Moderation', link: '/contracts/moderation' },
        ],
      },
    ],

    '/guides/': [
      {
        text: 'Guides',
        items: [
          { text: 'Overview', link: '/guides/overview' },
          { text: 'Deploy Agent', link: '/guides/deploy-agent' },
          { text: 'Register Agent', link: '/guides/register-agent' },
          { text: 'Register Token', link: '/guides/register-token' },
          {
            text: 'Gasless Transactions',
            link: '/guides/gasless-transactions',
          },
          { text: 'Run RPC Node', link: '/guides/run-rpc-node' },
          { text: 'Run Compute Node', link: '/guides/run-compute-node' },
          { text: 'Run Storage Node', link: '/guides/run-storage-node' },
          { text: 'Become XLP', link: '/guides/become-xlp' },
          { text: 'Become Solver', link: '/guides/become-solver' },
          { text: 'Fork Network', link: '/guides/fork-network' },
        ],
      },
    ],

    '/tutorials/': [
      {
        text: 'Tutorials',
        items: [
          { text: 'Overview', link: '/tutorials/overview' },
          { text: 'Gasless NFT', link: '/tutorials/gasless-nft' },
          { text: 'Register Token', link: '/tutorials/register-token' },
          { text: 'Trading Agent', link: '/tutorials/trading-agent' },
          { text: 'x402 API', link: '/tutorials/x402-api' },
        ],
      },
    ],

    '/api-reference/': [
      {
        text: 'API Reference',
        items: [
          { text: 'RPC', link: '/api-reference/rpc' },
          { text: 'GraphQL', link: '/api-reference/graphql' },
          { text: 'A2A', link: '/api-reference/a2a' },
          { text: 'MCP', link: '/api-reference/mcp' },
          { text: 'x402', link: '/api-reference/x402' },
        ],
      },
    ],

    '/reference/': [
      {
        text: 'Reference',
        items: [
          { text: 'Addresses', link: '/reference/addresses' },
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Environment Variables', link: '/reference/env-vars' },
          { text: 'Ports', link: '/reference/ports' },
          { text: 'Test Accounts', link: '/reference/test-accounts' },
        ],
      },
    ],
  },
})
