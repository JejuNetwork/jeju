/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    
    // Fix MetaMask SDK React Native dependencies for web
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
      'react-native': false,
    };
    
    // Ignore React Native modules in MetaMask SDK
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };
    
    return config;
  },
  env: {
    NEXT_PUBLIC_GRAPHQL_URL: process.env.GRAPHQL_URL || 'http://localhost:4350/graphql',
    NEXT_PUBLIC_RPC_URL: process.env.RPC_URL || 'http://localhost:8545',
    NEXT_PUBLIC_CHAIN_ID: process.env.CHAIN_ID || '42069',
  }
};

export default nextConfig;

