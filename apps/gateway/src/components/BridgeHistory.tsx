import { useMemo } from 'react';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import { formatTokenAmount } from '../lib/tokenUtils';
import { Clock, CheckCircle, XCircle, Loader } from 'lucide-react';

interface BridgeTransfer {
  id: string;
  token: string;
  amount: bigint;
  from: string;
  to: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  txHash?: string;
}

/**
 * Bridge History Component
 * 
 * CURRENT: Returns empty array (no transfers shown)
 * 
 * TO MAKE REAL: Query Subsquid indexer:
 * ```
 * const { data: transfers } = useQuery({
 *   queryKey: ['bridgeTransfers', address],
 *   queryFn: async () => {
 *     const response = await fetch('http://localhost:4350/graphql', {
 *       method: 'POST',
 *       body: JSON.stringify({
 *         query: `query { bridgeTransfers(where: {user: "${address}"}) { ... } }`
 *       })
 *     });
 *     return (await response.json()).data.bridgeTransfers;
 *   }
 * });
 * ```
 * 
 * REASON: Requires indexer integration
 * IMPACT: None on core bridging functionality (just history display)
 */
export default function BridgeHistory() {
  const { getToken } = useProtocolTokens();

  // MOCK - Returns empty array. See comment above for real implementation.
  const transfers: BridgeTransfer[] = useMemo(() => [], []);

  if (transfers.length === 0) {
    return (
      <div className="card">
        <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Bridge History</h3>
        <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
          <p>No bridge transfers yet</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Your bridged tokens will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
        Bridge History ({transfers.length})
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {transfers.map(transfer => {
          const token = getToken(transfer.token);
          const statusIcon = transfer.status === 'confirmed' ? (
            <CheckCircle size={20} style={{ color: '#10b981' }} />
          ) : transfer.status === 'failed' ? (
            <XCircle size={20} style={{ color: '#ef4444' }} />
          ) : transfer.status === 'pending' ? (
            <Loader size={20} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
          ) : (
            <Clock size={20} style={{ color: '#94a3b8' }} />
          );

          return (
            <div
              key={transfer.id}
              style={{
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem'
              }}
            >
              {statusIcon}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: '600' }}>
                    {token ? formatTokenAmount(transfer.amount, token.decimals, 2) : transfer.amount.toString()} {transfer.token}
                  </span>
                  <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                    {new Date(transfer.timestamp).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                  {transfer.from.slice(0, 6)}...{transfer.from.slice(-4)} → {transfer.to.slice(0, 6)}...{transfer.to.slice(-4)}
                </div>
                {transfer.txHash && (
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                    Tx: {transfer.txHash.slice(0, 10)}...
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

