import { useState } from 'react';
import { DollarSign, Plus, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { formatEther } from 'viem';
import { useAccount } from 'wagmi';
import {
  useOracleSubscriptions,
  useSubscriptionDetails,
  useFeedRegistry,
  useSubscriptionPrice,
} from '../../hooks/useOracleNetwork';
import { formatTimestamp } from '../../lib/oracleNetwork';

export function SubscriptionsView() {
  const { isConnected } = useAccount();
  const { subscriptionIds, feeConfig, isSubscribing, subscribe } = useOracleSubscriptions();
  const [showNewSubscription, setShowNewSubscription] = useState(false);

  if (!isConnected) {
    return (
      <div className="card p-8 text-center">
        <DollarSign size={48} className="mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Connect Wallet</h3>
        <p className="text-gray-500">
          Connect your wallet to view and manage your oracle subscriptions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Fee Info */}
      {feeConfig && (
        <div className="card p-4 bg-purple-50 dark:bg-purple-900/20">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Subscription Pricing</div>
              <div className="text-xs text-gray-500">
                {formatEther(feeConfig.subscriptionFeePerMonth)} ETH/month per feed
              </div>
            </div>
            <button
              className="button flex items-center gap-2"
              onClick={() => setShowNewSubscription(true)}
            >
              <Plus size={14} />
              New Subscription
            </button>
          </div>
        </div>
      )}

      {/* New Subscription Form */}
      {showNewSubscription && (
        <NewSubscriptionForm
          onClose={() => setShowNewSubscription(false)}
          onSubscribe={subscribe}
          isSubscribing={isSubscribing}
        />
      )}

      {/* Subscription List */}
      {subscriptionIds.length === 0 ? (
        <div className="card p-8 text-center">
          <DollarSign size={48} className="mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Active Subscriptions</h3>
          <p className="text-gray-500 mb-4">
            Subscribe to oracle feeds to access real-time price data.
          </p>
          <button
            className="button"
            onClick={() => setShowNewSubscription(true)}
          >
            Create Subscription
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {subscriptionIds.map((subId) => (
            <SubscriptionCard key={subId} subscriptionId={subId} />
          ))}
        </div>
      )}
    </div>
  );
}

interface SubscriptionCardProps {
  subscriptionId: `0x${string}`;
}

function SubscriptionCard({ subscriptionId }: SubscriptionCardProps) {
  const { subscription } = useSubscriptionDetails(subscriptionId);

  if (!subscription) {
    return (
      <div className="card p-4 animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-2" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-48" />
      </div>
    );
  }

  const isExpired = BigInt(Math.floor(Date.now() / 1000)) > subscription.endTime;
  const isActive = subscription.isActive && !isExpired;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {isActive ? (
              <CheckCircle size={16} className="text-green-500" />
            ) : (
              <XCircle size={16} className="text-red-500" />
            )}
            <span className="font-semibold">
              {subscription.feedIds.length} Feed{subscription.feedIds.length !== 1 ? 's' : ''}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              isActive
                ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
            }`}>
              {isActive ? 'Active' : isExpired ? 'Expired' : 'Inactive'}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            ID: {subscriptionId.slice(0, 10)}...{subscriptionId.slice(-8)}
          </div>
        </div>

        <div className="text-right">
          <div className="flex items-center gap-1 text-sm">
            <Clock size={12} />
            <span>Expires: {formatTimestamp(subscription.endTime)}</span>
          </div>
          <div className="text-xs text-gray-500">
            Paid: {formatEther(subscription.amountPaid)} ETH
          </div>
        </div>
      </div>

      {/* Feed IDs */}
      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-500 mb-2">Subscribed Feeds:</div>
        <div className="flex flex-wrap gap-2">
          {subscription.feedIds.map((feedId) => (
            <span
              key={feedId}
              className="text-xs font-mono px-2 py-1 rounded bg-gray-100 dark:bg-gray-700"
            >
              {feedId.slice(0, 10)}...
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

interface NewSubscriptionFormProps {
  onClose: () => void;
  onSubscribe: (feedIds: `0x${string}`[], durationMonths: number, value: bigint) => void;
  isSubscribing: boolean;
}

function NewSubscriptionForm({ onClose, onSubscribe, isSubscribing }: NewSubscriptionFormProps) {
  const { activeFeedIds } = useFeedRegistry();
  const [selectedFeeds, setSelectedFeeds] = useState<`0x${string}`[]>([]);
  const [duration, setDuration] = useState(1);

  const { price } = useSubscriptionPrice(selectedFeeds, duration);

  const toggleFeed = (feedId: `0x${string}`) => {
    setSelectedFeeds((prev) =>
      prev.includes(feedId)
        ? prev.filter((id) => id !== feedId)
        : [...prev, feedId]
    );
  };

  const handleSubscribe = () => {
    if (selectedFeeds.length === 0 || !price) return;
    onSubscribe(selectedFeeds, duration, price);
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">New Subscription</h3>
        <button
          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* Feed Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Select Feeds</label>
        <div className="max-h-48 overflow-y-auto border rounded-lg p-2">
          {activeFeedIds.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-4">
              No feeds available
            </div>
          ) : (
            activeFeedIds.map((feedId) => (
              <label
                key={feedId}
                className="flex items-center gap-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedFeeds.includes(feedId)}
                  onChange={() => toggleFeed(feedId)}
                  className="rounded"
                />
                <span className="font-mono text-sm">{feedId.slice(0, 18)}...</span>
              </label>
            ))
          )}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {selectedFeeds.length} feed{selectedFeeds.length !== 1 ? 's' : ''} selected
        </div>
      </div>

      {/* Duration */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Duration (months)</label>
        <select
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="input w-full"
        >
          {[1, 3, 6, 12].map((m) => (
            <option key={m} value={m}>{m} month{m !== 1 ? 's' : ''}</option>
          ))}
        </select>
      </div>

      {/* Price */}
      <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Total Price</span>
          <span className="text-lg font-bold">
            {price ? `${formatEther(price)} ETH` : '0 ETH'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        <button className="button button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button flex items-center gap-2"
          onClick={handleSubscribe}
          disabled={selectedFeeds.length === 0 || !price || isSubscribing}
        >
          {isSubscribing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Subscribing...
            </>
          ) : (
            <>
              <DollarSign size={14} />
              Subscribe
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default SubscriptionsView;
