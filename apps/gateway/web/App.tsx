import { OAuth3Provider } from '@jejunetwork/auth/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { CHAIN_ID, OAUTH3_AGENT_URL, RPC_URL } from '../lib/config'
import { config } from '../lib/wagmi-config'
import { BanCheckWrapper } from './components/BanCheckWrapper'
// Lazy load route components for better performance
import CrossChainTransfer from './components/CrossChainTransfer'
import DeployPaymaster from './components/DeployPaymaster'
import EILStats from './components/EILStats'
import { ErrorBoundary } from './components/ErrorBoundary'
import FaucetTab from './components/FaucetTab'
import { IntentsTab } from './components/intents'
import Layout from './components/Layout'
import NodeStakingTab from './components/NodeStakingTab'
import { OnboardingWizard } from './components/OnboardingWizard'
import { OracleTab } from './components/oracle'
import RegisterToken from './components/RegisterToken'
import RegistryTab from './components/RegistryTab'
import RiskAllocationDashboard from './components/RiskAllocationDashboard'
import SettingsPage from './components/SettingsPage'
import { ThemeProvider } from './components/ThemeProvider'
import { ToastProvider } from './components/Toast'
import TokenList from './components/TokenList'
import XLPDashboard from './components/XLPDashboard'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

// Page wrapper components for cleaner routing
function TransferPage() {
  return (
    <>
      <EILStats />
      <CrossChainTransfer />
    </>
  )
}

function TokensPage() {
  return (
    <>
      <TokenList />
      <div style={{ marginTop: '1.5rem' }}>
        <RegisterToken />
      </div>
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <OAuth3Provider
              config={{
                appId: 'gateway.apps.jeju',
                redirectUri: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
                chainId: CHAIN_ID,
                rpcUrl: RPC_URL,
                teeAgentUrl: OAUTH3_AGENT_URL,
              }}
            >
              <ToastProvider>
                <BanCheckWrapper>
                  <BrowserRouter>
                    <OnboardingWizard />
                    <Routes>
                      <Route
                        path="/"
                        element={
                          <Layout>
                            <Navigate to="/registry" replace />
                          </Layout>
                        }
                      />
                      <Route
                        path="/registry"
                        element={
                          <Layout>
                            <RegistryTab />
                          </Layout>
                        }
                      />
                      <Route
                        path="/faucet"
                        element={
                          <Layout>
                            <FaucetTab />
                          </Layout>
                        }
                      />
                      <Route
                        path="/transfer"
                        element={
                          <Layout>
                            <TransferPage />
                          </Layout>
                        }
                      />
                      <Route
                        path="/intents"
                        element={
                          <Layout>
                            <IntentsTab />
                          </Layout>
                        }
                      />
                      <Route
                        path="/liquidity"
                        element={
                          <Layout>
                            <XLPDashboard />
                          </Layout>
                        }
                      />
                      <Route
                        path="/nodes"
                        element={
                          <Layout>
                            <NodeStakingTab />
                          </Layout>
                        }
                      />
                      <Route
                        path="/oracle"
                        element={
                          <Layout>
                            <OracleTab />
                          </Layout>
                        }
                      />
                      <Route
                        path="/risk"
                        element={
                          <Layout>
                            <RiskAllocationDashboard />
                          </Layout>
                        }
                      />
                      <Route
                        path="/tokens"
                        element={
                          <Layout>
                            <TokensPage />
                          </Layout>
                        }
                      />
                      <Route
                        path="/deploy"
                        element={
                          <Layout>
                            <DeployPaymaster />
                          </Layout>
                        }
                      />
                      <Route
                        path="/settings"
                        element={
                          <Layout>
                            <SettingsPage />
                          </Layout>
                        }
                      />
                      {/* Catch-all redirect */}
                      <Route
                        path="*"
                        element={<Navigate to="/registry" replace />}
                      />
                    </Routes>
                  </BrowserRouter>
                </BanCheckWrapper>
              </ToastProvider>
            </OAuth3Provider>
          </QueryClientProvider>
        </WagmiProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
