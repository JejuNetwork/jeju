import { Vote } from 'lucide-react';
import CreateQuestForm from './CreateQuestForm';
import { useVotingPower } from '../hooks/useGovernance';
import { formatTokenAmount } from '../lib/tokenUtils';

export default function GovernanceTab() {
  const { power } = useVotingPower();
  
  return (
    <div>
      <div style={{ padding: '1rem', background: 'var(--info-soft)', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid var(--info)' }}>
        <p style={{ fontSize: '0.875rem', margin: 0, color: 'var(--info)' }}>
          <strong>🏛️ Futarchy Governance:</strong> Prediction markets decide network parameters.
          Create quests, trade on outcomes, execute automatically if markets favor change.
        </p>
      </div>
      
      {power && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
            <Vote size={24} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Your Voting Power
          </h3>
          <div className="grid grid-3" style={{ gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Base Votes</p>
              <p style={{ fontSize: '1.5rem', fontWeight: '600', margin: '0.25rem 0' }}>
                {formatTokenAmount(power.baseVotes, 18, 0)}
              </p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Multiplier</p>
              <p style={{ fontSize: '1.5rem', fontWeight: '600', margin: '0.25rem 0' }}>
                {(power.reputationMultiplier * power.stakeMultiplier).toFixed(2)}x
              </p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Effective Votes</p>
              <p style={{ fontSize: '1.5rem', fontWeight: '600', margin: '0.25rem 0', color: 'var(--accent-primary)' }}>
                {formatTokenAmount(power.effectiveVotes, 18, 0)}
              </p>
            </div>
          </div>
        </div>
      )}

      <CreateQuestForm />
    </div>
  );
}


