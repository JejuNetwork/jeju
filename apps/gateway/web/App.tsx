import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { config } from '../lib/wagmi-config'
import { BanCheckWrapper } from './components/BanCheckWrapper'
import Dashboard from './components/Dashboard'
import { ThemeProvider } from './components/ThemeProvider'

const queryClient = new QueryClient()

export default function App() {
  return (
    <ThemeProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <BanCheckWrapper>
            <Dashboard />
          </BanCheckWrapper>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  )
}
