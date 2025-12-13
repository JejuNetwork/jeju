import { useState } from 'react';
import { Users, Shield, Activity, TrendingUp, Clock, AlertCircle, CheckCircle } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useOperatorCommittees, useFeedRegistry } from '../../hooks/useOracleNetwork';

interface OperatorsViewProps {
  onRegister?: () => void;
}

export function OperatorsView({ onRegister }: OperatorsViewProps) {
  const { isConnected, address } = useAccount();
  const { assignedFeeds, refetch } = useOperatorCommittees(address);
  const { activeFeedIds } = useFeedRegistry();
  const [showRegistration, setShowRegistration] = useState(false);

  if (!isConnected) {
    return (
      <div className="card p-8 text-center">
        <Users size={48} className="mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Connect Wallet</h3>
        <p className="text-gray-500">
          Connect your wallet to register as an oracle operator or view your assignments.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Operator Status Card */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Shield size={20} />
            Operator Status
          </h3>
          {assignedFeeds.length > 0 ? (
            <span className="flex items-center gap-1 text-green-500 text-sm">
              <CheckCircle size={16} />
              Active
            </span>
          ) : (
            <span className="flex items-center gap-1 text-gray-500 text-sm">
              <AlertCircle size={16} />
              Not Registered
            </span>
          )}
        </div>

        {assignedFeeds.length > 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-gray-500 mb-1">Assigned Feeds</div>
                <div className="text-2xl font-bold">{assignedFeeds.length}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Available Feeds</div>
                <div className="text-2xl font-bold">{activeFeedIds.length}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Coverage</div>
                <div className="text-2xl font-bold">
                  {activeFeedIds.length > 0
                    ? `${Math.round((assignedFeeds.length / activeFeedIds.length) * 100)}%`
                    : '0%'}
                </div>
              </div>
            </div>

            {/* Assigned Feeds List */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="text-sm font-medium mb-2">Your Committee Assignments</div>
              <div className="grid gap-2">
                {assignedFeeds.map((feedId) => (
                  <div
                    key={feedId}
                    className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800"
                  >
                    <span className="font-mono text-sm">
                      {feedId.slice(0, 10)}...{feedId.slice(-8)}
                    </span>
                    <span className="flex items-center gap-1 text-green-500 text-xs">
                      <Activity size={12} />
                      Active
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-gray-500 mb-4">
              You are not registered as an oracle operator. Register to start providing price data
              and earn rewards.
            </p>
            <button
              className="button"
              onClick={() => setShowRegistration(true)}
            >
              Register as Operator
            </button>
          </div>
        )}
      </div>

      {/* Registration Form */}
      {showRegistration && (
        <OperatorRegistrationForm
          onClose={() => setShowRegistration(false)}
          onSuccess={() => {
            setShowRegistration(false);
            refetch();
            onRegister?.();
          }}
        />
      )}

      {/* Performance Metrics (if registered) */}
      {assignedFeeds.length > 0 && <PerformanceMetrics />}

      {/* Requirements Card */}
      <OperatorRequirements />
    </div>
  );
}

function OperatorRegistrationForm({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [workerKey, setWorkerKey] = useState('');
  const [stakingOracleId, setStakingOracleId] = useState('');
  const [agentId, setAgentId] = useState('');

  // Note: This would integrate with OracleNetworkConnector contract
  // For now, showing the UI structure

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">Register as Oracle Operator</h3>
        <button
          className="text-gray-500 hover:text-gray-700"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="space-y-4">
        {/* Worker Key */}
        <div>
          <label className="block text-sm font-medium mb-1">Worker Key Address</label>
          <input
            type="text"
            className="input w-full"
            placeholder="0x..."
            value={workerKey}
            onChange={(e) => setWorkerKey(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">
            Address that will sign price reports. Can be different from your wallet.
          </p>
        </div>

        {/* Staking Oracle ID (optional) */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Staking Oracle ID <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            className="input w-full"
            placeholder="0x... (if registered with OracleStakingManager)"
            value={stakingOracleId}
            onChange={(e) => setStakingOracleId(e.target.value)}
          />
        </div>

        {/* Agent ID (optional) */}
        <div>
          <label className="block text-sm font-medium mb-1">
            ERC-8004 Agent ID <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="number"
            className="input w-full"
            placeholder="Agent ID for reputation tracking"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          />
        </div>

        {/* Info Box */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-blue-500 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-blue-700 dark:text-blue-300">
                Requirements for Operators
              </p>
              <ul className="mt-1 text-blue-600 dark:text-blue-400 space-y-1">
                <li>• Run a reliable oracle node with 99%+ uptime</li>
                <li>• Stake tokens for slashing protection</li>
                <li>• Maintain accurate price submissions</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-4">
          <button className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button"
            onClick={() => {
              // Would call OracleNetworkConnector.registerOperator
              onSuccess();
            }}
          >
            Register
          </button>
        </div>
      </div>
    </div>
  );
}

function PerformanceMetrics() {
  // Would integrate with OracleNetworkConnector to fetch actual metrics
  const mockMetrics = {
    reportsSubmitted: 1247,
    reportsAccepted: 1235,
    accuracy: 99.03,
    uptime: 99.8,
    disputes: 0,
    epoch: 42,
  };

  return (
    <div className="card p-6">
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
        <TrendingUp size={20} />
        Performance Metrics
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">Reports Submitted</div>
          <div className="text-xl font-bold">{mockMetrics.reportsSubmitted.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Acceptance Rate</div>
          <div className="text-xl font-bold text-green-500">{mockMetrics.accuracy}%</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Uptime</div>
          <div className="text-xl font-bold text-green-500">{mockMetrics.uptime}%</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Disputes Lost</div>
          <div className="text-xl font-bold">{mockMetrics.disputes}</div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500 flex items-center gap-1">
            <Clock size={14} />
            Current Epoch
          </span>
          <span className="font-mono">{mockMetrics.epoch}</span>
        </div>
      </div>
    </div>
  );
}

function OperatorRequirements() {
  return (
    <div className="card p-6">
      <h3 className="text-lg font-bold mb-4">Operator Requirements</h3>

      <div className="space-y-3">
        <RequirementItem
          title="Stake Requirement"
          description="Minimum $1,000 USD equivalent stake in approved tokens"
          met={false}
        />
        <RequirementItem
          title="Worker Node"
          description="Run an oracle node that can sign and submit price reports"
          met={false}
        />
        <RequirementItem
          title="Data Sources"
          description="Access to onchain DEX data (Uniswap v3, etc.) without API keys"
          met={false}
        />
        <RequirementItem
          title="Uptime"
          description="Maintain 99%+ uptime for heartbeat submissions"
          met={false}
        />
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <a
          href="https://docs.jeju.network/oracle/operators"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-purple-500 hover:text-purple-600"
        >
          View full operator documentation →
        </a>
      </div>
    </div>
  );
}

function RequirementItem({
  title,
  description,
  met,
}: {
  title: string;
  description: string;
  met: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 ${met ? 'text-green-500' : 'text-gray-300'}`}>
        {met ? <CheckCircle size={18} /> : <div className="w-4 h-4 rounded-full border-2 border-current" />}
      </div>
      <div>
        <div className="font-medium text-sm">{title}</div>
        <div className="text-xs text-gray-500">{description}</div>
      </div>
    </div>
  );
}

export default OperatorsView;
