/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  // Proxy API calls to the backend
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3100/:path*',
      },
    ];
  },
};

module.exports = nextConfig;






