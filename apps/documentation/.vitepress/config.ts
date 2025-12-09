import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Jeju',
  description: 'OP-Stack L3 settling on Base with Flashblocks and EigenDA',
  base: '/jeju/',
  ignoreDeadLinks: [
    /^http:\/\/localhost/,
    /\/operators\//,
    /\/api\/.*\/README/,
  ],
  
  vite: {
    server: {
      port: parseInt(process.env.DOCUMENTATION_PORT || '4004')
    }
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
      { text: 'Developers', link: '/developers/quick-start' },
      { text: 'Network', link: '/network/testnet' },
      {
        text: 'Apps',
        items: [
          { text: 'Overview', link: '/applications/overview' },
          { text: 'Gateway', link: '/applications/gateway' },
          { text: 'Bazaar', link: '/applications/bazaar' },
          { text: 'Indexer', link: '/applications/indexer' },
        ],
      },
      {
        text: 'Resources',
        items: [
          { text: 'Agent Registry', link: '/registry' },
          { text: 'Contract Addresses', link: '/contracts' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Deployment', link: '/deployment/overview' },
          { text: 'Support', link: '/support' },
        ],
      },
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Quick Start', link: '/getting-started/quick-start' },
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Staking & Earning', link: '/getting-started/staking' },
            { text: 'Token Integration', link: '/getting-started/token-integration' },
          ],
        },
      ],
      
      '/developers/': [
        {
          text: 'Developers',
          items: [
            { text: 'Quick Start', link: '/developers/quick-start' },
            { text: 'Local Development', link: '/developers/local-development' },
            { text: 'Deploy Contracts', link: '/developers/deploy-contracts' },
            { text: 'RPC Methods', link: '/developers/rpc-methods' },
            { text: 'Run RPC Node', link: '/developers/run-rpc-node' },
          ],
        },
      ],
      
      '/network/': [
        {
          text: 'Network',
          items: [
            { text: 'Testnet', link: '/network/testnet' },
            { text: 'Mainnet', link: '/network/mainnet' },
            { text: 'Wallet Setup', link: '/network/wallet-setup' },
            { text: 'Bridging (EIL)', link: '/network/bridge' },
          ],
        },
      ],
      
      '/applications/': [
        {
          text: 'Applications',
          items: [
            { text: 'Overview', link: '/applications/overview' },
            { text: 'Gateway', link: '/applications/gateway' },
            { text: 'Bazaar', link: '/applications/bazaar' },
            { text: 'Indexer', link: '/applications/indexer' },
            { text: 'Monitoring', link: '/applications/monitoring' },
            { text: 'IPFS', link: '/applications/ipfs' },
          ],
        },
      ],
      
      '/deployment/': [
        {
          text: 'Deployment',
          items: [
            { text: 'Overview', link: '/deployment/overview' },
            { text: 'Prerequisites', link: '/deployment/prerequisites' },
            { text: 'Testnet Checklist', link: '/deployment/testnet-checklist' },
            { text: 'Mainnet Checklist', link: '/deployment/mainnet-checklist' },
            { text: 'Infrastructure', link: '/deployment/infrastructure' },
          ],
        },
        {
          text: 'Operations',
          items: [
            { text: 'Monitoring', link: '/deployment/monitoring' },
            { text: 'Runbooks', link: '/deployment/runbooks' },
            { text: 'Oracle Setup', link: '/deployment/oracle-setup' },
          ],
        },
      ],
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

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/elizaos/jeju/edit/main/apps/documentation/:path',
      text: 'Edit this page on GitHub',
    },
  },
});
