import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { Sparkles, Plus, Grid3x3 } from 'lucide-react';
import RegisteredAppsList from './RegisteredAppsList';
import RegisterAppForm from './RegisterAppForm';
import AppDetailModal from './AppDetailModal';

export default function RegistryTab() {
  const { isConnected } = useAccount();
  const [activeSection, setActiveSection] = useState<'list' | 'register'>('list');
  const [selectedAppId, setSelectedAppId] = useState<bigint | null>(null);

  // Listen for navigation events from other components (e.g., FaucetTab)
  useEffect(() => {
    const handleNavigateToRegister = () => setActiveSection('register');
    window.addEventListener('navigate-to-register', handleNavigateToRegister);
    return () => window.removeEventListener('navigate-to-register', handleNavigateToRegister);
  }, []);

  if (!isConnected) {
    return (
      <div className="card hero-card animate-fade-in">
        <div className="hero-icon"><Sparkles size={36} /></div>
        <h2 className="hero-title">Agent Bazaar</h2>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="nav-tab-container" style={{ gridTemplateColumns: 'repeat(2, 1fr)', maxWidth: '240px', marginBottom: '1.5rem' }}>
        <button className={`button nav-tab ${activeSection === 'list' ? '' : 'button-secondary'}`} onClick={() => setActiveSection('list')}><Grid3x3 size={16} />Browse</button>
        <button className={`button nav-tab ${activeSection === 'register' ? '' : 'button-secondary'}`} onClick={() => setActiveSection('register')}><Plus size={16} />Register</button>
      </div>
      {activeSection === 'list' && <RegisteredAppsList onSelectApp={setSelectedAppId} />}
      {activeSection === 'register' && <RegisterAppForm />}
      {selectedAppId !== null && <AppDetailModal agentId={selectedAppId} onClose={() => setSelectedAppId(null)} />}
    </div>
  );
}
