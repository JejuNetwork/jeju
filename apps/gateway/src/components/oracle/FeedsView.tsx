import { useState } from 'react';
import { RefreshCw, TrendingUp, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { useFeedDetails } from '../../hooks/useOracleNetwork';
import {
  formatPrice,
  formatConfidence,
  formatTimeAgo,
  isPriceStale,
  FEED_CATEGORY_LABELS,
  FeedCategory,
} from '../../lib/oracleNetwork';

interface FeedsViewProps {
  feedIds: `0x${string}`[];
}

export function FeedsView({ feedIds }: FeedsViewProps) {
  const [selectedFeed, setSelectedFeed] = useState<`0x${string}` | null>(null);

  if (feedIds.length === 0) {
    return (
      <div className="card p-8 text-center">
        <TrendingUp size={48} className="mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Feeds Available</h3>
        <p className="text-gray-500">
          Oracle feeds will appear here once they are created and activated.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Feed List */}
      <div className="grid gap-3">
        {feedIds.map((feedId) => (
          <FeedCard
            key={feedId}
            feedId={feedId}
            isSelected={selectedFeed === feedId}
            onSelect={() => setSelectedFeed(selectedFeed === feedId ? null : feedId)}
          />
        ))}
      </div>

      {/* Selected Feed Details */}
      {selectedFeed && (
        <FeedDetailsPanel feedId={selectedFeed} onClose={() => setSelectedFeed(null)} />
      )}
    </div>
  );
}

interface FeedCardProps {
  feedId: `0x${string}`;
  isSelected: boolean;
  onSelect: () => void;
}

function FeedCard({ feedId, isSelected, onSelect }: FeedCardProps) {
  const { feedSpec, price, confidence, timestamp, isValid, refetch } = useFeedDetails(feedId);

  if (!feedSpec) {
    return (
      <div className="card p-4 animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-2" />
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-32" />
      </div>
    );
  }

  const stale = timestamp ? isPriceStale(timestamp, feedSpec.heartbeatSeconds) : true;
  const categoryLabel = FEED_CATEGORY_LABELS[feedSpec.category as FeedCategory] ?? 'Unknown';

  return (
    <div
      className={`card p-4 cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-purple-500' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Symbol & Category */}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold">{feedSpec.symbol}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                {categoryLabel}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {feedSpec.minOracles} oracles • {feedSpec.quorumThreshold} threshold
            </div>
          </div>
        </div>

        {/* Price Display */}
        <div className="text-right">
          {price !== undefined && price > 0n ? (
            <>
              <div className="flex items-center justify-end gap-2">
                <span className="text-xl font-mono font-bold">
                  ${formatPrice(price, feedSpec.decimals)}
                </span>
                {isValid && !stale ? (
                  <CheckCircle size={16} className="text-green-500" />
                ) : stale ? (
                  <AlertTriangle size={16} className="text-yellow-500" />
                ) : (
                  <AlertTriangle size={16} className="text-red-500" />
                )}
              </div>
              <div className="flex items-center justify-end gap-2 text-xs text-gray-500">
                <span>±{formatConfidence(confidence ?? 0n)}</span>
                <span>•</span>
                <Clock size={12} />
                <span>{timestamp ? formatTimeAgo(timestamp) : 'never'}</span>
              </div>
            </>
          ) : (
            <div className="text-gray-400">No price data</div>
          )}
        </div>

        {/* Refresh Button */}
        <button
          className="ml-4 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            refetch();
          }}
        >
          <RefreshCw size={16} />
        </button>
      </div>
    </div>
  );
}

interface FeedDetailsPanelProps {
  feedId: `0x${string}`;
  onClose: () => void;
}

function FeedDetailsPanel({ feedId, onClose }: FeedDetailsPanelProps) {
  const { feedSpec, consensusPrice, currentRound, refetch } = useFeedDetails(feedId);

  if (!feedSpec) return null;

  return (
    <div className="card p-6 mt-4 border-2 border-purple-200 dark:border-purple-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">{feedSpec.symbol} Feed Details</h3>
        <button
          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div>
          <div className="text-xs text-gray-500 mb-1">Feed ID</div>
          <div className="font-mono text-sm truncate">{feedId.slice(0, 10)}...{feedId.slice(-8)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Current Round</div>
          <div className="font-mono">{currentRound?.toString() ?? '0'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Oracle Count</div>
          <div className="font-mono">{consensusPrice?.oracleCount?.toString() ?? '0'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Heartbeat</div>
          <div className="font-mono">{feedSpec.heartbeatSeconds}s</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <div className="text-xs text-gray-500 mb-1">Base Token</div>
          <div className="font-mono text-sm truncate">{feedSpec.baseToken}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Quote Token</div>
          <div className="font-mono text-sm truncate">{feedSpec.quoteToken}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">TWAP Window</div>
          <div>{feedSpec.twapWindowSeconds}s</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Max Deviation</div>
          <div>{feedSpec.maxDeviationBps / 100}%</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Decimals</div>
          <div>{feedSpec.decimals}</div>
        </div>
      </div>

      {consensusPrice?.reportHash && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 mb-1">Last Report Hash</div>
          <div className="font-mono text-sm truncate">{consensusPrice.reportHash}</div>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          className="button button-secondary flex items-center gap-2"
          onClick={() => refetch()}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
    </div>
  );
}

export default FeedsView;
