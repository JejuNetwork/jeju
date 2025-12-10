import { useState, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { parseEther, formatEther, type Address } from 'viem';
import { useXLPLiquidity, useXLPRegistration, useXLPPosition, useEILConfig } from '../hooks/useEIL';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import TokenSelector from './TokenSelector';
import type { TokenOption } from './TokenSelector';
import { Clock, CheckCircle, XCircle } from 'lucide-react';

const INDEXER_URL = import.meta.env.VITE_INDEXER_URL || 'http://localhost:4350/graphql';

interface VoucherHistoryItem {
  id: string;
  requestId: string;
  sourceAmount: string;
  sourceToken: string;
  destinationToken: string;
  destinationChain: number;
  recipient: string;
  status: 'PENDING' | 'FULFILLED' | 'EXPIRED' | 'REFUNDED';
  createdAt: string;
  fulfilledAt?: string;
  feeEarned?: string;
}

async function fetchXLPVoucherHistory(xlpAddress: string): Promise<VoucherHistoryItem[]> {
  const query = `
    query XLPVoucherHistory($xlp: String!) {
      voucherFulfillments(
        where: { xlp_eq: $xlp }
        orderBy: createdAt_DESC
        limit: 50
      ) {
        id
        voucherRequest {
          requestId
          sourceAmount
          sourceToken
          destinationToken
          destinationChain
          recipient
          status
          createdAt
        }
        feeEarned
        fulfilledAt
      }
    }
  `;

  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { xlp: xlpAddress.toLowerCase() } }),
  });

  if (!response.ok) return [];

  const { data } = await response.json();
  const fulfillments = data?.voucherFulfillments || [];

  return fulfillments.map((f: { voucherRequest: VoucherHistoryItem; feeEarned: string; fulfilledAt: string }) => ({
    id: f.voucherRequest.requestId,
    requestId: f.voucherRequest.requestId,
    sourceAmount: f.voucherRequest.sourceAmount,
    sourceToken: f.voucherRequest.sourceToken,
    destinationToken: f.voucherRequest.destinationToken,
    destinationChain: f.voucherRequest.destinationChain,
    recipient: f.voucherRequest.recipient,
    status: f.voucherRequest.status,
    createdAt: f.voucherRequest.createdAt,
    fulfilledAt: f.fulfilledAt,
    feeEarned: f.feeEarned,
  }));
}

type TabType = 'overview' | 'liquidity' | 'stake' | 'history';

const SUPPORTED_CHAINS = [
  { id: 420691, name: 'Jeju Mainnet' },
  { id: 420690, name: 'Jeju Testnet' },
  { id: 1, name: 'Ethereum' },
  { id: 42161, name: 'Arbitrum' },
  { id: 10, name: 'Optimism' },
  { id: 11155111, name: 'Sepolia' },
] as const;

