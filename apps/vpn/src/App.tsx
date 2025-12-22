import { useState } from 'react';
import { Shield, Globe, Activity, Settings, Users, HardDrive } from 'lucide-react';
import { VPNToggle } from './components/VPNToggle';
import { RegionSelector } from './components/RegionSelector';
import { ConnectionStats } from './components/ConnectionStats';
import { ContributionPanel } from './components/ContributionPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { useVPNStatus, useVPNNodes, useVPNConnection } from './hooks';

type Tab = 'vpn' | 'contribution' | 'settings';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('vpn');
  const { status: vpnStatus } = useVPNStatus();
  const { nodes, selectedNode, selectNode: handleSelectNode } = useVPNNodes();
  const { connect, disconnect, isLoading } = useVPNConnection();

  const handleConnect = async () => {
    if (vpnStatus.status === 'Connected') {
      await disconnect();
    } else {
      await connect(selectedNode);
    }
  };

  const isConnected = vpnStatus.status === 'Connected';

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a35]">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${isConnected ? 'bg-[#00ff88]/10' : 'bg-[#2a2a35]'}`}>
            <Shield className={`w-6 h-6 ${isConnected ? 'text-[#00ff88]' : 'text-[#606070]'}`} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Jeju VPN</h1>
            <p className="text-xs text-[#606070]">Decentralized Privacy</p>
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
          isConnected 
            ? 'bg-[#00ff88]/10 text-[#00ff88]' 
            : vpnStatus.status === 'Connecting' 
              ? 'bg-yellow-500/10 text-yellow-500'
              : 'bg-[#2a2a35] text-[#606070]'
        }`}>
          {vpnStatus.status}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'vpn' && (
          <div className="p-6 space-y-6">
            {/* VPN Toggle */}
            <VPNToggle 
              isConnected={isConnected}
              isLoading={isLoading}
              onToggle={handleConnect}
            />

            {/* Selected Node / Region */}
            <RegionSelector
              nodes={nodes}
              selectedNode={selectedNode}
              onSelectNode={handleSelectNode}
              disabled={isConnected}
            />

            {/* Connection Stats */}
            {isConnected && vpnStatus.connection && (
              <ConnectionStats connection={vpnStatus.connection} />
            )}

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="card text-center">
                <Globe className="w-5 h-5 mx-auto mb-2 text-[#00ff88]" />
                <div className="text-lg font-semibold">{nodes.length}</div>
                <div className="text-xs text-[#606070]">Nodes</div>
              </div>
              <div className="card text-center">
                <Users className="w-5 h-5 mx-auto mb-2 text-[#00cc6a]" />
                <div className="text-lg font-semibold">1.2K</div>
                <div className="text-xs text-[#606070]">Users</div>
              </div>
              <div className="card text-center">
                <HardDrive className="w-5 h-5 mx-auto mb-2 text-[#00aa55]" />
                <div className="text-lg font-semibold">42 TB</div>
                <div className="text-xs text-[#606070]">CDN Cache</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'contribution' && <ContributionPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>

      {/* Bottom Navigation */}
      <nav className="flex items-center justify-around border-t border-[#2a2a35] py-3">
        <button
          onClick={() => setActiveTab('vpn')}
          className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-colors ${
            activeTab === 'vpn' ? 'text-[#00ff88]' : 'text-[#606070] hover:text-white'
          }`}
        >
          <Shield className="w-5 h-5" />
          <span className="text-xs">VPN</span>
        </button>
        <button
          onClick={() => setActiveTab('contribution')}
          className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-colors ${
            activeTab === 'contribution' ? 'text-[#00ff88]' : 'text-[#606070] hover:text-white'
          }`}
        >
          <Activity className="w-5 h-5" />
          <span className="text-xs">Contribute</span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-colors ${
            activeTab === 'settings' ? 'text-[#00ff88]' : 'text-[#606070] hover:text-white'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-xs">Settings</span>
        </button>
      </nav>
    </div>
  );
}

export default App;

