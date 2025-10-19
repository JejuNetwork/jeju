/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
  env: {
    NEXT_PUBLIC_GRAPHQL_URL: process.env.GRAPHQL_URL || 'http://localhost:4350/graphql',
    NEXT_PUBLIC_RPC_URL: process.env.RPC_URL || 'http://localhost:8545',
    NEXT_PUBLIC_CHAIN_ID: process.env.CHAIN_ID || '42069',
  }
};

export default nextConfig;

