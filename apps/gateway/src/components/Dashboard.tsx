import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Wallet, Factory, DropletIcon, BarChart3, Combine, Server, Book } from 'lucide-react';
import TokenList from './TokenList';
import RegisterToken from './RegisterToken';
import DeployPaymaster from './DeployPaymaster';
import AddLiquidity from './AddLiquidity';
import LPDashboard from './LPDashboard';
import BridgeToken from './BridgeToken';
import MultiTokenBalanceDisplay from './MultiTokenBalanceDisplay';
import NodeStakingTab from './NodeStakingTab';
import RegistryTab from './RegistryTab';

export default function Dashboard() {
  const { isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<'tokens' | 'deploy' | 'liquidity' | 'earnings' | 'bridge' | 'nodes' | 'registry'>('tokens');

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      {/* Header */}
      <header style={{
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(102, 126, 234, 0.2)',
        padding: '1rem 0'
      }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#667eea', margin: 0 }}>
              🌉 Gateway Portal
            </h1>
            <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Protocol Infrastructure Hub - Tokens, Nodes, Liquidity
            </p>
          </div>
          <ConnectButton />
        </div>
      </header>

      {/* Content */}
      <div className="container" style={{ paddingTop: '2rem' }}>
        {!isConnected ? (
          <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <Wallet size={64} style={{ margin: '0 auto 1rem', color: '#667eea' }} />
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Connect Your Wallet</h2>
            <p style={{ color: '#64748b', marginBottom: '2rem' }}>
              Bridge tokens from Base, deploy paymasters, add liquidity, and earn token rewards
            </p>
            <ConnectButton />
          </div>
        ) : (
          <>
            {/* Show Token Balances at the top */}
            <MultiTokenBalanceDisplay />

            {/* Navigation Tabs */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
              <button
                className={`button ${activeTab === 'tokens' ? '' : 'button-secondary'}`}
                onClick={() => setActiveTab('tokens')}
              >
                <Factory size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Registered Tokens
              </button>
              <button
                className={`button ${activeTab === 'bridge' ? '' : 'button-secondary'}`}
                onClick={() => setActiveTab('bridge')}
              >
                <Combine size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Bridge from Base
              </button>
              <button
                className={`button ${activeTab === 'deploy' ? '' : 'button-secondary'}`}
                onClick={() => setActiveTab('deploy')}
              >
                <Factory size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Deploy Paymaster
              </button>
              <button
                className={`button ${activeTab === 'liquidity' ? '' : 'button-secondary'}`}
                onClick={() => setActiveTab('liquidity')}
              >
                <DropletIcon size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Add Liquidity
              </button>
              <button
                className={`button ${activeTab === 'earnings' ? '' : 'button-secondary'}`}
                onClick={() => setActiveTab('earnings')}
              >
                <BarChart3 size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                My Earnings
              </button>
              <button
                className={`button ${activeTab === 'nodes' ? '' : 'button-secondary'}`}
                onClick={() => setActiveTab('nodes')}
              >
                <Server size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Node Operators
              </button>
              <button
                className={`button ${activeTab === 'registry' ? '' : 'button-secondary'}`}
                onClick={() => setActiveTab('registry')}
              >
                <Book size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                App Registry
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'tokens' && (
              <div>
                <TokenList />
                <div style={{ marginTop: '2rem' }}>
                  <RegisterToken />
                </div>
              </div>
            )}
            {activeTab === 'bridge' && <BridgeToken />}
            {activeTab === 'deploy' && <DeployPaymaster />}
            {activeTab === 'liquidity' && <AddLiquidity />}
            {activeTab === 'earnings' && <LPDashboard />}
            {activeTab === 'nodes' && <NodeStakingTab />}
            {activeTab === 'registry' && <RegistryTab />}
          </>
        )}
      </div>
    </div>
  );
}


