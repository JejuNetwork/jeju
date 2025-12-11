import { useState } from 'react';
import { useTokenRegistry } from '../hooks/useTokenRegistry';
import { CONTRACTS } from '../config';
import { formatEther } from 'viem';

export default function RegisterToken() {
  const [tokenAddress, setTokenAddress] = useState('');
  const [minFee, setMinFee] = useState('0');
  const [maxFee, setMaxFee] = useState('200');
  const [error, setError] = useState('');

  const { registerToken, isPending, isSuccess, registrationFee } = useTokenRegistry();
  const priceOracle = CONTRACTS.priceOracle;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!tokenAddress || !tokenAddress.startsWith('0x') || tokenAddress.length !== 42) {
      setError('Invalid token address');
      return;
    }

    const minFeeNum = parseInt(minFee);
    const maxFeeNum = parseInt(maxFee);

    if (isNaN(minFeeNum) || isNaN(maxFeeNum)) {
      setError('Invalid fee values');
      return;
    }

    if (minFeeNum > maxFeeNum) {
      setError('Min fee must be <= max fee');
      return;
    }

    if (maxFeeNum > 500) {
      setError('Max fee cannot exceed 5% (500 basis points)');
      return;
    }

    await registerToken(
      tokenAddress as `0x${string}`,
      priceOracle,
      minFeeNum,
      maxFeeNum
    );
  };

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Register New Token</h2>
      
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Token Address
          </label>
          <input
            className="input"
            type="text"
            placeholder="0x..."
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            disabled={isPending}
          />
        </div>

        <div className="grid grid-2" style={{ marginBottom: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Min Fee (basis points)
            </label>
            <input
              className="input"
              type="number"
              placeholder="0"
              value={minFee}
              onChange={(e) => setMinFee(e.target.value)}
              disabled={isPending}
              min="0"
              max="500"
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              {parseInt(minFee) / 100}% minimum fee
            </p>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Max Fee (basis points)
            </label>
            <input
              className="input"
              type="number"
              placeholder="200"
              value={maxFee}
              onChange={(e) => setMaxFee(e.target.value)}
              disabled={isPending}
              min="0"
              max="500"
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              {parseInt(maxFee) / 100}% maximum fee
            </p>
          </div>
        </div>

        <div style={{ padding: '1rem', background: 'var(--surface-hover)', borderRadius: '8px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.875rem', margin: 0 }}>
            <strong>Registration Fee:</strong> {registrationFee ? formatEther(registrationFee) : '0.1'} ETH
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            This fee prevents spam registrations and goes to treasury.
          </p>
        </div>

        {error && (
          <div style={{ padding: '1rem', background: 'var(--error-soft)', borderRadius: '8px', marginBottom: '1rem' }}>
            <p style={{ color: 'var(--error)', margin: 0 }}>{error}</p>
          </div>
        )}

        {isSuccess && (
          <div style={{ padding: '1rem', background: 'var(--success-soft)', borderRadius: '8px', marginBottom: '1rem' }}>
            <p style={{ color: 'var(--success)', margin: 0 }}>Token registered successfully!</p>
          </div>
        )}

        <button
          type="submit"
          className="button"
          style={{ width: '100%' }}
          disabled={isPending}
        >
          {isPending ? 'Registering...' : 'Register Token'}
        </button>
      </form>
    </div>
  );
}

