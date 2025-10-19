import { useLiquidityVault } from '../hooks/useLiquidityVault';
import { usePaymasterFactory, usePaymasterDeployment } from '../hooks/usePaymasterFactory';
import { useTokenConfig } from '../hooks/useTokenRegistry';
import { formatEther } from 'viem';
import { BarChart3 } from 'lucide-react';

function PositionCard({ tokenAddress }: { tokenAddress: `0x${string}` }) {
  const { config } = useTokenConfig(tokenAddress);
  const { deployment } = usePaymasterDeployment(tokenAddress);
  const { lpPosition, claimFees, isLoading, isClaimSuccess } = useLiquidityVault(deployment?.vault);

  if (!config || !deployment || !lpPosition || lpPosition.ethShares === 0n) {
    return null;
  }

  return (
    <div className="card">
      <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
        {config.symbol} Position
      </h3>

      <div className="grid grid-3">
        <div>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>ETH Shares</p>
          <p style={{ fontSize: '1.25rem', fontWeight: '600', margin: '0.25rem 0' }}>
            {formatEther(lpPosition.ethShares)}
          </p>
        </div>

        <div>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Current Value</p>
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

      {lpPosition.pendingFees > 0n && (
        <>
          {isClaimSuccess && (
            <div style={{ padding: '1rem', background: '#dcfce7', borderRadius: '8px', marginTop: '1rem' }}>
              <p style={{ color: '#16a34a', margin: 0 }}>Fees claimed successfully!</p>
            </div>
          )}
          
          <button
            className="button"
            style={{ width: '100%', marginTop: '1rem' }}
            onClick={() => claimFees()}
            disabled={isLoading}
          >
            {isLoading ? 'Claiming...' : `Claim ${formatEther(lpPosition.pendingFees)} Fees`}
          </button>
        </>
      )}
    </div>
  );
}

export default function LPDashboard() {
  const { allDeployments } = usePaymasterFactory();

  if (!allDeployments || allDeployments.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <BarChart3 size={48} style={{ margin: '0 auto 1rem', color: '#94a3b8' }} />
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No LP Positions</h2>
        <p style={{ color: '#64748b' }}>
          Add liquidity to earn fees from gas sponsorship
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>My LP Positions</h2>
      
      {allDeployments.map((tokenAddress) => (
        <PositionCard key={tokenAddress} tokenAddress={tokenAddress} />
      ))}
    </div>
  );
}

