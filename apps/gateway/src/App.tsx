import { WagmiProvider, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import Dashboard from './components/Dashboard';
import { ThemeProvider, useTheme } from './components/ThemeProvider';
import { CHAIN_ID, RPC_URL, WALLETCONNECT_PROJECT_ID, NETWORK } from './config';

// Jeju chain config from centralized config
const jejuChain = {
  id: CHAIN_ID,
  name: NETWORK === 'mainnet' ? 'Jeju' : NETWORK === 'testnet' ? 'Jeju Testnet' : 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] }
  }
} as const;

const config = getDefaultConfig({
  appName: 'Gateway Portal - Jeju Network',
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [jejuChain],
  transports: {
    [jejuChain.id]: http()
  },
  ssr: false
});

const queryClient = new QueryClient();

const rainbowDark = darkTheme({
  accentColor: '#a78bfa',
  accentColorForeground: '#1e293b',
  borderRadius: 'medium',
  fontStack: 'system',
});

const rainbowLight = lightTheme({
  accentColor: '#8b5cf6',
  accentColorForeground: 'white',
  borderRadius: 'medium',
  fontStack: 'system',
});

function AppContent() {
  const { theme } = useTheme();
  return (
    <RainbowKitProvider theme={theme === 'dark' ? rainbowDark : rainbowLight}>
      <Dashboard />
    </RainbowKitProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <AppContent />
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}

