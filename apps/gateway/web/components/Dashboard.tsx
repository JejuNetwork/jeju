import { WalletButton } from '@jejunetwork/ui'
import {
  Activity,
  Book,
  Droplet,
  Factory,
  type LucideProps,
  Radio,
  Server,
  Shield,
  Sparkles,
  Waves,
  Zap,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { useAccount } from 'wagmi'
import { ThemeToggle } from './ThemeProvider'

// Fix for Lucide React 19 type compatibility
const FactoryIcon = Factory as ComponentType<LucideProps>
const SparklesIcon = Sparkles as ComponentType<LucideProps>
const BookIcon = Book as ComponentType<LucideProps>
const DropletIconComp = Droplet as ComponentType<LucideProps>
const ZapIcon = Zap as ComponentType<LucideProps>
const ActivityIcon = Activity as ComponentType<LucideProps>
const RadioIcon = Radio as ComponentType<LucideProps>
const WavesIcon = Waves as ComponentType<LucideProps>
const ServerIcon = Server as ComponentType<LucideProps>
const ShieldIcon = Shield as ComponentType<LucideProps>

import CrossChainTransfer from './CrossChainTransfer'
import DeployPaymaster from './DeployPaymaster'
import EILStats from './EILStats'
import FaucetTab from './FaucetTab'
import { IntentsTab } from './intents'
import MultiTokenBalanceDisplay from './MultiTokenBalanceDisplay'
import NodeStakingTab from './NodeStakingTab'
import { OracleTab } from './oracle'
import RegisterToken from './RegisterToken'
import RegistryTab from './RegistryTab'
import RiskAllocationDashboard from './RiskAllocationDashboard'
import TokenList from './TokenList'
import XLPDashboard from './XLPDashboard'

type TabId =
  | 'tokens'
  | 'deploy'
  | 'transfer'
  | 'xlp'
  | 'nodes'
  | 'registry'
  | 'intents'
  | 'faucet'
  | 'oracle'
  | 'risk'

const TABS: { id: TabId; icon: ComponentType<LucideProps>; label: string }[] = [
  { id: 'registry', icon: BookIcon, label: 'Registry' },
  { id: 'faucet', icon: DropletIconComp, label: 'Faucet' },
  { id: 'transfer', icon: ZapIcon, label: 'Transfer' },
  { id: 'intents', icon: ActivityIcon, label: 'Intents' },
  { id: 'oracle', icon: RadioIcon, label: 'Oracle' },
  { id: 'xlp', icon: WavesIcon, label: 'Liquidity' },
  { id: 'risk', icon: ShieldIcon, label: 'Risk Pools' },
  { id: 'tokens', icon: FactoryIcon, label: 'Tokens' },
  { id: 'deploy', icon: FactoryIcon, label: 'Deploy' },
  { id: 'nodes', icon: ServerIcon, label: 'Nodes' },
]

export default function Dashboard() {
  const { isConnected } = useAccount()
  const [activeTab, setActiveTab] = useState<TabId>('registry')

  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="header">
        <div className="container header-content">
          <div className="header-brand">
            <SparklesIcon size={24} />
            Gateway
          </div>
          <div className="header-actions">
            <ThemeToggle />
            <WalletButton />
          </div>
        </div>
      </header>

      <div className="container" style={{ paddingTop: '1.5rem' }}>
        {isConnected && <MultiTokenBalanceDisplay />}
        <nav className="nav-tab-container" aria-label="Main navigation">
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              type="button"
              key={id}
              className={`button nav-tab ${activeTab === id ? '' : 'button-secondary'}`}
              onClick={() => setActiveTab(id)}
              aria-current={activeTab === id ? 'page' : undefined}
              aria-label={`${label} section`}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <div className="animate-fade-in">
          {activeTab === 'tokens' && (
            <>
              <TokenList />
              <div style={{ marginTop: '1.5rem' }}>
                <RegisterToken />
              </div>
            </>
          )}
          {activeTab === 'transfer' && (
            <>
              <EILStats />
              <CrossChainTransfer />
            </>
          )}
          {activeTab === 'xlp' && <XLPDashboard />}
          {activeTab === 'deploy' && <DeployPaymaster />}
          {activeTab === 'nodes' && <NodeStakingTab />}
          {activeTab === 'registry' && <RegistryTab />}
          {activeTab === 'intents' && <IntentsTab />}
          {activeTab === 'faucet' && <FaucetTab />}
          {activeTab === 'oracle' && <OracleTab />}
          {activeTab === 'risk' && <RiskAllocationDashboard />}
        </div>
      </div>
    </div>
  )
}
