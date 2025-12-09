import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';

interface EILStatsData {
  totalVolumeEth: string;
  totalTransactions: number;
  activeXLPs: number;
  totalStakedEth: string;
  successRate: number;
  avgTimeSeconds: number;
  last24hVolume: string;
  last24hTransactions: number;
}

interface EILChainStats {
  chainId: number;
  chainName: string;
  totalVolume: string;
  totalTransfers: number;
  activeXLPs: number;
}

const CHAIN_ICONS: Record<number, string> = {
  1: '💎', 11155111: '🧪', 42161: '🟠', 10: '🔴', 420691: '🏝️', 420690: '🏝️',
};

export default function EILStats() {
  const [stats, setStats] = useState<EILStatsData | null>(null);
  const [chainStats, setChainStats] = useState<EILChainStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      setIsLoading(true);
      const mockStats: EILStatsData = {
        totalVolumeEth: '1234.56', totalTransactions: 5678, activeXLPs: 12, totalStakedEth: '500.00',
        successRate: 99.2, avgTimeSeconds: 8.5, last24hVolume: '123.45', last24hTransactions: 456,
      };
      const mockChainStats: EILChainStats[] = [
        { chainId: 420691, chainName: 'Jeju', totalVolume: '500.00', totalTransfers: 2000, activeXLPs: 10 },
        { chainId: 1, chainName: 'Ethereum', totalVolume: '400.00', totalTransfers: 1500, activeXLPs: 8 },
        { chainId: 42161, chainName: 'Arbitrum', totalVolume: '200.00', totalTransfers: 1000, activeXLPs: 6 },
        { chainId: 10, chainName: 'Optimism', totalVolume: '134.56', totalTransfers: 1178, activeXLPs: 5 },
      ];
      await new Promise(resolve => setTimeout(resolve, 500));
      setStats(mockStats);
      setChainStats(mockChainStats);
      setIsLoading(false);
    }
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
        <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Loading EIL stats...</p>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ width: 36, height: 36, background: 'var(--gradient-brand)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Zap size={18} color="white" />
        </div>
        <h2 className="section-title" style={{ margin: 0 }}>EIL Protocol</h2>
        <span className="badge badge-success">Live</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <StatCard label="24h Volume" value={`${stats.last24hVolume} ETH`} subtext={`${stats.last24hTransactions} transfers`} variant="info" icon="📊" />
        <StatCard label="Active XLPs" value={stats.activeXLPs.toString()} subtext={`${stats.totalStakedEth} ETH staked`} variant="success" icon="🌊" />
        <StatCard label="Success Rate" value={`${stats.successRate}%`} subtext={`${stats.totalTransactions.toLocaleString()} txns`} variant="accent" icon="✓" />
        <StatCard label="Avg Time" value={`${stats.avgTimeSeconds}s`} variant="warning" icon="⚡" />
      </div>

      <div className="card" style={{ padding: '1rem' }}>
        <h3 style={{ fontSize: '0.9375rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Cross-Chain Activity</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '0.5rem' }}>
          {chainStats.map((chain) => (
            <div key={chain.chainId} className="stat-card" style={{ padding: '0.75rem' }}>
              <div style={{ fontSize: '1.25rem', marginBottom: '0.125rem' }}>{CHAIN_ICONS[chain.chainId] || '🔗'}</div>
              <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{chain.chainName}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{chain.totalVolume} ETH</div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{chain.totalTransfers.toLocaleString()} txns</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, subtext, variant, icon }: { label: string; value: string; subtext?: string; variant: 'info' | 'success' | 'accent' | 'warning'; icon: string }) {
  const colors = { info: 'var(--info)', success: 'var(--success)', accent: 'var(--accent-primary)', warning: 'var(--warning)' };
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${colors[variant]}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{label}</p>
          <p style={{ fontSize: '1.375rem', fontWeight: 800, margin: '0.25rem 0', color: colors[variant], fontFamily: 'var(--font-mono)' }}>{value}</p>
          {subtext && <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', margin: 0 }}>{subtext}</p>}
        </div>
        <span style={{ fontSize: '1.25rem', opacity: 0.6 }}>{icon}</span>
      </div>
    </div>
  );
}
