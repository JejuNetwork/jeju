import { useTokenBalances } from '../hooks/useTokenBalances';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import { formatTokenAmount, formatUSD, calculateUSDValue } from '../lib/tokenUtils';
import { Coins } from 'lucide-react';

export default function MultiTokenBalanceDisplay() {
  const { balances, isLoading } = useTokenBalances();
  const { tokens } = useProtocolTokens();

  if (isLoading) {
    return (
      <div className="card" style={{ padding: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
          <div className="spinner spinner-sm" />
          <span style={{ color: 'var(--text-muted)' }}>Loading balances...</span>
        </div>
      </div>
    );
  }

  const totalUSD = tokens.reduce((sum, token) => {
    const balance = balances[token.symbol];
    if (!balance) return sum;
    return sum + calculateUSDValue(balance, token.decimals, token.priceUSD);
  }, 0);

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: '40px', height: '40px', background: 'var(--gradient-brand)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
            <Coins size={20} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Token Balances</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{tokens.length} tokens</p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-primary)' }}>{formatUSD(totalUSD)}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Value</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '0.75rem' }}>
        {tokens.map(token => {
          const balance = balances[token.symbol] || 0n;
          const usdValue = calculateUSDValue(balance, token.decimals, token.priceUSD);

          return (
            <div key={token.symbol} className="stat-card" style={{ textAlign: 'left', padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {token.logoUrl ? (
                  <img src={token.logoUrl} alt={token.symbol} style={{ width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--gradient-brand)', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>{token.symbol}</span>
                    <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{formatUSD(token.priceUSD, token.priceUSD < 1 ? 4 : 2)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.25rem', gap: '0.25rem' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-primary)', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--font-mono)' }}>
                      {formatTokenAmount(balance, token.decimals, 2)}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', flexShrink: 0 }}>≈ {formatUSD(usdValue, 2)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
