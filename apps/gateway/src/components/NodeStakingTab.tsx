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
      <div className="card hero-card animate-fade-in">
        <div className="hero-icon"><Server size={36} /></div>
        <h2 className="hero-title">Node Staking</h2>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="nav-tab-container" style={{ gridTemplateColumns: 'repeat(3, 1fr)', maxWidth: '360px', marginBottom: '1.5rem' }}>
        <button className={`button nav-tab ${activeSection === 'overview' ? '' : 'button-secondary'}`} onClick={() => setActiveSection('overview')}><Globe size={16} />Overview</button>
        <button className={`button nav-tab ${activeSection === 'my-nodes' ? '' : 'button-secondary'}`} onClick={() => setActiveSection('my-nodes')}><Server size={16} />My Nodes</button>
        <button className={`button nav-tab ${activeSection === 'register' ? '' : 'button-secondary'}`} onClick={() => setActiveSection('register')}><TrendingUp size={16} />Register</button>
      </div>
      {activeSection === 'overview' && <NetworkStatsCard />}
      {activeSection === 'my-nodes' && <MyNodesCard />}
      {activeSection === 'register' && <RegisterNodeForm />}
    </div>
  );
}
