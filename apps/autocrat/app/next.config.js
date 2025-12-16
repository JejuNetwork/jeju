/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['lucide-react'],
  async rewrites() {
    const apiUrl = process.env.COUNCIL_API_URL || 'http://localhost:8010'
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: '/a2a/:path*',
        destination: `${apiUrl}/a2a/:path*`,
      },
      {
        source: '/mcp/:path*',
        destination: `${apiUrl}/mcp/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
