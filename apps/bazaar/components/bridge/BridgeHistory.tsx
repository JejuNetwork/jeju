import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import { formatTokenAmount } from '../lib/tokenUtils';
import { Clock, CheckCircle, XCircle, Loader, RefreshCw } from 'lucide-react';
import { INDEXER_URL } from '../config';

interface BridgeTransfer {
  id: string;
  token: string;
  amount: bigint;
  from: string;
  to: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  txHash?: string;
  destinationChain?: number;
}

interface VoucherRequest {
  id: string;
  requestId: string;
  requester: string;
  sourceToken: string;
  destinationToken: string;
  sourceAmount: string;
  destinationChain: number;
  recipient: string;
  status: string;
  createdAt: string;
  sourceTx: string;
  voucher?: {
    fulfilled: boolean;
    destinationFulfillTx?: string;
  };
}

async function fetchBridgeHistory(address: string): Promise<BridgeTransfer[]> {
  const query = `
    query BridgeHistory($address: String!) {
      crossChainVoucherRequests(
        where: { requester_eq: $address }
        orderBy: createdAt_DESC
        limit: 20
      ) {
        id
        requestId
        requester
        sourceToken
        destinationToken
        sourceAmount
        destinationChain
        recipient
        status
        createdAt
        sourceTx
        voucher {
          fulfilled
          destinationFulfillTx
        }
      }
    }
  `;

  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { address: address.toLowerCase() } }),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch bridge history');
  }

  const { data } = await response.json();
  const requests: VoucherRequest[] = data?.crossChainVoucherRequests || [];

  return requests.map((req): BridgeTransfer => ({
    id: req.id,
    token: req.sourceToken,
    amount: BigInt(req.sourceAmount),
    from: req.requester,
    to: req.recipient,
    status: req.status === 'FULFILLED' || req.voucher?.fulfilled 
      ? 'confirmed' 
      : req.status === 'EXPIRED' || req.status === 'REFUNDED' 
        ? 'failed' 
        : 'pending',
    timestamp: new Date(req.createdAt).getTime(),
    txHash: req.voucher?.destinationFulfillTx || req.sourceTx,
    destinationChain: req.destinationChain,
  }));
}

export default function BridgeHistory() {
  const { address } = useAccount();
  const { getToken } = useProtocolTokens();

  const { data: transfers = [], isLoading, error, refetch } = useQuery({
    queryKey: ['bridge-history', address],
    queryFn: () => fetchBridgeHistory(address!),
    enabled: !!address,
    refetchInterval: 30000,
  });

  if (!address) {
    return (
      <div className="card">
        <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Bridge History</h3>
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          <p>Connect wallet to view bridge history</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="card">
        <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Bridge History</h3>
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: '0.5rem' }}>Loading transfers...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Bridge History</h3>
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--error)' }}>
          <p>Failed to load bridge history</p>
          <button onClick={() => refetch()} style={{ marginTop: '0.5rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (transfers.length === 0) {
    return (
      <div className="card">
        <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Bridge History</h3>
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.25rem', margin: 0 }}>
          Bridge History ({transfers.length})
        </h3>
        <button 
          onClick={() => refetch()} 
          style={{ 
            background: 'none', 
            border: 'none', 
            cursor: 'pointer', 
            color: 'var(--text-secondary)',
            padding: '0.25rem'
          }}
          title="Refresh"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {transfers.map(transfer => {
          const token = getToken(transfer.token);
          const statusIcon = transfer.status === 'confirmed' ? (
            <CheckCircle size={20} style={{ color: 'var(--success)' }} />
          ) : transfer.status === 'failed' ? (
            <XCircle size={20} style={{ color: 'var(--error)' }} />
          ) : transfer.status === 'pending' ? (
            <Loader size={20} style={{ color: 'var(--info)', animation: 'spin 1s linear infinite' }} />
          ) : (
            <Clock size={20} style={{ color: 'var(--text-muted)' }} />
          );

          return (
            <div
              key={transfer.id}
              style={{
                padding: '1rem',
                background: 'var(--surface-hover)',
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
                  <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    {new Date(transfer.timestamp).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {transfer.from.slice(0, 6)}...{transfer.from.slice(-4)} → {transfer.to.slice(0, 6)}...{transfer.to.slice(-4)}
                </div>
                {transfer.txHash && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
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

