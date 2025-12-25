import {
  darkTheme,
  type getDefaultConfig,
  lightTheme,
  RainbowKitProvider,
} from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider as WagmiProviderBase } from 'wagmi'
import '@rainbow-me/rainbowkit/styles.css'
import { config } from '../lib/wagmi-config'
import { BanCheckWrapper } from './components/BanCheckWrapper'
import Dashboard from './components/Dashboard'
import { ThemeProvider, useTheme } from './components/ThemeProvider'

const WagmiProvider = WagmiProviderBase as React.FC<
  React.PropsWithChildren<{ config: ReturnType<typeof getDefaultConfig> }>
>

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
