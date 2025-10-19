import { useState } from 'react';
import { usePaymasterFactory, usePaymasterDeployment } from '../hooks/usePaymasterFactory';
import { useTokenConfig } from '../hooks/useTokenRegistry';
import { useAccount } from 'wagmi';
import TokenSelector from './TokenSelector';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import type { TokenOption } from './TokenSelector';

export default function DeployPaymaster({ tokenAddress: propTokenAddress }: { tokenAddress?: `0x${string}` }) {
  const [feeMargin, setFeeMargin] = useState('100');
  const [selectedToken, setSelectedToken] = useState<TokenOption | null>(null);
  const { address: userAddress } = useAccount();
  
  const { tokens } = useProtocolTokens();
  
  // Map protocol tokens to TokenOption format
  const tokenOptions = tokens.map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
  }));

  const tokenAddress = propTokenAddress || (selectedToken?.address as `0x${string}` | undefined);
  const { config } = useTokenConfig(tokenAddress);
  const { deployment } = usePaymasterDeployment(tokenAddress);
  const { deployPaymaster, isPending, isSuccess } = usePaymasterFactory();

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!tokenAddress || !userAddress) return;

    await deployPaymaster(
      tokenAddress,
      parseInt(feeMargin),
      userAddress
    );
  };

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Deploy Paymaster</h2>

      <div style={{ padding: '1rem', background: '#dbeafe', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #3b82f6' }}>
        <p style={{ fontSize: '0.875rem', margin: 0, color: '#1e40af' }}>
          <strong>🚀 Deploy for ANY token:</strong> elizaOS, CLANKER, VIRTUAL, CLANKERMON, or any registered ERC20. 
          Factory deploys Vault + Distributor + Paymaster in one transaction.
        </p>
      </div>

      <TokenSelector
        tokens={tokenOptions}
        selectedToken={selectedToken?.symbol}
        onSelect={setSelectedToken}
        label="Select Token (elizaOS, CLANKER, VIRTUAL, CLANKERMON, etc.)"
        placeholder="Choose token for paymaster..."
        showBalances={false}
        disabled={isPending}
      />

      {selectedToken && deployment && (
        <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', marginTop: '1rem', border: '1px solid #fbbf24' }}>
          <p style={{ color: '#92400e', margin: 0 }}>
            <strong>⚠️ Paymaster already deployed</strong> for {selectedToken.symbol}
          </p>
          <p style={{ fontSize: '0.75rem', color: '#92400e', marginTop: '0.5rem' }}>
            Vault: {deployment.vault.slice(0, 10)}... • Paymaster: {deployment.paymaster.slice(0, 10)}...
          </p>
        </div>
      )}

      {selectedToken && !deployment && !config && (
        <div style={{ padding: '1rem', background: '#fee2e2', borderRadius: '8px', marginTop: '1rem' }}>
          <p style={{ color: '#dc2626', margin: 0 }}>
            <strong>❌ Token not registered</strong>
          </p>
          <p style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.5rem' }}>
            Register {selectedToken.symbol} in the TokenRegistry first (see "Registered Tokens" tab).
          </p>
        </div>
      )}

      {selectedToken && !deployment && config && (
        <form onSubmit={handleDeploy} style={{ marginTop: '1.5rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Fee Margin (basis points)
            </label>
            <input
              className="input"
              type="range"
              min={config.minFeeMargin.toString()}
              max={config.maxFeeMargin.toString()}
              value={feeMargin}
              onChange={(e) => setFeeMargin(e.target.value)}
              disabled={isPending}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: '#64748b', marginTop: '0.5rem' }}>
              <span>{Number(config.minFeeMargin) / 100}% min</span>
              <span style={{ fontWeight: '600', color: '#667eea' }}>{parseInt(feeMargin) / 100}% selected</span>
              <span>{Number(config.maxFeeMargin) / 100}% max</span>
            </div>
          </div>

          <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
              <strong>Deploying paymaster for {selectedToken.symbol}</strong>
            </p>
            <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
              This will deploy 3 contracts:
            </p>
            <ul style={{ fontSize: '0.875rem', color: '#64748b', margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
              <li>LiquidityVault (for ETH + token pools)</li>
              <li>FeeDistributor (splits fees between operator and LPs)</li>
              <li>LiquidityPaymaster (ERC-4337 gas sponsorship)</li>
            </ul>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.5rem 0' }}>
              Estimated cost: ~3M gas (~$0.01 on Jeju)
            </p>
          </div>

          {isSuccess && (
            <div style={{ padding: '1rem', background: '#dcfce7', borderRadius: '8px', marginBottom: '1rem' }}>
              <p style={{ color: '#16a34a', margin: 0 }}>
                Paymaster deployed successfully for {selectedToken.symbol}!
              </p>
            </div>
          )}

          <button
            type="submit"
            className="button"
            style={{ width: '100%' }}
            disabled={isPending || !userAddress}
          >
            {isPending ? `Deploying ${selectedToken.symbol} Paymaster...` : `Deploy Paymaster for ${selectedToken.symbol}`}
          </button>
        </form>
      )}
    </div>
  );
}

