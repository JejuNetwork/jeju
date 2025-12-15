import { http, createConfig } from 'wagmi';
import { mainnet, baseSepolia } from 'wagmi/chains';
import { injected, metaMask } from 'wagmi/connectors';

const env = import.meta.env;

// Jeju localnet chain config
export const jejuLocalnet = {
  id: 420691,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [env.VITE_JEJU_RPC_URL || 'http://localhost:9545'] },
  },
} as const;

// Simple config without WalletConnect (works for local dev with MetaMask)
export const wagmiConfig = createConfig({
  chains: [jejuLocalnet, baseSepolia, mainnet],
  connectors: [
    injected(),
    metaMask(),
  ],
  transports: {
    [jejuLocalnet.id]: http(),
    [baseSepolia.id]: http(),
    [mainnet.id]: http(),
  },
});
