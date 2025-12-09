import { ArrowRight, Activity, Clock, CheckCircle } from 'lucide-react';
import { useRoutes } from '../hooks/useOIF';
import type { IntentRoute } from '../../../../../types/oif';

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  11155111: 'Sepolia',
  42161: 'Arbitrum',
  10: 'Optimism',
  420691: 'Jeju',
  420690: 'Jeju Testnet',
};

const CHAIN_COLORS: Record<number, string> = {
  1: '#627eea',
  11155111: '#8b5cf6',
  42161: '#28a0f0',
  10: '#ff0420',
  420691: '#64ffda',
};

export function RoutesView() {
  const { data: routes, isLoading } = useRoutes({ active: true });

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>
          Cross-Chain Routes
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Available paths for cross-chain intents with real-time statistics
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
        gap: '16px',
      }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            Loading routes...
          </div>
        ) : (
          routes?.map((route) => (
            <RouteCard key={route.routeId} route={route} />
          ))
        )}
      </div>
    </div>
  );
}

function RouteCard({ route }: { route: IntentRoute }) {
  const sourceChain = CHAIN_NAMES[route.sourceChainId] || `Chain ${route.sourceChainId}`;
  const destChain = CHAIN_NAMES[route.destinationChainId] || `Chain ${route.destinationChainId}`;
  const sourceColor = CHAIN_COLORS[route.sourceChainId] || 'var(--text-secondary)';
  const destColor = CHAIN_COLORS[route.destinationChainId] || 'var(--text-secondary)';

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
      {/* Route Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ChainIcon color={sourceColor} />
          <div style={{ fontWeight: 600 }}>{sourceChain}</div>
          <ArrowRight size={20} color="var(--text-secondary)" />
          <ChainIcon color={destColor} />
          <div style={{ fontWeight: 600 }}>{destChain}</div>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: route.isActive ? 'var(--success)20' : 'var(--text-secondary)20',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: 500,
          color: route.isActive ? 'var(--success)' : 'var(--text-secondary)',
        }}>
          <div style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: route.isActive ? 'var(--success)' : 'var(--text-secondary)',
          }} />
          {route.isActive ? 'Active' : 'Inactive'}
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '16px',
        marginBottom: '16px',
      }}>
        <StatItem
          icon={<Activity size={14} />}
          label="Volume"
          value={formatVolume(route.totalVolume)}
        />
        <StatItem
          icon={<Clock size={14} />}
          label="Avg Time"
          value={`${route.avgFillTimeSeconds}s`}
        />
        <StatItem
          icon={<CheckCircle size={14} />}
          label="Success"
          value={`${route.successRate.toFixed(1)}%`}
        />
      </div>

      {/* Additional Info */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '12px',
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        fontSize: '12px',
      }}>
        <div>
          <div style={{ color: 'var(--text-secondary)' }}>Oracle</div>
          <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>{route.oracle}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--text-secondary)' }}>Solvers</div>
          <div style={{ fontWeight: 500 }}>{route.activeSolvers}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: 'var(--text-secondary)' }}>Fee</div>
          <div style={{ fontWeight: 500 }}>{(route.avgFeePercent / 100).toFixed(2)}%</div>
        </div>
      </div>
    </div>
  );
}

function ChainIcon({ color }: { color: string }) {
  return (
    <div style={{
      width: '32px',
      height: '32px',
      borderRadius: '8px',
      background: `${color}20`,
      border: `2px solid ${color}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        background: color,
      }} />
    </div>
  );
}

function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        color: 'var(--text-secondary)',
        fontSize: '11px',
        marginBottom: '4px',
      }}>
        {icon}
        {label}
      </div>
      <div style={{
        fontSize: '16px',
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-accent)',
      }}>
        {value}
      </div>
    </div>
  );
}

function formatVolume(volume: string): string {
  const value = parseFloat(volume) / 1e18;
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(2);
}

