import { useState, useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { type Address } from 'viem';
import TokenSelector from './TokenSelector';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import { useCrossChainSwap, useEILConfig } from '../hooks/useEIL';
import { parseTokenAmount, formatUSD, calculateUSDValue } from '../lib/tokenUtils';
import type { TokenOption } from './TokenSelector';

const DESTINATION_CHAINS = [
  { id: 1, name: 'Ethereum', icon: '💎' },
  { id: 42161, name: 'Arbitrum', icon: '🟠' },
  { id: 10, name: 'Optimism', icon: '🔴' },
  { id: 11155111, name: 'Sepolia', icon: '🧪' },
] as const;

type TransferStep = 'input' | 'confirm' | 'processing' | 'complete' | 'error';

export default function CrossChainTransfer() {
  const { address: userAddress } = useAccount();
  const { crossChainPaymaster } = useEILConfig();
  
  const [selectedToken, setSelectedToken] = useState<TokenOption | null>(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [destinationChainId, setDestinationChainId] = useState<number>(1);
  const [step, setStep] = useState<TransferStep>('input');

  const { bridgeableTokens } = useProtocolTokens();
  const tokens = useMemo(() => bridgeableTokens.map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
  })), [bridgeableTokens]);

  const {
    executeCrossChainSwap,
    isLoading,
    isSuccess,
    hash
  } = useCrossChainSwap(crossChainPaymaster);

  // Update step based on transaction status
  useEffect(() => {
    if (isLoading) {
      setStep('processing');
    } else if (isSuccess) {
      setStep('complete');
    }
  }, [isLoading, isSuccess]);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedToken || !userAddress || !crossChainPaymaster) return;

    const amountBigInt = parseTokenAmount(amount, selectedToken.decimals);
    const recipientAddress = (recipient || userAddress) as Address;

    setStep('processing');

    await executeCrossChainSwap({
      sourceToken: selectedToken.address as Address,
      destinationToken: selectedToken.address as Address, // Same token on destination
      amount: amountBigInt,
      sourceChainId: 420691, // Jeju mainnet
      destinationChainId,
      recipient: recipientAddress,
    });
  };

  const usdValue = selectedToken && amount 
    ? calculateUSDValue(parseTokenAmount(amount, selectedToken.decimals), selectedToken.decimals, selectedToken.priceUSD)
    : 0;

  const selectedChain = DESTINATION_CHAINS.find(c => c.id === destinationChainId);

  const resetForm = () => {
    setStep('input');
    setAmount('');
    setRecipient('');
    setSelectedToken(null);
  };

  if (!crossChainPaymaster) {
    return (
      <div className="card">
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Cross-Chain Transfer</h2>
        <p style={{ color: 'var(--text-muted)' }}>EIL not configured</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.25rem', margin: '0 0 1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>Cross-Chain Transfer</h2>

      {step === 'input' && (
        <form onSubmit={handleTransfer}>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Destination Chain
            </label>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(85px, 1fr))', 
              gap: '0.5rem' 
            }}>
              {DESTINATION_CHAINS.map((chain) => (
                <button
                  key={chain.id}
                  type="button"
                  onClick={() => setDestinationChainId(chain.id)}
                  style={{
                    padding: '0.625rem 0.5rem',
                    borderRadius: '12px',
                    border: destinationChainId === chain.id 
                      ? '2px solid var(--info)' 
                      : '2px solid transparent',
                    background: destinationChainId === chain.id 
                      ? 'var(--info-soft)' 
                      : 'var(--surface-hover)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: '1.25rem', marginBottom: '0.125rem' }}>{chain.icon}</div>
                  <div style={{ fontSize: '0.6875rem', fontWeight: '600', whiteSpace: 'nowrap' }}>{chain.name}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <TokenSelector
              tokens={tokens}
              selectedToken={selectedToken?.symbol}
              onSelect={setSelectedToken}
              label="Token to Transfer"
              placeholder="Select token..."
              disabled={isLoading}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Amount
            </label>
            <input
              className="input"
              type="number"
              step="any"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isLoading || !selectedToken}
              style={{ fontSize: '1.25rem', fontWeight: '600' }}
            />
            {selectedToken && amount && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                ≈ {formatUSD(usdValue)}
              </p>
            )}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Recipient (optional)
            </label>
            <input
              className="input"
              type="text"
              placeholder={userAddress || '0x...'}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={isLoading}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Leave blank to send to yourself on {selectedChain?.name}
            </p>
          </div>

          <div style={{ padding: '1rem', background: 'var(--surface-hover)', borderRadius: '12px', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Estimated Time</span>
              <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-muted)' }}>Depends on XLP availability</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>XLP Fee</span>
              <span style={{ fontSize: '0.875rem', fontWeight: '600' }}>0.05% of amount</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Protocol</span>
              <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--info)' }}>EIL (Trustless)</span>
            </div>
          </div>

          <button
            type="submit"
            className="button"
            style={{ 
              width: '100%', 
              padding: '1rem',
              fontSize: '1rem',
              fontWeight: '600',
              background: 'linear-gradient(135deg, var(--info) 0%, var(--accent-primary) 100%)',
            }}
            disabled={isLoading || !amount || !selectedToken}
          >
            {isLoading ? 'Processing...' : `Transfer to ${selectedChain?.name}`}
          </button>

        </form>
      )}

      {step === 'processing' && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ 
            width: '80px', 
            height: '80px', 
            margin: '0 auto 1.5rem',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--info) 0%, var(--accent-primary) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'pulse 2s infinite'
          }}>
            <span style={{ fontSize: '2rem' }}>⚡</span>
          </div>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Processing Transfer</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            XLP is fulfilling your request...
          </p>
          <div style={{ 
            display: 'flex', 
            gap: '0.5rem', 
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <div className="spinner" />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Waiting for XLP fulfillment...
            </span>
          </div>
        </div>
      )}

      {step === 'complete' && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ 
            width: '80px', 
            height: '80px', 
            margin: '0 auto 1.5rem',
            borderRadius: '50%',
            background: 'var(--success-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{ fontSize: '2.5rem' }}>✓</span>
          </div>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--success)' }}>
            Transfer Complete!
          </h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            {amount} {selectedToken?.symbol} sent to {selectedChain?.name}
          </p>
          
          {hash && (
            <a 
              href={`https://explorer.jeju.network/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ 
                display: 'inline-block',
                padding: '0.5rem 1rem',
                background: 'var(--surface-hover)',
                borderRadius: '8px',
                color: 'var(--info)',
                textDecoration: 'none',
                fontSize: '0.875rem',
                marginBottom: '1rem'
              }}
            >
              View on Explorer →
            </a>
          )}

          <button
            className="button"
            onClick={resetForm}
            style={{ width: '100%' }}
          >
            New Transfer
          </button>
        </div>
      )}

      {step === 'error' && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ 
            width: '80px', 
            height: '80px', 
            margin: '0 auto 1.5rem',
            borderRadius: '50%',
            background: 'var(--error-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{ fontSize: '2.5rem' }}>✗</span>
          </div>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--error)' }}>
            Transfer Failed
          </h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Transaction was rejected or failed. Your funds remain in your wallet.
          </p>
          
          <button
            className="button"
            onClick={resetForm}
            style={{ width: '100%' }}
          >
            Try Again
          </button>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid var(--border);
          border-top-color: var(--info);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

