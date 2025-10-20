import { useTokenRegistry, useTokenConfig } from '../hooks/useTokenRegistry';
import { usePaymasterDeployment } from '../hooks/usePaymasterFactory';
import { formatEther } from 'viem';

function TokenCard({ tokenAddress }: { tokenAddress: `0x${string}` }) {
  const { config } = useTokenConfig(tokenAddress);
  const { deployment } = usePaymasterDeployment(tokenAddress);

  if (!config) return null;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', margin: 0 }}>{config.name}</h3>
          <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0.25rem 0' }}>
            {config.symbol} • {config.decimals} decimals
          </p>
        </div>
        {config.isActive ? (
          <span className="badge badge-success">Active</span>
        ) : (
          <span className="badge badge-error">Inactive</span>
        )}
      </div>

      <div className="grid grid-2" style={{ marginTop: '1rem', gap: '1rem' }}>
        <div>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Fee Range</p>
          <p style={{ fontSize: '1rem', fontWeight: '600', margin: '0.25rem 0' }}>
            {Number(config.minFeeMargin) / 100}% - {Number(config.maxFeeMargin) / 100}%
          </p>
        </div>
        <div>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Total Volume</p>
          <p style={{ fontSize: '1rem', fontWeight: '600', margin: '0.25rem 0' }}>
            {formatEther(config.totalVolume)} ETH
          </p>
        </div>
        <div>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Transactions</p>
          <p style={{ fontSize: '1rem', fontWeight: '600', margin: '0.25rem 0' }}>
            {config.totalTransactions.toString()}
          </p>
        </div>
        <div>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Paymaster</p>
          <p style={{ fontSize: '1rem', fontWeight: '600', margin: '0.25rem 0' }}>
            {deployment ? '✅ Deployed' : '❌ Not Deployed'}
          </p>
        </div>
      </div>

      {deployment && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '8px', fontSize: '0.75rem' }}>
          <p style={{ margin: '0.25rem 0' }}><strong>Paymaster:</strong> {deployment.paymaster.slice(0, 10)}...</p>
          <p style={{ margin: '0.25rem 0' }}><strong>Vault:</strong> {deployment.vault.slice(0, 10)}...</p>
          <p style={{ margin: '0.25rem 0' }}><strong>Fee:</strong> {Number(deployment.feeMargin) / 100}%</p>
        </div>
      )}
    </div>
  );
}

export default function TokenList() {
  const { allTokens, refetchTokens } = useTokenRegistry();

  if (!allTokens || allTokens.length === 0) {
    return (
      <div className="card">
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Registered Tokens</h2>
        <div style={{ padding: '2rem', background: '#f8fafc', borderRadius: '8px', textAlign: 'center' }}>
          <p style={{ color: '#64748b' }}>No tokens registered yet.</p>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.5rem' }}>
            Deploy contracts first: <code>bun run scripts/deploy-paymaster-system.ts</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Registered Tokens ({allTokens.length})</h2>
        <button className="button" onClick={() => refetchTokens()}>
          Refresh
        </button>
      </div>

      {allTokens.map((tokenAddress) => (
        <TokenCard key={tokenAddress} tokenAddress={tokenAddress} />
      ))}
    </div>
  );
}

