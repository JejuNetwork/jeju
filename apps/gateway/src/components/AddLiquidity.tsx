import { useState } from 'react';
import { useLiquidityVault } from '../hooks/useLiquidityVault';
import { usePaymasterDeployment } from '../hooks/usePaymasterFactory';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import { parseEther, formatEther } from 'viem';
import TokenSelector from './TokenSelector';
import type { TokenOption } from './TokenSelector';

export default function AddLiquidity({ vaultAddress: propVaultAddress }: { vaultAddress?: `0x${string}` }) {
  const [ethAmount, setEthAmount] = useState('1');
  const [selectedToken, setSelectedToken] = useState<TokenOption | null>(null);
  
  const { tokens } = useProtocolTokens();
  const tokenOptions = tokens.map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
  }));

  // Get vault address from selected token's deployment
  const { deployment } = usePaymasterDeployment(selectedToken?.address as `0x${string}` | undefined);
  const vaultAddress = propVaultAddress || deployment?.vault;

  const { addETHLiquidity, removeETHLiquidity, lpPosition, isLoading, isAddSuccess } = useLiquidityVault(vaultAddress);

  const handleAddLiquidity = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const amount = parseEther(ethAmount);
    // Note: minShares/slippage protection would be handled in contract if needed
    await addETHLiquidity(amount);
  };

  const handleRemoveLiquidity = async () => {
    if (!lpPosition) return;
    await removeETHLiquidity(lpPosition.ethShares);
  };

  return (
    <div>
      <div className="card">
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Add ETH Liquidity</h2>

        <div style={{ padding: '1rem', background: '#dbeafe', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #3b82f6' }}>
          <p style={{ fontSize: '0.875rem', margin: 0, color: '#1e40af' }}>
            <strong>💡 How it works:</strong> Deposit ETH to sponsor gas payments. 
            Earn fees in protocol tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON) when users pay gas with those tokens.
          </p>
        </div>

        <TokenSelector
          tokens={tokenOptions}
          selectedToken={selectedToken?.symbol}
          onSelect={setSelectedToken}
          label="Select Token (elizaOS, CLANKER, VIRTUAL, CLANKERMON)"
          placeholder="Choose token vault..."
          showBalances={false}
          disabled={isLoading}
        />

        {selectedToken && !deployment && (
          <div style={{ padding: '1rem', background: '#fee2e2', borderRadius: '8px', marginTop: '1rem' }}>
            <p style={{ color: '#dc2626', margin: 0 }}>
              No paymaster deployed for {selectedToken.symbol}. Deploy one first in the "Deploy Paymaster" tab.
            </p>
          </div>
        )}

        {selectedToken && deployment && (
          <form onSubmit={handleAddLiquidity} style={{ marginTop: '1.5rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                ETH Amount
              </label>
              <input
                className="input"
                type="number"
                step="0.1"
                min="0.1"
                placeholder="1.0"
                value={ethAmount}
                onChange={(e) => setEthAmount(e.target.value)}
                disabled={isLoading}
              />
              <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                Deposit ETH to earn fees in {selectedToken.symbol}
              </p>
            </div>

            {isAddSuccess && (
              <div style={{ padding: '1rem', background: '#dcfce7', borderRadius: '8px', marginBottom: '1rem' }}>
                <p style={{ color: '#16a34a', margin: 0 }}>Liquidity added successfully to {selectedToken.symbol} vault!</p>
              </div>
            )}

            <button
              type="submit"
              className="button"
              style={{ width: '100%' }}
              disabled={isLoading}
            >
              {isLoading ? 'Adding Liquidity...' : `Add ${ethAmount} ETH to ${selectedToken.symbol} Vault`}
            </button>
          </form>
        )}
      </div>

      {selectedToken && deployment && lpPosition && lpPosition.ethShares > 0n && (
        <div className="card">
          <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
            Your {selectedToken.symbol} LP Position
          </h3>
          
          <div className="grid grid-2">
            <div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>ETH Shares</p>
              <p style={{ fontSize: '1.25rem', fontWeight: '600', margin: '0.25rem 0' }}>
                {formatEther(lpPosition.ethShares)}
              </p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>ETH Value</p>
              <p style={{ fontSize: '1.25rem', fontWeight: '600', margin: '0.25rem 0' }}>
                {formatEther(lpPosition.ethValue)} ETH
              </p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Pending Fees</p>
              <p style={{ fontSize: '1.25rem', fontWeight: '600', margin: '0.25rem 0', color: '#16a34a' }}>
                {formatEther(lpPosition.pendingFees)}
              </p>
            </div>
          </div>

          <button
            className="button button-secondary"
            style={{ width: '100%', marginTop: '1rem' }}
            onClick={handleRemoveLiquidity}
            disabled={isLoading}
          >
            Remove All Liquidity
          </button>
        </div>
      )}
    </div>
  );
}

