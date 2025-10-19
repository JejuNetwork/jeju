/**
 * @fileoverview Futarchy governance tab
 * @module gateway/components/GovernanceTab
 */

import { Vote } from 'lucide-react';
import CreateQuestForm from './CreateQuestForm';
import { useVotingPower } from '../hooks/useGovernance';
import { formatTokenAmount } from '../lib/tokenUtils';

export default function GovernanceTab() {
  const { votingPower } = useVotingPower();
  
  return (
    <div>
      <div style={{ padding: '1rem', background: '#dbeafe', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #3b82f6' }}>
        <p style={{ fontSize: '0.875rem', margin: 0, color: '#1e40af' }}>
          <strong>🏛️ Futarchy Governance:</strong> Prediction markets decide network parameters.
          Create quests, trade on outcomes, execute automatically if markets favor change.
        </p>
      </div>
      
      {votingPower && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
            <Vote size={24} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Your Voting Power
          </h3>
          <div className="grid grid-3" style={{ gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>From Nodes</p>
              <p style={{ fontSize: '1.5rem', fontWeight: '600', margin: '0.25rem 0' }}>
                {formatTokenAmount(votingPower.fromNodeStaking, 18, 0)}
              </p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>From LPs</p>
              <p style={{ fontSize: '1.5rem', fontWeight: '600', margin: '0.25rem 0' }}>
                {formatTokenAmount(votingPower.fromLPPositions, 18, 0)}
              </p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Total Power</p>
              <p style={{ fontSize: '1.5rem', fontWeight: '600', margin: '0.25rem 0', color: '#667eea' }}>
                {formatTokenAmount(votingPower.total, 18, 0)}
              </p>
            </div>
          </div>
        </div>
      )}

      <CreateQuestForm />

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Parameter to Change
          </label>
          <select className="input">
            <option value="">Select parameter...</option>
            <option value="geographicBonusBPS">Geographic Bonus</option>
            <option value="tokenDiversityBonusBPS">Token Diversity Bonus</option>
            <option value="volumeBonusPerThousandRequests">Volume Bonus Rate</option>
          </select>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Proposed Value
          </label>
          <input className="input" type="number" placeholder="New value (basis points)" />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Metric Question
          </label>
          <input
            className="input"
            type="text"
            placeholder="e.g., 'Network uptime will improve'"
          />
          <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            This creates two prediction markets: one for change scenario, one for status quo
          </p>
        </div>

    </div>
  );
}


