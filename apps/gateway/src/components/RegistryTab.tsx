/**
 * @fileoverview Registry tab for Gateway Portal - Agent/App discovery and registration
 * @module gateway/components/RegistryTab
 */

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Book, Plus, Grid3x3 } from 'lucide-react';
import RegisteredAppsList from './RegisteredAppsList';
import RegisterAppForm from './RegisterAppForm';
import AppDetailModal from './AppDetailModal';

export default function RegistryTab() {
  const { isConnected } = useAccount();
  const [activeSection, setActiveSection] = useState<'list' | 'register'>('list');
  const [selectedAppId, setSelectedAppId] = useState<bigint | null>(null);

  if (!isConnected) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <Book size={64} style={{ margin: '0 auto 1rem', color: '#667eea' }} />
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Agent & App Registry</h2>
        <p style={{ color: '#64748b', marginBottom: '2rem' }}>
          Discover and register apps, games, marketplaces, and services
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
          <strong>📚 ERC-8004 Registry:</strong> Discover apps, games, and services registered on Jeju. 
          Register your app with a small refundable stake (.001 ETH worth in any protocol token).
        </p>
      </div>

      {/* Section Navigation */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <button
          className={`button ${activeSection === 'list' ? '' : 'button-secondary'}`}
          onClick={() => setActiveSection('list')}
        >
          <Grid3x3 size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
          Browse Apps
        </button>
        <button
          className={`button ${activeSection === 'register' ? '' : 'button-secondary'}`}
          onClick={() => setActiveSection('register')}
        >
          <Plus size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
          Register App
        </button>
      </div>

      {/* Section Content */}
      {activeSection === 'list' && (
        <RegisteredAppsList onSelectApp={setSelectedAppId} />
      )}

      {activeSection === 'register' && (
        <RegisterAppForm />
      )}

      {/* App Detail Modal */}
      {selectedAppId && (
        <AppDetailModal 
          agentId={selectedAppId} 
          onClose={() => setSelectedAppId(null)} 
        />
      )}
    </div>
  );
}


