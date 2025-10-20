import { defineChain } from 'viem';

export const jeju = defineChain({
  id: parseInt(
    process.env.NEXT_PUBLIC_CHAIN_ID || 
    process.env.PREDIMARKET_CHAIN_ID || 
    '1337'
  ),
  name: 'Jeju Network',
  network: 'jeju',
  nativeCurrency: {
    decimals: 18,
    name: 'Ethereum',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { 
      http: [
        process.env.NEXT_PUBLIC_RPC_URL || 
        process.env.PREDIMARKET_RPC_URL || 
        `http://localhost:${process.env.L2_RPC_PORT || '9545'}`
      ] 
    },
    public: { 
      http: [
        process.env.NEXT_PUBLIC_RPC_URL || 
        process.env.PREDIMARKET_RPC_URL || 
        `http://localhost:${process.env.L2_RPC_PORT || '9545'}`
      ] 
    },
  },
  blockExplorers: {
    default: { name: 'JejuScan', url: 'https://scan.jeju.network' },
  },
  testnet: true,
});

