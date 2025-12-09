import { Activity, DollarSign, Users, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { useOIFStats } from '../hooks/useOIF';

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
        <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>
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
          iconBg="linear-gradient(135deg, #64ffda, #00d4ff)"
          title="Total Intents"
          value={stats?.totalIntents.toLocaleString() || '0'}
          subtitle={`${stats?.last24hIntents || 0} in last 24h`}
        />
        <StatCard
          icon={<DollarSign size={24} />}
          iconBg="linear-gradient(135deg, #ff6ec4, #ff9f43)"
          title="Total Volume"
          value={`$${formatLargeNumber(parseFloat(stats?.totalVolumeUsd || '0'))}`}
          subtitle={`$${formatLargeNumber(parseFloat(stats?.last24hVolume || '0'))} in last 24h`}
        />
        <StatCard
          icon={<Users size={24} />}
          iconBg="linear-gradient(135deg, #9d4edd, #c77dff)"
          title="Active Solvers"
          value={stats?.activeSolvers.toString() || '0'}
          subtitle={`${stats?.totalSolvers || 0} total registered`}
        />
        <StatCard
          icon={<CheckCircle size={24} />}
          iconBg="linear-gradient(135deg, #00ff88, #00d4aa)"
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
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '16px',
        padding: '24px',
        backdropFilter: 'blur(8px)',
      }}>
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px' }}>
          Volume by Chain
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <ChainBar name="Ethereum" percentage={45} color="#627eea" volume="$2.25M" />
          <ChainBar name="Arbitrum" percentage={30} color="#28a0f0" volume="$1.5M" />
          <ChainBar name="Optimism" percentage={15} color="#ff0420" volume="$750K" />
          <ChainBar name="Jeju" percentage={10} color="#64ffda" volume="$500K" />
        </div>
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
      className="animate-slide-in"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
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
        fontFamily: 'var(--font-mono)',
        marginBottom: '8px',
        background: 'linear-gradient(135deg, var(--text-primary), var(--text-accent))',
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
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '12px',
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ color: 'var(--text-accent)' }}>{icon}</div>
      <div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{label}</div>
        <div style={{ fontSize: '18px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{value}</div>
      </div>
    </div>
  );
}

function ChainBar({ name, percentage, color, volume }: {
  name: string;
  percentage: number;
  color: string;
  volume: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
          <span style={{ fontWeight: 500 }}>{name}</span>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-accent)' }}>{volume}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{percentage}%</span>
        </div>
      </div>
      <div style={{
        height: '8px',
        background: 'var(--bg-tertiary)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${percentage}%`,
          background: `linear-gradient(90deg, ${color}, ${color}aa)`,
          borderRadius: '4px',
          transition: 'width 0.5s ease',
        }} />
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

