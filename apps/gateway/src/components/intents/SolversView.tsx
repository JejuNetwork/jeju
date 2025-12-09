/**
 * @fileoverview SolversView - Display active solvers and leaderboard
 * Migrated from apps/intents/viewer
 */

import { Star, Activity, Clock, TrendingUp, Shield } from 'lucide-react';
import { useSolvers, useSolverLeaderboard } from '../../hooks/useIntentAPI';
import type { Solver } from '@jejunetwork/types/oif';

export function SolversView() {
  const { data: solvers, isLoading } = useSolvers({ active: true });
  const { data: leaderboard } = useSolverLeaderboard('volume');

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
          Active Solvers
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Registered solvers providing liquidity and filling intents
        </p>
      </div>

      {/* Leaderboard */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-accent)',
        borderRadius: '16px',
        padding: '24px',
        marginBottom: '24px',
        backdropFilter: 'blur(8px)',
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
          <TrendingUp size={18} color="var(--accent-primary)" />
          Top Solvers by Volume
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {leaderboard?.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
              No solvers registered yet
            </div>
          ) : leaderboard?.slice(0, 5).map((entry, index) => (
            <div
              key={entry.solver}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: index === 0 ? 'linear-gradient(90deg, var(--accent-primary-soft), transparent)' : 'var(--accent-primary-soft)',
                borderRadius: '8px',
                border: index === 0 ? '1px solid var(--border-accent)' : '1px solid transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: index === 0 ? 'var(--accent-primary)' : 'var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: index === 0 ? 'white' : 'var(--text-secondary)',
                }}>
                  {entry.rank}
                </div>
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{entry.name}</div>
                  <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                    {entry.solver.slice(0, 10)}...
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                    ${formatNumber(parseFloat(entry.totalVolume))}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Volume</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{entry.totalFills}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Fills</div>
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  background: `${getReputationColor(entry.reputation)}20`,
                  borderRadius: '4px',
                }}>
                  <Star size={12} color={getReputationColor(entry.reputation)} />
                  <span style={{ fontSize: '12px', fontWeight: 500, color: getReputationColor(entry.reputation) }}>
                    {entry.reputation}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Solver Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
        gap: '16px',
      }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            Loading solvers...
          </div>
        ) : solvers?.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            No solvers registered yet
          </div>
        ) : (
          solvers?.map((solver) => (
            <SolverCard key={solver.address} solver={solver} />
          ))
        )}
      </div>
    </div>
  );
}

function SolverCard({ solver }: { solver: Solver }) {
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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Shield size={24} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '16px', color: 'var(--text-primary)' }}>{solver.name}</div>
            <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
              {solver.address.slice(0, 10)}...{solver.address.slice(-8)}
            </div>
          </div>
        </div>
        <ReputationBadge score={solver.reputation} />
      </div>

      {/* Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '12px',
        marginBottom: '16px',
      }}>
        <StatBox icon={<Activity size={14} />} label="Total Fills" value={solver.totalFills.toString()} />
        <StatBox icon={<Clock size={14} />} label="Avg Time" value={`${(solver.avgFillTimeMs / 1000).toFixed(1)}s`} />
        <StatBox label="Success Rate" value={`${solver.successRate}%`} positive />
        <StatBox label="Total Volume" value={`$${formatNumber(parseFloat(solver.totalVolumeUsd))}`} />
      </div>

      {/* Chains */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
      }}>
        {solver.supportedChains.map((chainId) => (
          <div
            key={chainId}
            style={{
              padding: '4px 8px',
              background: 'var(--accent-primary-soft)',
              borderRadius: '4px',
              fontSize: '11px',
              fontFamily: 'monospace',
              color: 'var(--text-secondary)',
            }}
          >
            Chain {chainId}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReputationBadge({ score }: { score: number }) {
  const color = getReputationColor(score);
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 12px',
      background: `${color}20`,
      border: `1px solid ${color}40`,
      borderRadius: '20px',
    }}>
      <Star size={14} color={color} />
      <span style={{ fontSize: '14px', fontWeight: 600, color }}>{score}</span>
    </div>
  );
}

function StatBox({ icon, label, value, positive }: { icon?: React.ReactNode; label: string; value: string; positive?: boolean }) {
  return (
    <div style={{
      padding: '12px',
      background: 'var(--accent-primary-soft)',
      borderRadius: '8px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
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
        fontFamily: 'monospace',
        color: positive ? 'var(--success-bright)' : 'var(--text-primary)',
      }}>
        {value}
      </div>
    </div>
  );
}

function getReputationColor(score: number): string {
  if (score >= 90) return 'var(--success-bright)';
  if (score >= 70) return 'var(--accent-primary)';
  if (score >= 50) return 'var(--warning-bright)';
  return 'var(--error-bright)';
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(0);
}


