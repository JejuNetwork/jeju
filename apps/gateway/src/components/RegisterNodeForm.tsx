/**
 * @fileoverview Form for registering nodes with multi-token staking
 * @module gateway/components/RegisterNodeForm
 */

import { useState, useMemo } from 'react';
import { parseEther } from 'viem';
import TokenSelector from './TokenSelector';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import { useNodeStaking } from '../hooks/useNodeStaking';
import { calculateUSDValue, formatUSD, parseTokenAmount } from '../lib/tokenUtils';
import { Region, REGION_NAMES, calculateMonthlyRewardEstimate } from '../lib/nodeStaking';
import type { TokenOption } from './TokenSelector';

export default function RegisterNodeForm() {
  const { tokens } = useProtocolTokens();
  const { registerNode, isRegistering, isRegisterSuccess, operatorStats } = useNodeStaking();

  const [stakingToken, setStakingToken] = useState<TokenOption | null>(null);
  const [stakeAmount, setStakeAmount] = useState('');
  const [rewardToken, setRewardToken] = useState<TokenOption | null>(null);
  const [rpcUrl, setRpcUrl] = useState('');
  const [region, setRegion] = useState<Region>(Region.NorthAmerica);

  const tokenOptions = tokens.map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
  }));

  // Calculate USD value of stake
  const stakeValueUSD = useMemo(() => {
    if (!stakingToken || !stakeAmount) return 0;
    const amount = parseTokenAmount(stakeAmount, stakingToken.decimals);
    return calculateUSDValue(amount, stakingToken.decimals, stakingToken.priceUSD);
  }, [stakingToken, stakeAmount]);

  // Estimate monthly rewards
  const estimatedMonthlyUSD = useMemo(() => {
    if (!rewardToken) return 0n;
    const baseReward = parseEther('100'); // $100 base
    return calculateMonthlyRewardEstimate(baseReward, 10000n, region, region === Region.Africa || region === Region.SouthAmerica);
  }, [rewardToken, region]);

  // Validation
  const minStakeUSD = 1000;
  const isValid = stakeValueUSD >= minStakeUSD && rpcUrl.startsWith('http') && stakingToken && rewardToken;
  
  const currentNodes = Number(operatorStats?.totalNodesActive || 0n);
  const maxNodes = 5;
  const canAddMore = currentNodes < maxNodes;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stakingToken || !rewardToken) return;

    const amount = parseTokenAmount(stakeAmount, stakingToken.decimals);
    await registerNode(
      stakingToken.address as `0x${string}`,
      amount,
      rewardToken.address as `0x${string}`,
      rpcUrl,
      region
    );
  };

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Register New Node</h2>

      {!canAddMore && (
        <div style={{ padding: '1rem', background: '#fee2e2', borderRadius: '8px', marginBottom: '1rem' }}>
          <p style={{ color: '#dc2626', margin: 0 }}>
            ⚠️ You've reached the maximum of {maxNodes} nodes per operator.
            Deregister a node before adding more.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Staking Token */}
        <div style={{ marginBottom: '1.5rem' }}>
          <TokenSelector
            tokens={tokenOptions}
            selectedToken={stakingToken?.symbol}
            onSelect={setStakingToken}
            label="Staking Token (what you'll lock up)"
            placeholder="Choose token to stake..."
            showBalances={true}
            disabled={isRegistering || !canAddMore}
          />
        </div>

        {/* Amount */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Amount to Stake
          </label>
          <input
            className="input"
            type="number"
            step="any"
            placeholder="Amount"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            disabled={isRegistering || !stakingToken || !canAddMore}
          />
          {stakingToken && stakeAmount && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
              {stakeValueUSD >= minStakeUSD ? (
                <span style={{ color: '#16a34a' }}>
                  ✅ {formatUSD(stakeValueUSD)} (meets ${minStakeUSD.toLocaleString()} minimum)
                </span>
              ) : (
                <span style={{ color: '#dc2626' }}>
                  ❌ {formatUSD(stakeValueUSD)} (need ${minStakeUSD.toLocaleString()} minimum)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Reward Token */}
        <div style={{ marginBottom: '1.5rem' }}>
          <TokenSelector
            tokens={tokenOptions}
            selectedToken={rewardToken?.symbol}
            onSelect={setRewardToken}
            label="Reward Token (what you want to earn - can be different!)"
            placeholder="Choose reward token..."
            showBalances={false}
            disabled={isRegistering || !canAddMore}
          />
          {rewardToken && (
            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem' }}>
              Estimated: ~{(Number(estimatedMonthlyUSD) / 1e18 / rewardToken.priceUSD).toFixed(2)} {rewardToken.symbol}/month
              (≈ {formatUSD(Number(estimatedMonthlyUSD) / 1e18)}/month)
            </p>
          )}
        </div>

        {/* RPC URL */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            RPC URL
          </label>
          <input
            className="input"
            type="url"
            placeholder="https://your-node-ip:8545"
            value={rpcUrl}
            onChange={(e) => setRpcUrl(e.target.value)}
            disabled={isRegistering || !canAddMore}
          />
          <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            Your node's publicly accessible RPC endpoint
          </p>
        </div>

        {/* Region */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Geographic Region
          </label>
          <select
            className="input"
            value={region}
            onChange={(e) => setRegion(Number(e.target.value) as Region)}
            disabled={isRegistering || !canAddMore}
          >
            {Object.entries(REGION_NAMES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
                {(value === String(Region.Africa) || value === String(Region.SouthAmerica)) && ' (+50% bonus)'}
              </option>
            ))}
          </select>
          <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            Underserved regions earn geographic bonuses
          </p>
        </div>

        {/* Info Box */}
        <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
            <strong>⏱️ Minimum staking period:</strong> 7 days
          </p>
          <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
            <strong>🎯 Performance requirement:</strong> 99%+ uptime for full rewards
          </p>
          <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
            <strong>💰 Paymaster fees:</strong> 7% of rewards go to paymasters (in ETH)
          </p>
        </div>

        {isRegisterSuccess && (
          <div style={{ padding: '1rem', background: '#dcfce7', borderRadius: '8px', marginBottom: '1rem' }}>
            <p style={{ color: '#16a34a', margin: 0 }}>
              ✅ Node registered successfully! Check "My Nodes" to see details.
            </p>
          </div>
        )}

        <button
          type="submit"
          className="button"
          style={{ width: '100%' }}
          disabled={!isValid || isRegistering || !canAddMore}
        >
          {isRegistering ? 'Staking & Registering...' : 'Stake & Register Node'}
        </button>
      </form>
    </div>
  );
}

