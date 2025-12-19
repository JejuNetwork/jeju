import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WagmiProvider, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import App from './App';
import './styles/index.css';
import { CHAIN_ID, RPC_URL, NETWORK, WALLETCONNECT_PROJECT_ID } from './config';

const jejuChain = {
  id: CHAIN_ID,
  name: NETWORK === 'mainnet' ? 'Jeju Network' : NETWORK === 'testnet' ? 'Jeju Testnet' : 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
} as const;

const config = getDefaultConfig({
  appName: 'DWS Console',
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [jejuChain],
  transports: {
    [jejuChain.id]: http(),
  },
  ssr: false,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      refetchOnWindowFocus: false,
    },
  },
});

const rainbowTheme = darkTheme({
  accentColor: '#06b6d4',
  accentColorForeground: 'white',
  borderRadius: 'medium',
  fontStack: 'system',
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={rainbowTheme}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>
  );
}
