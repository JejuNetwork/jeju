/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // Enable standalone output for Docker
  experimental: {},
  // Turbopack configuration (Next.js 16+)
  turbopack: {},
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
    return config
  },
}

module.exports = nextConfig

