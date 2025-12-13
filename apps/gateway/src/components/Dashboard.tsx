import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Wallet, Factory, DropletIcon, BarChart3, Zap, Server, Book, Waves, Activity, Tag, Sparkles, Droplet, Radio } from 'lucide-react';
import { ThemeToggle } from './ThemeProvider';
import TokenList from './TokenList';
import RegisterToken from './RegisterToken';
import DeployPaymaster from './DeployPaymaster';
import AddLiquidity from './AddLiquidity';
import LPDashboard from './LPDashboard';
import CrossChainTransfer from './CrossChainTransfer';
import XLPDashboard from './XLPDashboard';
import EILStats from './EILStats';
import MultiTokenBalanceDisplay from './MultiTokenBalanceDisplay';
import NodeStakingTab from './NodeStakingTab';
import RegistryTab from './RegistryTab';
import { IntentsTab } from './intents';
import JNSTab from './JNSTab';
import FaucetTab from './FaucetTab';
import { OracleTab } from './oracle';

type TabId = 'tokens' | 'deploy' | 'liquidity' | 'earnings' | 'transfer' | 'xlp' | 'nodes' | 'registry' | 'intents' | 'names' | 'faucet' | 'oracle';

const TABS: { id: TabId; icon: typeof Factory; label: string }[] = [
  { id: 'registry', icon: Book, label: 'Bazaar' },
  { id: 'faucet', icon: Droplet, label: 'Faucet' },
  { id: 'transfer', icon: Zap, label: 'Transfer' },
  { id: 'intents', icon: Activity, label: 'Intents' },
  { id: 'oracle', icon: Radio, label: 'Oracle' },
  { id: 'xlp', icon: Waves, label: 'XLP' },
  { id: 'tokens', icon: Factory, label: 'Tokens' },
  { id: 'deploy', icon: Factory, label: 'Deploy' },
  { id: 'liquidity', icon: DropletIcon, label: 'Liquidity' },
  { id: 'earnings', icon: BarChart3, label: 'Earnings' },
  { id: 'nodes', icon: Server, label: 'Nodes' },
  { id: 'names', icon: Tag, label: 'Names' },
];

export default function Dashboard() {
  const { isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<TabId>('registry');

  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="header">
        <div className="container header-content">
          <div className="header-brand"><Sparkles size={24} />Agent Bazaar</div>
          <div className="header-actions">
            <ThemeToggle />
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
          </div>
        </div>
      </header>

      <div className="container" style={{ paddingTop: '1.5rem' }}>
        {!isConnected ? (
          <div className="card hero-card animate-fade-in">
            <div className="hero-icon"><Wallet size={36} /></div>
            <h2 className="hero-title">Connect Wallet</h2>
            <ConnectButton />
          </div>
        ) : (
          <>
            <MultiTokenBalanceDisplay />
            <nav className="nav-tab-container">
              {TABS.map(({ id, icon: Icon, label }) => (
                <button key={id} className={`button nav-tab ${activeTab === id ? '' : 'button-secondary'}`} onClick={() => setActiveTab(id)}>
                  <Icon size={16} />{label}
                </button>
              ))}
            </nav>
            <div className="animate-fade-in">
              {activeTab === 'tokens' && <><TokenList /><div style={{ marginTop: '1.5rem' }}><RegisterToken /></div></>}
              {activeTab === 'transfer' && <><EILStats /><CrossChainTransfer /></>}
              {activeTab === 'xlp' && <XLPDashboard />}
              {activeTab === 'deploy' && <DeployPaymaster />}
              {activeTab === 'liquidity' && <AddLiquidity />}
              {activeTab === 'earnings' && <LPDashboard />}
              {activeTab === 'nodes' && <NodeStakingTab />}
              {activeTab === 'registry' && <RegistryTab />}
              {activeTab === 'intents' && <IntentsTab />}
              {activeTab === 'names' && <JNSTab />}
              {activeTab === 'faucet' && <FaucetTab />}
              {activeTab === 'oracle' && <OracleTab />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
