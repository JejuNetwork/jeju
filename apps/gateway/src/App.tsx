import { WagmiProvider, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import Dashboard from './components/Dashboard';
import { ThemeProvider, useTheme } from './components/ThemeProvider';

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

