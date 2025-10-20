import { WagmiProvider, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import Dashboard from './components/Dashboard';

// Jeju localnet chain config
// Using STATIC port 9545 (forwarded automatically by dev environment)
const rpcUrl = import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:9545';
const chainId = parseInt(import.meta.env.VITE_CHAIN_ID || '1337');

const jejuLocalnet = {
  id: chainId,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] },
    public: { http: [rpcUrl] }
  }
} as const;

const config = getDefaultConfig({
  appName: 'Gateway Portal - Jeju Network',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [jejuLocalnet],
  transports: {
    [jejuLocalnet.id]: http()
  },
  ssr: false
});

const queryClient = new QueryClient();

// Log configuration for debugging
console.log('🌉 Gateway Portal - Multi-Token System');
console.log('  Chain ID:', chainId);
console.log('  RPC URL:', rpcUrl, '(STATIC PORT - never changes)');
console.log('  Native Token: elizaOS (Jeju) 🏝️');
console.log('  Bridgeable Tokens: CLANKER, VIRTUAL, CLANKERMON (from Base)');
console.log('  + ANY custom ERC20 token from Base network');

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <Dashboard />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

