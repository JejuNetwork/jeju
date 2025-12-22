/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next.js 16 uses Turbopack by default
  turbopack: {},
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  // Serve agent-card.json at /.well-known/agent-card.json for A2A discovery
  async rewrites() {
    return [
      {
        source: '/.well-known/agent-card.json',
        destination: '/agent-card.json',
      },
    ];
  },
  webpack: (config) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding')
    config.resolve.fallback = { fs: false, net: false, tls: false }
    config.resolve.alias = {
      ...config.resolve.alias,
      'zod/mini': require.resolve('zod/v4/mini'),
    }
    return config
  },
}

module.exports = nextConfig

