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
  // Use Turbopack with empty config to silence warnings
  turbopack: {},
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

