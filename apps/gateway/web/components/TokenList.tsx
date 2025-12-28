import { usePaymasterDeployment } from '../hooks/usePaymasterFactory'
import { useTokenConfig, useTokenRegistry } from '../hooks/useTokenRegistry'

function TokenCard({ tokenAddress }: { tokenAddress: `0x${string}` }) {
  const { config } = useTokenConfig(tokenAddress)
  const { deployment } = usePaymasterDeployment(tokenAddress)

  if (!config) return null

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 'clamp(1rem, 3vw, 1.25rem)', margin: 0 }}>
            {config.name}
          </h3>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              margin: '0.25rem 0',
            }}
          >
            {config.symbol} • {config.decimals} decimals
          </p>
        </div>
        {config.enabled ? (
          <span className="badge badge-success">Active</span>
        ) : (
          <span className="badge badge-error">Inactive</span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          marginTop: '1rem',
          gap: '0.75rem',
        }}
      >
        <div>
          <p
            style={{
              fontSize: '0.6875rem',
              color: 'var(--text-muted)',
              margin: 0,
            }}
          >
            Paymaster
          </p>
          <p
            style={{
              fontSize: '0.875rem',
              fontWeight: '600',
              margin: '0.125rem 0',
            }}
          >
            {deployment ? '✅ Deployed' : '❌ Not Deployed'}
          </p>
        </div>
      </div>

      {deployment && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.625rem',
            background: 'var(--surface-hover)',
            borderRadius: '8px',
            fontSize: '0.6875rem',
          }}
        >
          <p
            style={{
              margin: '0.125rem 0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <strong>Paymaster:</strong> {deployment.paymaster.slice(0, 10)}...
          </p>
          <p
            style={{
              margin: '0.125rem 0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <strong>Vault:</strong> {deployment.vault.slice(0, 10)}...
          </p>
          <p style={{ margin: '0.125rem 0' }}>
            <strong>Fee:</strong> {deployment.feeMargin / 100}%
          </p>
        </div>
      )}
    </div>
  )
}

export default function TokenList() {
  const { allTokens, refetchTokens } = useTokenRegistry()

  if (!allTokens || allTokens.length === 0) {
    return (
      <div className="card">
        <h2
          style={{
            fontSize: '1.25rem',
            marginBottom: '1.5rem',
            fontWeight: 700,
          }}
        >
          Registered Tokens
        </h2>
        <div
          style={{
            padding: '2.5rem',
            background:
              'linear-gradient(135deg, var(--surface-hover) 0%, var(--surface) 100%)',
            borderRadius: '16px',
            textAlign: 'center',
            border: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              width: '80px',
              height: '80px',
              margin: '0 auto 1.5rem',
              borderRadius: '50%',
              background:
                'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(6, 182, 212, 0.2) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: '2.5rem' }}>🪙</span>
          </div>
          <h3
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              marginBottom: '0.75rem',
              color: 'var(--text-primary)',
            }}
          >
            No Tokens Yet
          </h3>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.9375rem',
              marginBottom: '1.5rem',
              maxWidth: '400px',
              margin: '0 auto 1.5rem',
              lineHeight: 1.6,
            }}
          >
            Register tokens to enable gas sponsorship and multi-token payments
            across the network.
          </p>
          <div
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              gap: '0.75rem',
              padding: '1rem 1.5rem',
              background: 'var(--surface)',
              borderRadius: '12px',
              border: '1px solid var(--border)',
            }}
          >
            <span
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                fontWeight: 500,
              }}
            >
              Deploy contracts with:
            </span>
            <code
              style={{
                fontSize: '0.8125rem',
                fontFamily: 'monospace',
                color: 'var(--primary)',
                background: 'var(--primary-soft)',
                padding: '0.5rem 1rem',
                borderRadius: '6px',
              }}
            >
              bun run scripts/deploy-paymaster-system.ts
            </code>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <h2 style={{ fontSize: 'clamp(1.125rem, 4vw, 1.5rem)', margin: 0 }}>
          Registered Tokens ({allTokens.length})
        </h2>
        <button
          type="button"
          className="button"
          onClick={() => refetchTokens()}
          style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }}
        >
          Refresh
        </button>
      </div>

      {allTokens.map((tokenAddress) => (
        <TokenCard key={tokenAddress} tokenAddress={tokenAddress} />
      ))}
    </div>
  )
}
