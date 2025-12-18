/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Skip TypeScript errors during build (monorepo type conflicts)
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    '@jejunetwork/shared',
    '@jejunetwork/config',
    '@jejunetwork/contracts',
    '@jejunetwork/messaging',
    '@jejunetwork/oauth3',
    '@jejunetwork/types',
  ],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.imgur.com' },
      { protocol: 'https', hostname: 'imagedelivery.net' },
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: 'w3s.link' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
  webpack: (config, { isServer }) => {
    // Fix browser-only module resolution
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
      };
    }
    
    // Stub out problematic porto connector and its dependencies
    const portoStub = require.resolve('./lib/stubs/porto-stub.js');
    config.resolve.alias = {
      ...config.resolve.alias,
      'porto/internal': portoStub,
      'porto': portoStub,
      'zod/mini': require.resolve('zod'),
    };
    
    // Ignore dynamic requires in problematic packages
    config.module = {
      ...config.module,
      exprContextCritical: false,
      unknownContextCritical: false,
    };
    
    return config;
  },
};

module.exports = nextConfig;

