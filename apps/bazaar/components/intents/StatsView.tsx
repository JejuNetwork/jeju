import { Activity, DollarSign, Users, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { useOIFStats } from '../../hooks/useIntentAPI';

export function StatsView() {
  const { data: stats, isLoading } = useOIFStats();

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
        Loading statistics...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
          OIF Analytics
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Real-time statistics for the Open Intents Framework
        </p>
      </div>

      {/* Main Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '20px',
        marginBottom: '32px',
      }}>
        <StatCard
          icon={<Activity size={24} />}
          iconBg="linear-gradient(135deg, var(--chain-jeju), var(--accent-tertiary))"
          title="Total Intents"
          value={stats?.totalIntents.toLocaleString() || '0'}
          subtitle={`${stats?.last24hIntents || 0} in last 24h`}
        />
        <StatCard
          icon={<DollarSign size={24} />}
          iconBg="linear-gradient(135deg, var(--accent-secondary), var(--warning))"
          title="Total Volume"
          value={`$${formatLargeNumber(parseFloat(stats?.totalVolumeUsd || '0'))}`}
          subtitle={`$${formatLargeNumber(parseFloat(stats?.last24hVolume || '0'))} in last 24h`}
        />
        <StatCard
          icon={<Users size={24} />}
          iconBg="linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))"
          title="Active Solvers"
          value={stats?.activeSolvers.toString() || '0'}
          subtitle={`${stats?.totalSolvers || 0} total registered`}
        />
        <StatCard
          icon={<CheckCircle size={24} />}
          iconBg="linear-gradient(135deg, var(--success-bright), var(--accent-tertiary))"
          title="Success Rate"
          value={`${stats?.successRate.toFixed(1) || 0}%`}
          subtitle="Across all routes"
        />
      </div>

      {/* Secondary Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
      }}>
        <MiniStat
          icon={<TrendingUp size={18} />}
          label="Total Fees"
          value={`$${formatLargeNumber(parseFloat(stats?.totalFeesUsd || '0'))}`}
        />
        <MiniStat
          icon={<Clock size={18} />}
          label="Avg Fill Time"
          value={`${stats?.avgFillTimeSeconds || 0}s`}
        />
        <MiniStat
          icon={<Activity size={18} />}
          label="Active Routes"
          value={stats?.activeRoutes.toString() || '0'}
        />
        <MiniStat
          icon={<DollarSign size={18} />}
          label="Solver Stake"
          value={formatETH(stats?.totalSolverStake || '0')}
        />
      </div>

      {/* Chain Breakdown */}
      <ChainVolumeBreakdown totalVolume={parseFloat(stats?.totalVolumeUsd || '0')} />
    </div>
  );
}

function ChainVolumeBreakdown({ totalVolume }: { totalVolume: number }) {
  if (totalVolume === 0) {
    return (
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-accent)',
        borderRadius: '16px',
        padding: '24px',
        backdropFilter: 'blur(8px)',
      }}>
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px', color: 'var(--text-primary)' }}>
          Volume by Chain
        </h3>
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
          <p>No volume data yet</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Chain volume breakdown will appear as intents are processed
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border-accent)',
      borderRadius: '16px',
      padding: '24px',
      backdropFilter: 'blur(8px)',
    }}>
      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px', color: 'var(--text-primary)' }}>
        Volume by Chain
      </h3>
      <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)' }}>
        <p>Total Volume: ${formatLargeNumber(totalVolume)}</p>
        <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
          Detailed per-chain breakdown requires indexer integration
        </p>
      </div>
    </div>
  );
}

function StatCard({ icon, iconBg, title, value, subtitle }: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-accent)',
        borderRadius: '16px',
        padding: '24px',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{
        width: '48px',
        height: '48px',
        borderRadius: '12px',
        background: iconBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '16px',
        color: 'white',
      }}>
        {icon}
      </div>
      <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
        {title}
      </div>
      <div style={{
        fontSize: '32px',
        fontWeight: 700,
        fontFamily: 'monospace',
        marginBottom: '8px',
        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
        {subtitle}
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border-accent)',
      borderRadius: '12px',
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ color: 'var(--accent-primary)' }}>{icon}</div>
      <div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{label}</div>
        <div style={{ fontSize: '18px', fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{value}</div>
      </div>
    </div>
  );
}


function formatLargeNumber(num: number): string {
  if (num >= 1000000000) return `${(num / 1000000000).toFixed(2)}B`;
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(0);
}

function formatETH(wei: string): string {
  const eth = parseFloat(wei) / 1e18;
  return `${eth.toFixed(2)} ETH`;
}



