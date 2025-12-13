import { useState } from 'react';
import { Activity, TrendingUp, Users, Clock, DollarSign } from 'lucide-react';
import { formatEther } from 'viem';
import { useFeedRegistry, useOracleNetworkStats, useOracleSubscriptions } from '../../hooks/useOracleNetwork';
import { FeedsView } from './FeedsView';
import { SubscriptionsView } from './SubscriptionsView';
import { OperatorsView } from './OperatorsView';

type SubTab = 'feeds' | 'subscriptions' | 'operators';

export function OracleTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('feeds');
  const { totalFeeds, activeFeeds, totalFeesCollected, currentEpoch } = useOracleNetworkStats();
  const { activeFeedIds } = useFeedRegistry();
  const { subscriptionIds } = useOracleSubscriptions();

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Activity size={14} />
            Active Feeds
          </div>
          <div className="text-2xl font-bold">{activeFeeds}</div>
          <div className="text-xs text-gray-400">
            of {totalFeeds?.toString() ?? '0'} total
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Users size={14} />
            Your Subscriptions
          </div>
          <div className="text-2xl font-bold">{subscriptionIds.length}</div>
          <div className="text-xs text-gray-400">
            active subscriptions
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <DollarSign size={14} />
            Total Fees
          </div>
          <div className="text-2xl font-bold">
            {totalFeesCollected ? `${Number(formatEther(totalFeesCollected)).toFixed(2)} ETH` : '0 ETH'}
          </div>
          <div className="text-xs text-gray-400">
            collected all-time
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Clock size={14} />
            Current Epoch
          </div>
          <div className="text-2xl font-bold">{currentEpoch?.toString() ?? '1'}</div>
          <div className="text-xs text-gray-400">
            rewards cycle
          </div>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
        <button
          className={`px-4 py-2 rounded-t-lg transition-colors ${
            activeSubTab === 'feeds'
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          onClick={() => setActiveSubTab('feeds')}
        >
          <div className="flex items-center gap-2">
            <TrendingUp size={16} />
            Price Feeds
          </div>
        </button>
        <button
          className={`px-4 py-2 rounded-t-lg transition-colors ${
            activeSubTab === 'subscriptions'
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          onClick={() => setActiveSubTab('subscriptions')}
        >
          <div className="flex items-center gap-2">
            <DollarSign size={16} />
            Subscriptions
          </div>
        </button>
        <button
          className={`px-4 py-2 rounded-t-lg transition-colors ${
            activeSubTab === 'operators'
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          onClick={() => setActiveSubTab('operators')}
        >
          <div className="flex items-center gap-2">
            <Users size={16} />
            Operators
          </div>
        </button>
      </div>

      {/* Content */}
      <div className="animate-fade-in">
        {activeSubTab === 'feeds' && <FeedsView feedIds={activeFeedIds} />}
        {activeSubTab === 'subscriptions' && <SubscriptionsView />}
        {activeSubTab === 'operators' && <OperatorsView />}
      </div>
    </div>
  );
}

export default OracleTab;
