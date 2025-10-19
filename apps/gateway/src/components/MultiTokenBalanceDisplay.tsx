import { useTokenBalances } from '../hooks/useTokenBalances';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import { formatTokenAmount, formatUSD, calculateUSDValue } from '../lib/tokenUtils';
import { Coins } from 'lucide-react';

/**
 * Multi-Token Balance Display
 * 
 * Shows balances for ALL protocol tokens:
 * - elizaOS (Native Jeju token) - PRIMARY
 * - CLANKER (Bridged from Base)
 * - VIRTUAL (Bridged from Base)  
 * - CLANKERMON (Bridged from Base)
 * 
 * All tokens treated equally with balance, USD value, and logo display.
 */
export default function MultiTokenBalanceDisplay() {
  const { balances, isLoading } = useTokenBalances();
  // tokens includes: elizaOS, CLANKER, VIRTUAL, CLANKERMON (in that order)
  const { tokens } = useProtocolTokens();

  if (isLoading) {
    return (
      <div className="card">
        <p style={{ textAlign: 'center', color: '#94a3b8' }}>Loading balances...</p>
      </div>
    );
  }

  const totalUSD = tokens.reduce((sum, token) => {
    const balance = balances[token.symbol];
    if (!balance) return sum;
    return sum + calculateUSDValue(balance, token.decimals, token.priceUSD);
  }, 0);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <Coins size={24} style={{ color: '#667eea' }} />
        <div>
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Token Balances</h2>
          <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '0.25rem 0' }}>
            Total: {formatUSD(totalUSD)}
          </p>
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: '1rem' }}>
        {tokens.map(token => {
          const balance = balances[token.symbol] || 0n;
          const usdValue = calculateUSDValue(balance, token.decimals, token.priceUSD);

          return (
            <div 
              key={token.symbol}
              style={{
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}
            >
              {token.logoUrl && (
                <img 
                  src={token.logoUrl}
                  alt={token.symbol}
                  style={{ width: '40px', height: '40px', borderRadius: '50%' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: '600', fontSize: '1rem' }}>{token.symbol}</span>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    {formatUSD(token.priceUSD, token.priceUSD < 1 ? 4 : 2)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                  <span style={{ fontSize: '1.125rem', fontWeight: '600', color: '#667eea' }}>
                    {formatTokenAmount(balance, token.decimals, 2)}
                  </span>
                  <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                    ≈ {formatUSD(usdValue, 2)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

