import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { INDEXER_URL } from '../config';

interface EILStatsData {
  totalVolumeEth: string;
  totalTransactions: number;
  activeXLPs: number;
  totalStakedEth: string;
  successRate: number;
  avgTimeSeconds: number;
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

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum', 11155111: 'Sepolia', 42161: 'Arbitrum', 10: 'Optimism', 420691: 'Jeju', 420690: 'Jeju Testnet',
};

async function fetchEILStats(): Promise<{ stats: EILStatsData; chainStats: EILChainStats[] }> {
  const query = `
    query EILStats {
      xlps(where: { isActive_eq: true }) {
        id
        totalStaked
        supportedChains
        totalVouchersIssued
        totalVouchersFulfilled
        totalVouchersFailed
        totalFeesEarned
      }
      crossChainVoucherRequests {
        id
        sourceAmount
        sourceChain
        status
      }
    }
  `;

  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    return { stats: emptyStats(), chainStats: [] };
  }

  const { data, errors } = await response.json();
  
  if (errors || !data) {
    return { stats: emptyStats(), chainStats: [] };
  }

  const xlps = data.xlps || [];
  const requests = data.crossChainVoucherRequests || [];
  
  const activeXLPs = xlps.length;
  const totalStakedWei = xlps.reduce((sum: bigint, x: { totalStaked: string }) => sum + BigInt(x.totalStaked || '0'), 0n);
  const totalStakedEth = (Number(totalStakedWei) / 1e18).toFixed(2);
  
  const fulfilled = requests.filter((r: { status: string }) => r.status === 'FULFILLED').length;
  const failed = requests.filter((r: { status: string }) => r.status === 'EXPIRED' || r.status === 'REFUNDED').length;
  const totalCompleted = fulfilled + failed;
  const successRate = totalCompleted > 0 ? Math.round((fulfilled / totalCompleted) * 1000) / 10 : 0;
  
  const totalVolumeWei = requests.reduce((sum: bigint, r: { sourceAmount: string }) => sum + BigInt(r.sourceAmount || '0'), 0n);
  const totalVolumeEth = (Number(totalVolumeWei) / 1e18).toFixed(2);

  const chainVolumes = new Map<number, { volume: bigint; transfers: number; xlps: Set<string> }>();
  for (const req of requests) {
    const chain = req.sourceChain;
    const current = chainVolumes.get(chain) || { volume: 0n, transfers: 0, xlps: new Set<string>() };
    current.volume += BigInt(req.sourceAmount || '0');
    current.transfers += 1;
    chainVolumes.set(chain, current);
  }
  
  for (const xlp of xlps) {
    for (const chainId of xlp.supportedChains || []) {
      const chain = Number(chainId);
      const current = chainVolumes.get(chain) || { volume: 0n, transfers: 0, xlps: new Set<string>() };
      current.xlps.add(xlp.id);
      chainVolumes.set(chain, current);
    }
  }

  const chainStats: EILChainStats[] = Array.from(chainVolumes.entries()).map(([chainId, data]) => ({
    chainId,
    chainName: CHAIN_NAMES[chainId] || `Chain ${chainId}`,
    totalVolume: (Number(data.volume) / 1e18).toFixed(2),
    totalTransfers: data.transfers,
    activeXLPs: data.xlps.size,
  })).sort((a, b) => parseFloat(b.totalVolume) - parseFloat(a.totalVolume));

  return {
    stats: {
      totalVolumeEth,
      totalTransactions: requests.length,
      activeXLPs,
      totalStakedEth,
      successRate,
      avgTimeSeconds: 0,
    },
    chainStats,
  };
}

function emptyStats(): EILStatsData {
  return { totalVolumeEth: '0', totalTransactions: 0, activeXLPs: 0, totalStakedEth: '0', successRate: 0, avgTimeSeconds: 0 };
}

export default function EILStats() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['eil-stats'],
    queryFn: fetchEILStats,
    refetchInterval: 30000,
  });

  const stats = data?.stats || null;
  const chainStats = data?.chainStats || [];

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
        <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Loading EIL stats...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
        <p style={{ color: 'var(--error)' }}>Failed to load EIL stats</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Indexer may be unavailable</p>
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
        <StatCard label="Total Volume" value={`${stats.totalVolumeEth} ETH`} subtext={`${stats.totalTransactions} transfers`} variant="info" icon="📊" />
        <StatCard label="Active XLPs" value={stats.activeXLPs.toString()} subtext={`${stats.totalStakedEth} ETH staked`} variant="success" icon="🌊" />
        <StatCard label="Success Rate" value={stats.totalTransactions > 0 ? `${stats.successRate}%` : '-'} subtext={`${stats.totalTransactions.toLocaleString()} txns`} variant="accent" icon="✓" />
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
