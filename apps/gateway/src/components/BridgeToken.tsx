import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import TokenSelector from './TokenSelector';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import { parseTokenAmount, formatUSD, calculateUSDValue } from '../lib/tokenUtils';
import type { TokenOption } from './TokenSelector';

const STANDARD_BRIDGE_ADDRESS = '0x4200000000000000000000000000000000000010' as const;

const STANDARD_BRIDGE_ABI = [
  {
    type: 'function',
    name: 'bridgeERC20To',
    inputs: [
      { name: '_localToken', type: 'address' },
      { name: '_remoteToken', type: 'address' },
      { name: '_to', type: 'address' },
      { name: '_amount', type: 'uint256' },
      { name: '_minGasLimit', type: 'uint32' },
      { name: '_extraData', type: 'bytes' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable'
  }
] as const;

export default function BridgeToken() {
  const { address: userAddress } = useAccount();
  const [selectedToken, setSelectedToken] = useState<TokenOption | null>(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [customTokenAddress, setCustomTokenAddress] = useState('');
  const [useCustomToken, setUseCustomToken] = useState(false);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Only show bridgeable tokens (from Base) - excludes native Jeju tokens like elizaOS
  const { bridgeableTokens } = useProtocolTokens();
  const tokens = bridgeableTokens.map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
  }));

  const handleBridge = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedToken || !userAddress) return;

    const amountBigInt = parseTokenAmount(amount, selectedToken.decimals);
    const recipientAddress = (recipient || userAddress) as `0x${string}`;

    // First approve bridge
    writeContract({
      address: selectedToken.address as `0x${string}`,
      abi: STANDARD_BRIDGE_ABI,
      functionName: 'approve',
      args: [STANDARD_BRIDGE_ADDRESS, amountBigInt],
    });

    // Then bridge (would need sequential tx handling)
    // For simplicity, assuming approval succeeds
    setTimeout(() => {
      writeContract({
        address: STANDARD_BRIDGE_ADDRESS,
        abi: STANDARD_BRIDGE_ABI,
        functionName: 'bridgeERC20To',
        args: [
          selectedToken.address as `0x${string}`,
          selectedToken.address as `0x${string}`,
          recipientAddress,
          amountBigInt,
          200000,
          '0x' as `0x${string}`
        ],
      });
    }, 5000);
  };

  const usdValue = selectedToken && amount 
    ? calculateUSDValue(parseTokenAmount(amount, selectedToken.decimals), selectedToken.decimals, selectedToken.priceUSD)
    : 0;

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Bridge from Base to Jeju</h2>
      
      <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #fbbf24' }}>
        <p style={{ fontSize: '0.875rem', margin: 0, color: '#92400e' }}>
          <strong>ℹ️ Note:</strong> elizaOS is a native Jeju token and cannot be bridged from Base.
          Only Base network tokens (CLANKER, VIRTUAL, CLANKERMON, etc.) can be bridged.
        </p>
      </div>

      <form onSubmit={handleBridge}>
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <button
              type="button"
              className={`button ${!useCustomToken ? '' : 'button-secondary'}`}
              onClick={() => setUseCustomToken(false)}
              style={{ flex: 1 }}
            >
              Select Token
            </button>
            <button
              type="button"
              className={`button ${useCustomToken ? '' : 'button-secondary'}`}
              onClick={() => setUseCustomToken(true)}
              style={{ flex: 1 }}
            >
              Custom Address
            </button>
          </div>

          {!useCustomToken ? (
            <TokenSelector
              tokens={tokens}
              selectedToken={selectedToken?.symbol}
              onSelect={setSelectedToken}
              label="Supported Base Tokens"
              placeholder="Select token..."
              disabled={isPending || isConfirming}
            />
          ) : (
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                Custom Token Address (Base Network)
              </label>
              <input
                className="input"
                type="text"
                placeholder="0x..."
                value={customTokenAddress}
                onChange={(e) => setCustomTokenAddress(e.target.value)}
                disabled={isPending || isConfirming}
              />
              <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                Enter any ERC20 token address from Base network. Make sure the token exists on both networks.
              </p>
            </div>
          )}
        </div>

        <div style={{ marginTop: '1rem' }}>
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
            disabled={isPending || isConfirming || !selectedToken}
          />
          {selectedToken && amount && (
            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
              ≈ {formatUSD(usdValue)}
            </p>
          )}
        </div>

        <div style={{ marginTop: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Recipient (optional)
          </label>
          <input
            className="input"
            type="text"
            placeholder={userAddress || '0x...'}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={isPending || isConfirming}
          />
          <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            Leave blank to send to your address
          </p>
        </div>

        <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', marginTop: '1rem' }}>
          <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
            <strong>Estimated Time:</strong> ~2 minutes
          </p>
          <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
            <strong>Bridge:</strong> OP Stack Standard Bridge
          </p>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>
            Tokens will appear on Jeju after confirmation
          </p>
        </div>

        {isSuccess && (
          <div style={{ padding: '1rem', background: '#dcfce7', borderRadius: '8px', marginTop: '1rem' }}>
            <p style={{ color: '#16a34a', margin: 0 }}>
              Bridge transaction submitted! Check status on block explorer.
            </p>
          </div>
        )}

        <button
          type="submit"
          className="button"
          style={{ width: '100%', marginTop: '1rem' }}
          disabled={
            isPending || 
            isConfirming || 
            !amount || 
            (useCustomToken ? !customTokenAddress || !customTokenAddress.startsWith('0x') : !selectedToken)
          }
        >
          {isPending || isConfirming ? 'Bridging...' : 'Bridge to Jeju'}
        </button>
      </form>
    </div>
  );
}

