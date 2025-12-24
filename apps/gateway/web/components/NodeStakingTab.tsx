import { Globe, type LucideProps, Server, TrendingUp } from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { useAccount } from 'wagmi'
import MyNodesCard from './MyNodesCard'
import NetworkStatsCard from './NetworkStatsCard'
import RegisterNodeForm from './RegisterNodeForm'

const ServerIcon = Server as ComponentType<LucideProps>
const GlobeIcon = Globe as ComponentType<LucideProps>
const TrendingUpIcon = TrendingUp as ComponentType<LucideProps>

export default function NodeStakingTab() {
  const { isConnected } = useAccount()
  const [activeSection, setActiveSection] = useState<
    'overview' | 'register' | 'my-nodes'
  >('overview')

  if (!isConnected) {
    return (
      <div className="card hero-card animate-fade-in">
        <div className="hero-icon">
          <ServerIcon size={36} />
        </div>
        <h2 className="hero-title">Node Staking</h2>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <div
        className="nav-tab-container"
        style={{
          gridTemplateColumns: 'repeat(3, 1fr)',
          maxWidth: '360px',
          marginBottom: '1.5rem',
        }}
      >
        <button
          type="button"
          className={`button nav-tab ${activeSection === 'overview' ? '' : 'button-secondary'}`}
          onClick={() => setActiveSection('overview')}
        >
          <GlobeIcon size={16} />
          Overview
        </button>
        <button
          type="button"
          className={`button nav-tab ${activeSection === 'my-nodes' ? '' : 'button-secondary'}`}
          onClick={() => setActiveSection('my-nodes')}
        >
          <ServerIcon size={16} />
          My Nodes
        </button>
        <button
          type="button"
          className={`button nav-tab ${activeSection === 'register' ? '' : 'button-secondary'}`}
          onClick={() => setActiveSection('register')}
        >
          <TrendingUpIcon size={16} />
          Register
        </button>
      </div>
      {activeSection === 'overview' && <NetworkStatsCard />}
      {activeSection === 'my-nodes' && <MyNodesCard />}
      {activeSection === 'register' && <RegisterNodeForm />}
    </div>
  )
}
