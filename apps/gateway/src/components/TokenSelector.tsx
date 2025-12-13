import { useState, useMemo } from 'react';
import { useTokenBalances } from '../hooks/useTokenBalances';
import { formatTokenAmount } from '../lib/tokenUtils';

export interface TokenOption {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  priceUSD: number;
  balance?: bigint;
  logoUrl?: string;
}

interface TokenSelectorProps {
  tokens: TokenOption[];
  selectedToken?: string;
  onSelect: (token: TokenOption) => void;
  showBalances?: boolean;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}

export default function TokenSelector({
  tokens,
  selectedToken,
  onSelect,
  showBalances = true,
  disabled = false,
  label = 'Select Token',
  placeholder = 'Choose a token...'
}: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { balances } = useTokenBalances();

  const selected = useMemo(
    () => tokens.find(t => t.symbol === selectedToken || t.address === selectedToken),
    [tokens, selectedToken]
  );

  const handleSelect = (token: TokenOption) => {
    onSelect(token);
    setIsOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
        {label}
      </label>

      {/* Selected Token Display */}
      <button
        type="button"
        className="input"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          width: '100%',
          textAlign: 'left',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '0.75rem',
        }}
      >
        {selected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {selected.logoUrl && (
              <img 
                src={selected.logoUrl} 
                alt={selected.symbol}
                style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            <div>
              <div style={{ fontWeight: '600' }}>{selected.symbol}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {selected.name}
                {Boolean(showBalances && balances[selected.symbol]) && (
                  <span style={{ marginLeft: '0.5rem' }}>
                    • {formatTokenAmount(balances[selected.symbol], selected.decimals, 2)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>{placeholder}</span>
        )}
        <span style={{ color: 'var(--text-muted)' }}>▼</span>
      </button>

      {/* Dropdown List */}
      {isOpen && !disabled && (
        <>
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 40,
            }}
            onClick={() => setIsOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '0.5rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              boxShadow: '0 10px 25px var(--shadow-sm)',
              maxHeight: '300px',
              overflowY: 'auto',
              zIndex: 50,
            }}
          >
            {tokens.map((token) => {
              const balance = balances[token.symbol];
              const isSelected = selected?.symbol === token.symbol;

              return (
                <button
                  key={token.symbol}
                  type="button"
                  onClick={() => handleSelect(token)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    textAlign: 'left',
                    border: 'none',
                    background: isSelected ? 'var(--surface-active)' : 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'var(--surface-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'white';
                  }}
                >
                  {token.logoUrl && (
                    <img 
                      src={token.logoUrl} 
                      alt={token.symbol}
                      style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: '600' }}>{token.symbol}</div>
                      {Boolean(showBalances && balance) && (
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                          {formatTokenAmount(balance, token.decimals, 2)}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                      {token.name}
                      {token.priceUSD > 0 && (
                        <span style={{ marginLeft: '0.5rem' }}>
                          ${token.priceUSD.toFixed(token.priceUSD < 1 ? 4 : 2)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

