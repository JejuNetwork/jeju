/**
 * @fileoverview Main Node Staking tab for Gateway Portal
 * @module gateway/components/NodeStakingTab
 */

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Server, TrendingUp, Globe } from 'lucide-react';
import RegisterNodeForm from './RegisterNodeForm';
import MyNodesCard from './MyNodesCard';
import NetworkStatsCard from './NetworkStatsCard';

export default function NodeStakingTab() {
  const { isConnected } = useAccount();
  const [activeSection, setActiveSection] = useState<'overview' | 'register' | 'my-nodes'>('overview');

  if (!isConnected) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <Server size={64} style={{ margin: '0 auto 1rem', color: '#667eea' }} />
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Node Staking</h2>
        <p style={{ color: '#64748b', marginBottom: '2rem' }}>
          Stake ANY paymaster token, run a node, earn rewards
        </p>
        <p style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
          Connect your wallet to get started
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header Info */}
      <div style={{ padding: '1rem', background: '#dbeafe', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #3b82f6' }}>
        <p style={{ fontSize: '0.875rem', margin: 0, color: '#1e40af' }}>
          <strong>🖥️ Multi-Token Node Staking:</strong> Stake elizaOS, CLANKER, VIRTUAL, CLANKERMON, or any paymaster token. 
          Earn rewards in your chosen token. Paymasters earn sustainable ETH fees.
        </p>
      </div>

      {/* Section Navigation */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <button
          className={`button ${activeSection === 'overview' ? '' : 'button-secondary'}`}
          onClick={() => setActiveSection('overview')}
        >
          <Globe size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
          Network Overview
        </button>
        <button
          className={`button ${activeSection === 'my-nodes' ? '' : 'button-secondary'}`}
          onClick={() => setActiveSection('my-nodes')}
        >
          <Server size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
          My Nodes
        </button>
        <button
          className={`button ${activeSection === 'register' ? '' : 'button-secondary'}`}
          onClick={() => setActiveSection('register')}
        >
          <TrendingUp size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
          Register New Node
        </button>
      </div>

      {/* Section Content */}
      {activeSection === 'overview' && (
        <NetworkStatsCard />
      )}

      {activeSection === 'my-nodes' && (
        <MyNodesCard />
      )}

      {activeSection === 'register' && (
        <RegisterNodeForm />
      )}
    </div>
  );
}

