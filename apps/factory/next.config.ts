import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      'porto/internal': './lib/stubs/porto-stub.js',
      'porto': './lib/stubs/porto-stub.js',
    },
  },
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

    const portoStub = path.resolve(__dirname, './lib/stubs/porto-stub.js');
    config.resolve.alias = {
      ...config.resolve.alias,
      'porto/internal': portoStub,
      'porto': portoStub,
      'zod/mini': require.resolve('zod'),
    };

    config.module = {
      ...config.module,
      exprContextCritical: false,
      unknownContextCritical: false,
    };

    return config;
  },
};

export default nextConfig;