export default function XLPDashboard() {
  const { isConnected } = useAccount();
  const { crossChainPaymaster, l1StakeManager } = useEILConfig();
  
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [ethAmount, setEthAmount] = useState('');
  const [stakeAmount, setStakeAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState<TokenOption | null>(null);
  const [tokenAmount, setTokenAmount] = useState('');
  const [selectedChains, setSelectedChains] = useState<number[]>([420691, 1]);

  const { tokens } = useProtocolTokens();
  const tokenOptions = useMemo(() => tokens.map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
  })), [tokens]);

  const {
    ethBalance: xlpETH,
    depositETH,
    withdrawETH,
    depositToken,
    isLoading: isLiquidityLoading,
    isSuccess: isLiquiditySuccess,
  } = useXLPLiquidity(crossChainPaymaster);

  const { position } = useXLPPosition(l1StakeManager);
  const UNBONDING_PERIOD = 691200;
  
  const stake = useMemo(() => position ? {
    stakedAmount: position.stakedAmount,
    unbondingAmount: position.unbondingAmount,
    isActive: position.isActive,
  } : null, [position]);
  
  const supportedChains = useMemo(() => position?.supportedChains || [], [position]);
  
  const unbondingTimeRemaining = useMemo(() => position?.unbondingStartTime 
    ? BigInt(Math.max(0, position.unbondingStartTime + UNBONDING_PERIOD - Math.floor(Date.now() / 1000)))
    : 0n, [position?.unbondingStartTime]);
  const {
    register,
    addStake,
    startUnbonding,
    completeUnbonding,
    isLoading: isStakeLoading,
    isSuccess: isStakeSuccess,
  } = useXLPRegistration(l1StakeManager);

  const isLoading = isLiquidityLoading || isStakeLoading;

  const handleDepositETH = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseEther(ethAmount);
    await depositETH(amount);
    setEthAmount('');
  };

  const handleWithdrawETH = async () => {
    if (!xlpETH) return;
    await withdrawETH(xlpETH);
  };

  const handleDepositToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedToken) return;
    const amount = parseEther(tokenAmount);
    await depositToken(selectedToken.address as Address, amount);
    setTokenAmount('');
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseEther(stakeAmount);
    await register(selectedChains, amount);
    setStakeAmount('');
  };

  const handleAddStake = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseEther(stakeAmount);
    await addStake(amount);
    setStakeAmount('');
  };

  const toggleChain = (chainId: number) => {
    if (selectedChains.includes(chainId)) {
      setSelectedChains(selectedChains.filter(c => c !== chainId));
    } else {
      setSelectedChains([...selectedChains, chainId]);
    }
  };

  if (!isConnected) {
    return (
      <div className="card">
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>XLP Dashboard</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Connect your wallet to manage XLP liquidity</p>
      </div>
    );
  }

  if (!crossChainPaymaster || !l1StakeManager) {
    return (
      <div className="card">
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>XLP Dashboard</h2>
        <div style={{ padding: '1rem', background: 'var(--warning-soft)', borderRadius: '8px' }}>
          <p style={{ color: 'var(--warning)', margin: 0 }}>
            EIL contracts not configured. Please deploy EIL first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.25rem', margin: '0 0 1.5rem', fontWeight: 700 }}>XLP Dashboard</h2>

        <div style={{ 
          display: 'flex', 
          gap: '0.25rem', 
          marginBottom: '1.5rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.75rem',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
          {(['overview', 'liquidity', 'stake', 'history'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: 'none',
                background: activeTab === tab ? 'var(--info)' : 'transparent',
                color: activeTab === tab ? 'white' : 'var(--text-secondary)',
                fontWeight: '600',
                fontSize: '0.8125rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div>
            <div className="grid grid-2" style={{ gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ 
                padding: '1.5rem', 
                background: 'var(--surface-hover)', 
                borderRadius: '12px',
                textAlign: 'center' 
              }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>L1 Stake</p>
                <p style={{ fontSize: '1.5rem', fontWeight: '700', margin: '0.5rem 0' }}>
                  {stake ? formatEther(stake.stakedAmount) : '0'} ETH
                </p>
                <p style={{ 
                  fontSize: '0.75rem', 
                  color: stake?.isActive ? 'var(--success)' : 'var(--error)',
                  fontWeight: '600'
                }}>
                  {stake?.isActive ? '● Active' : '○ Inactive'}
                </p>
              </div>
              
              <div style={{ 
                padding: '1.5rem', 
                background: 'var(--surface-hover)', 
                borderRadius: '12px',
                textAlign: 'center' 
              }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>L2 ETH Liquidity</p>
                <p style={{ fontSize: '1.5rem', fontWeight: '700', margin: '0.5rem 0' }}>
                  {xlpETH ? formatEther(xlpETH) : '0'} ETH
                </p>
                <p style={{ fontSize: '0.75rem', color: 'var(--info)' }}>Available for gas</p>
              </div>
            </div>

            <div style={{ 
              padding: '1rem', 
              background: 'var(--success-soft)', 
              borderRadius: '12px',
              border: '1px solid var(--success)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span>Supported Chains</span>
                <span style={{ fontWeight: '600' }}>
                  {supportedChains?.length || 0}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {supportedChains?.map((chainId: number) => {
                  const chain = SUPPORTED_CHAINS.find(c => c.id === chainId);
                  return chain ? (
                    <span 
                      key={chain.id}
                      style={{
                        padding: '0.25rem 0.5rem',
                        background: 'var(--surface)',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        color: 'var(--success)'
                      }}
                    >
                      {chain.name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'liquidity' && (
          <div>
            <div style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>ETH Liquidity (Gas Sponsorship)</h3>
              
              <div style={{ 
                padding: '1rem', 
                background: 'var(--surface-hover)', 
                borderRadius: '12px',
                marginBottom: '1rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Current Balance</span>
                  <span style={{ fontSize: '1.25rem', fontWeight: '700' }}>
                    {xlpETH ? formatEther(xlpETH) : '0'} ETH
                  </span>
                </div>
              </div>

              <form onSubmit={handleDepositETH}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    placeholder="0.0"
                    value={ethAmount}
                    onChange={(e) => setEthAmount(e.target.value)}
                    disabled={isLoading}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="submit"
                    className="button"
                    disabled={isLoading || !ethAmount}
                  >
                    Deposit ETH
                  </button>
                </div>
              </form>

              {xlpETH && xlpETH > 0n && (
                <button
                  className="button button-secondary"
                  style={{ width: '100%', marginTop: '0.5rem' }}
                  onClick={handleWithdrawETH}
                  disabled={isLoading}
                >
                  Withdraw All ETH
                </button>
              )}
            </div>

            <div>
              <h3 style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>Token Liquidity</h3>
              
              <TokenSelector
                tokens={tokenOptions}
                selectedToken={selectedToken?.symbol}
                onSelect={setSelectedToken}
                label="Select Token"
                placeholder="Choose token..."
                disabled={isLoading}
              />

              {selectedToken && (
                <form onSubmit={handleDepositToken} style={{ marginTop: '1rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      className="input"
                      type="number"
                      step="any"
                      placeholder="0.0"
                      value={tokenAmount}
                      onChange={(e) => setTokenAmount(e.target.value)}
                      disabled={isLoading}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="submit"
                      className="button"
                      disabled={isLoading || !tokenAmount}
                    >
                      Deposit {selectedToken.symbol}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {activeTab === 'stake' && (
          <div>
            {!stake?.isActive ? (
              <div>
                <h3 style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>Register as XLP</h3>
                
                <div style={{ 
                  padding: '1rem', 
                  background: 'var(--info-soft)', 
                  borderRadius: '12px',
                  marginBottom: '1.5rem'
                }}>
                  <p style={{ fontSize: '0.875rem', margin: 0, color: 'var(--info)' }}>
                    <strong>Requirements:</strong> Minimum 1 ETH stake, 8-day unbonding period
                  </p>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                    Supported Chains
                  </label>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', 
                    gap: '0.375rem' 
                  }}>
                    {SUPPORTED_CHAINS.map((chain) => (
                      <button
                        key={chain.id}
                        type="button"
                        onClick={() => toggleChain(chain.id)}
                        style={{
                          padding: '0.375rem 0.5rem',
                          borderRadius: '6px',
                          border: selectedChains.includes(chain.id) 
                            ? '2px solid var(--info)' 
                            : '2px solid var(--border)',
                          background: selectedChains.includes(chain.id) 
                            ? 'var(--info-soft)' 
                            : 'white',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                        }}
                      >
                        {chain.name}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleRegister}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                    Initial Stake (min 1 ETH)
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    min="1"
                    placeholder="1.0"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    disabled={isLoading}
                    style={{ marginBottom: '1rem' }}
                  />
                  <button
                    type="submit"
                    className="button"
                    style={{ width: '100%' }}
                    disabled={isLoading || !stakeAmount || selectedChains.length === 0}
                  >
                    Register as XLP
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <div className="grid grid-2" style={{ gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ 
                    padding: '1.5rem', 
                    background: 'var(--success-soft)', 
                    borderRadius: '12px',
                    textAlign: 'center' 
                  }}>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>Active Stake</p>
                    <p style={{ fontSize: '1.5rem', fontWeight: '700', margin: '0.5rem 0', color: 'var(--success)' }}>
                      {formatEther(stake.stakedAmount)} ETH
                    </p>
                  </div>
                  
                  {stake.unbondingAmount > 0n && (
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'var(--warning-soft)', 
                      borderRadius: '12px',
                      textAlign: 'center' 
                    }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>Unbonding</p>
                      <p style={{ fontSize: '1.5rem', fontWeight: '700', margin: '0.5rem 0', color: 'var(--warning)' }}>
                        {formatEther(stake.unbondingAmount)} ETH
                      </p>
                      {unbondingTimeRemaining && unbondingTimeRemaining > 0n && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--warning)' }}>
                          {Math.ceil(Number(unbondingTimeRemaining) / 86400)} days remaining
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <form onSubmit={handleAddStake} style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                    Add Stake
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      className="input"
                      type="number"
                      step="0.1"
                      placeholder="0.0"
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                      disabled={isLoading}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="submit"
                      className="button"
                      disabled={isLoading || !stakeAmount}
                    >
                      Add Stake
                    </button>
                  </div>
                </form>

                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: stake.unbondingAmount > 0n && unbondingTimeRemaining === 0n 
                    ? 'repeat(auto-fit, minmax(130px, 1fr))' 
                    : '1fr',
                  gap: '0.5rem' 
                }}>
                  <button
                    className="button button-secondary"
                    onClick={() => stake && startUnbonding(stake.stakedAmount)}
                    disabled={isLoading || stake.unbondingAmount > 0n}
                  >
                    Start Unbonding
                  </button>
                  {stake.unbondingAmount > 0n && unbondingTimeRemaining === 0n && (
                    <button
                      className="button"
                      onClick={() => completeUnbonding()}
                      disabled={isLoading}
                    >
                      Complete Unbonding
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <VoucherHistory />
        )}
      </div>

      {(isLiquiditySuccess || isStakeSuccess) && (
        <div style={{ 
          padding: '1rem', 
          background: 'var(--success-soft)', 
          borderRadius: '8px',
          marginTop: '1rem'
        }}>
          <p style={{ color: 'var(--success)', margin: 0, fontWeight: '600' }}>
            ✓ Transaction successful!
          </p>
        </div>
      )}
    </div>
  );
}

function VoucherHistory() {
  const { address } = useAccount();
  
  const { data: history = [], isLoading, error } = useQuery({
    queryKey: ['xlp-voucher-history', address],
    queryFn: () => fetchXLPVoucherHistory(address!),
    enabled: !!address,
    refetchInterval: 30000,
  });

  if (!address) {
    return (
      <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
        Connect wallet to view history
      </p>
    );
  }

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Loading history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
        Unable to load voucher history. Indexer may be unavailable.
      </p>
    );
  }

  if (history.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <p style={{ color: 'var(--text-secondary)' }}>No vouchers fulfilled yet</p>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          When you fulfill voucher requests as an XLP, they will appear here
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {history.map((item) => {
        const statusIcon = item.status === 'FULFILLED' ? (
          <CheckCircle size={18} style={{ color: 'var(--success)' }} />
        ) : item.status === 'EXPIRED' || item.status === 'REFUNDED' ? (
          <XCircle size={18} style={{ color: 'var(--error)' }} />
        ) : (
          <Clock size={18} style={{ color: 'var(--warning)' }} />
        );

        const amountEth = (Number(BigInt(item.sourceAmount)) / 1e18).toFixed(4);
        const feeEth = item.feeEarned ? (Number(BigInt(item.feeEarned)) / 1e18).toFixed(6) : '0';

        return (
          <div
            key={item.id}
            style={{
              padding: '1rem',
              background: 'var(--surface-hover)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem'
            }}
          >
            {statusIcon}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: '600' }}>{amountEth} ETH</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: '600' }}>
                  +{feeEth} ETH fee
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {item.recipient.slice(0, 10)}... → Chain {item.destinationChain}
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                {new Date(item.createdAt).toLocaleString()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

