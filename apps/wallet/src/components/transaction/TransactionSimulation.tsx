/**
 * Transaction Simulation Display Component
 * Shows what will happen when a transaction is executed
 */

import React from 'react';
import type { SimulationResult } from '../../services/simulation';
import { expectSchema } from '../../lib/validation';
import { SimulationResultSchema } from '../../plugin/schemas';

interface TransactionSimulationProps {
  simulation: SimulationResult;
  loading?: boolean;
  onProceed?: () => void;
  onCancel?: () => void;
}

const RiskBadge: React.FC<{ level: SimulationResult['risk']['level'] }> = ({ level }) => {
  const colors: Record<string, string> = {
    safe: 'bg-green-500/20 text-green-400 border-green-500/30',
    low: 'bg-lime-500/20 text-lime-400 border-lime-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  
  const labels: Record<string, string> = {
    safe: 'Safe',
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
    critical: 'Critical Risk',
  };
  
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded border ${colors[level]}`}>
      {labels[level]}
    </span>
  );
};

const ChangeIcon: React.FC<{ type: 'send' | 'receive' | 'approve' | 'revoke' }> = ({ type }) => {
  const icons: Record<string, { icon: string; color: string }> = {
    send: { icon: '↑', color: 'text-red-400' },
    receive: { icon: '↓', color: 'text-green-400' },
    approve: { icon: '✓', color: 'text-yellow-400' },
    revoke: { icon: '✗', color: 'text-gray-400' },
  };
  
  const { icon, color } = icons[type];
  return <span className={`text-lg font-bold ${color}`}>{icon}</span>;
};

export const TransactionSimulation: React.FC<TransactionSimulationProps> = ({
  simulation,
  loading,
  onProceed,
  onCancel,
}) => {
  // Validate props
  if (simulation) {
    try {
      expectSchema(simulation, SimulationResultSchema, 'TransactionSimulation props.simulation');
    } catch (e) {
      console.error('Invalid simulation result:', e);
      // In development we might want to throw, but in production maybe fallback?
      // "fail fast implementation across the board" -> throw
      throw e;
    }
  }

  if (loading) {
    return (
      <div className="p-4 bg-zinc-900 rounded-lg">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
          <span className="ml-3 text-zinc-400">Simulating transaction...</span>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-zinc-900 rounded-lg">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${simulation.success ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="font-medium">
            {simulation.success ? 'Transaction Preview' : 'Transaction Will Fail'}
          </span>
        </div>
        <RiskBadge level={simulation.risk.level} />
      </div>
      
      {/* Error Message */}
      {simulation.error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-400 text-sm">{simulation.error}</p>
        </div>
      )}
      
      {/* Balance Changes */}
      {(simulation.nativeChange || simulation.tokenChanges.length > 0) && (
        <div className="p-4 bg-zinc-900 rounded-lg">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Balance Changes</h3>
          <div className="space-y-2">
            {/* Native ETH change */}
            {simulation.nativeChange && (
              <div className="flex items-center justify-between p-3 bg-zinc-800 rounded">
                <div className="flex items-center gap-3">
                  <ChangeIcon type={simulation.nativeChange.type} />
                  <div>
                    <p className="font-medium">ETH</p>
                    <p className="text-xs text-zinc-500">Native Token</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={simulation.nativeChange.type === 'send' ? 'text-red-400' : 'text-green-400'}>
                    {simulation.nativeChange.type === 'send' ? '-' : '+'}{simulation.nativeChange.amountFormatted}
                  </p>
                  <p className="text-xs text-zinc-500">${simulation.nativeChange.usdValue.toFixed(2)}</p>
                </div>
              </div>
            )}
            
            {/* Token changes */}
            {simulation.tokenChanges.map((change, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-zinc-800 rounded">
                <div className="flex items-center gap-3">
                  <ChangeIcon type={change.type} />
                  <div>
                    <p className="font-medium">{change.token.symbol}</p>
                    <p className="text-xs text-zinc-500 font-mono">
                      {change.token.address.slice(0, 6)}...{change.token.address.slice(-4)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={change.type === 'send' ? 'text-red-400' : 'text-green-400'}>
                    {change.type === 'send' ? '-' : '+'}{change.amountFormatted}
                  </p>
                  <p className="text-xs text-zinc-500">${change.usdValue.toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Approval Changes */}
      {simulation.approvalChanges.length > 0 && (
        <div className="p-4 bg-zinc-900 rounded-lg">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Approval Changes</h3>
          <div className="space-y-2">
            {simulation.approvalChanges.map((approval, i) => (
              <div key={i} className={`p-3 rounded ${approval.isRevoke ? 'bg-zinc-800' : 'bg-yellow-500/10 border border-yellow-500/30'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ChangeIcon type={approval.isRevoke ? 'revoke' : 'approve'} />
                    <div>
                      <p className="font-medium">
                        {approval.isRevoke ? 'Revoke' : 'Approve'} {approval.symbol}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Spender: {approval.spenderName || `${approval.spender.slice(0, 6)}...${approval.spender.slice(-4)}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {approval.amount === 'unlimited' ? (
                      <span className="text-yellow-400 font-medium">Unlimited</span>
                    ) : (
                      <span className="text-zinc-300">{approval.amount.toString()}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Contract Interaction */}
      {simulation.contractInteraction && (
        <div className="p-4 bg-zinc-900 rounded-lg">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Contract Interaction</h3>
          <div className="p-3 bg-zinc-800 rounded">
            <div className="flex items-center justify-between mb-2">
              <span className="text-zinc-400">Contract</span>
              <div className="flex items-center gap-2">
                {simulation.contractInteraction.verified && (
                  <span className="text-green-400 text-xs">✓ Verified</span>
                )}
                <span className="font-mono text-sm">
                  {simulation.contractInteraction.name || 
                    `${simulation.contractInteraction.address.slice(0, 6)}...${simulation.contractInteraction.address.slice(-4)}`}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Method</span>
              <span className="font-mono text-sm">{simulation.contractInteraction.method}</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Gas Estimate */}
      <div className="p-4 bg-zinc-900 rounded-lg">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">Gas Estimate</h3>
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">Estimated Cost</span>
          <div className="text-right">
            <p className="font-medium">{(Number(simulation.gas.totalCost) / 1e18).toFixed(6)} ETH</p>
            <p className="text-xs text-zinc-500">${simulation.gas.totalCostUsd.toFixed(2)}</p>
          </div>
        </div>
      </div>
      
      {/* Warnings */}
      {simulation.risk.warnings.length > 0 && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <h3 className="text-sm font-medium text-yellow-400 mb-2">⚠️ Warnings</h3>
          <ul className="space-y-1">
            {simulation.risk.warnings.map((warning, i) => (
              <li key={i} className="text-sm text-yellow-300">• {warning}</li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Suggestions */}
      {simulation.risk.suggestions.length > 0 && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <h3 className="text-sm font-medium text-blue-400 mb-2">💡 Suggestions</h3>
          <ul className="space-y-1">
            {simulation.risk.suggestions.map((suggestion, i) => (
              <li key={i} className="text-sm text-blue-300">• {suggestion}</li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Action Buttons */}
      {(onProceed || onCancel) && (
        <div className="flex gap-3 pt-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex-1 py-3 px-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
          )}
          {onProceed && simulation.success && (
            <button
              onClick={onProceed}
              disabled={simulation.risk.level === 'critical'}
              className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                simulation.risk.level === 'critical'
                  ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                  : simulation.risk.level === 'high'
                  ? 'bg-orange-600 hover:bg-orange-500'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {simulation.risk.level === 'critical' ? 'Blocked' : 
               simulation.risk.level === 'high' ? 'Proceed Anyway' : 'Confirm'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default TransactionSimulation;

