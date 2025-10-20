import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Jeju',
  description: 'High-performance OP-Stack settling on Base with Flashblocks, EigenDA, and full DeFi stack',
  base: '/jeju/',
  ignoreDeadLinks: false, // ✅ Fixed: All missing pages created
  
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
      { text: 'Get Started', link: '/getting-started/introduction' },
      { text: 'Developers', link: '/developers/quick-start' },
      { text: 'Network Info', link: '/network/testnet' },
      {
        text: 'Resources',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Deployment', link: '/deployment/overview' },
          { text: 'Contract Addresses', link: '/contracts' },
          { text: 'Support', link: '/support' },
        ],
      },
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/getting-started/introduction' },
            { text: 'What is Jeju?', link: '/getting-started/what-is-jeju' },
            { text: 'Quick Start', link: '/getting-started/quick-start' },
            { text: 'Installation', link: '/getting-started/installation' },
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
            { text: 'DeFi Protocols', link: '/developers/defi-protocols' },
            { text: 'RPC Methods', link: '/developers/rpc-methods' },
          ],
        },
      ],
      
      '/network/': [
        {
          text: 'Network Information',
          items: [
            { text: 'Testnet', link: '/network/testnet' },
            { text: 'Mainnet', link: '/network/mainnet' },
            { text: 'Wallet Setup', link: '/network/wallet-setup' },
            { text: 'Bridge Assets', link: '/network/bridge' },
          ],
        },
      ],
      
      '/deployment/': [
        {
          text: 'Chain Deployment',
          items: [
            { text: 'Overview', link: '/deployment/overview' },
            { text: 'Prerequisites', link: '/deployment/prerequisites' },
            { text: 'Testnet Deployment', link: '/deployment/testnet' },
            { text: 'Mainnet Deployment', link: '/deployment/mainnet' },
            { text: 'Infrastructure', link: '/deployment/infrastructure' },
          ],
        },
        {
          text: 'Operations',
          items: [
            { text: 'Monitoring', link: '/deployment/monitoring' },
            { text: 'Runbooks', link: '/deployment/runbooks' },
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
      copyright: 'Copyright © 2025-present Jeju',
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

