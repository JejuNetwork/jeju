import { http, WagmiProvider as WagmiProviderBase } from 'wagmi'

// Type assertion to work around React 19 JSX component type incompatibility
const WagmiProvider = WagmiProviderBase as React.FC<
  React.PropsWithChildren<{ config: ReturnType<typeof getDefaultConfig> }>
>

import {
  darkTheme,
  getDefaultConfig,
  lightTheme,
  RainbowKitProvider,
} from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@rainbow-me/rainbowkit/styles.css'
import { BanCheckWrapper } from './components/BanCheckWrapper'
import Dashboard from './components/Dashboard'
import { ThemeProvider, useTheme } from './components/ThemeProvider'
import { CHAIN_ID, NETWORK, RPC_URL, WALLETCONNECT_PROJECT_ID } from './config'

// network chain config from centralized config
const jejuChain = {
  id: CHAIN_ID,
  name:
    NETWORK === 'mainnet'
      ? 'Jeju Network'
      : NETWORK === 'testnet'
        ? 'Jeju Testnet'
        : 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
} as const

const config = getDefaultConfig({
  appName: 'Gateway Portal - the network',
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [jejuChain],
  transports: {
    [jejuChain.id]: http(),
  },
  ssr: false,
})

const queryClient = new QueryClient()

const rainbowDark = darkTheme({
  accentColor: '#a78bfa',
  accentColorForeground: '#1e293b',
  borderRadius: 'medium',
  fontStack: 'system',
})

const rainbowLight = lightTheme({
  accentColor: '#8b5cf6',
  accentColorForeground: 'white',
  borderRadius: 'medium',
  fontStack: 'system',
})

function AppContent() {
  const { theme } = useTheme()
  return (
    <RainbowKitProvider theme={theme === 'dark' ? rainbowDark : rainbowLight}>
      <BanCheckWrapper>
        <Dashboard />
      </BanCheckWrapper>
    </RainbowKitProvider>
  )
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
  )
}
