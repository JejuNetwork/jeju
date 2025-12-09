import { useState, useCallback } from 'react';
import { X, ArrowRight, Zap, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { useAccount, useWriteContract, useSwitchChain } from 'wagmi';
import { parseEther } from 'viem';
import { useSupportedChains, useIntentQuote } from '../hooks/useOIF';
import { OIF_CONTRACTS } from '../wagmi';

interface CreateIntentProps {
  onClose: () => void;
}

// InputSettler ABI for createIntent
const INPUT_SETTLER_ABI = [
  {
    type: 'function',
    name: 'createIntent',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'sourceChainId', type: 'uint256' },
          { name: 'targetChainId', type: 'uint256' },
          { name: 'sourceToken', type: 'address' },
          { name: 'targetToken', type: 'address' },
          { name: 'sourceAmount', type: 'uint256' },
          { name: 'targetAddress', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'resolver', type: 'address' },
          { name: 'resolverFee', type: 'uint256' },
          { name: 'refundAddress', type: 'address' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'intentId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
] as const;

type TxStatus = 'idle' | 'preparing' | 'pending' | 'confirming' | 'success' | 'error';

export function CreateIntent({ onClose }: CreateIntentProps) {
  const { data: chains } = useSupportedChains();
  const [sourceChain, setSourceChain] = useState(1);
  const [destChain, setDestChain] = useState(42161);
  const [amount, setAmount] = useState('0.1');
  const [token] = useState('0x0000000000000000000000000000000000000000');
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [intentId, setIntentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { address, isConnected, chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const { data: quotes, isLoading: quotesLoading } = useIntentQuote({
    sourceChain,
    destinationChain: destChain,
    sourceToken: token,
    destinationToken: token,
    amount: (parseFloat(amount) * 1e18).toString(),
  });

  const bestQuote = quotes?.[0];
  
  const inputSettlerAddress = OIF_CONTRACTS.inputSettlers[sourceChain as keyof typeof OIF_CONTRACTS.inputSettlers];
  const isCorrectChain = chain?.id === sourceChain;
  const canSubmit = isConnected && inputSettlerAddress && parseFloat(amount) > 0;

  const handleSubmit = useCallback(async () => {
    if (!address || !inputSettlerAddress) return;
    
    setError(null);
    setTxStatus('preparing');
    
    // Switch chain if needed
    if (!isCorrectChain) {
      setTxStatus('preparing');
      await switchChain({ chainId: sourceChain });
    }

    const amountWei = parseEther(amount);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour deadline
    const nonce = BigInt(Date.now());

    const order = {
      sourceChainId: BigInt(sourceChain),
      targetChainId: BigInt(destChain),
      sourceToken: token as `0x${string}`,
      targetToken: token as `0x${string}`,
      sourceAmount: amountWei,
      targetAddress: address,
      deadline,
      data: '0x' as `0x${string}`,
      resolver: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      resolverFee: 0n,
      refundAddress: address,
      nonce,
    };

    setTxStatus('pending');

    const hash = await writeContractAsync({
      address: inputSettlerAddress,
      abi: INPUT_SETTLER_ABI,
      functionName: 'createIntent',
      args: [order],
      value: token === '0x0000000000000000000000000000000000000000' ? amountWei : undefined,
    });

    setTxStatus('confirming');
    console.log('Intent tx submitted:', hash);

    // Wait for confirmation (in real app, use useWaitForTransactionReceipt)
    // For now, just show success after a delay
    setTimeout(() => {
      setTxStatus('success');
      setIntentId(hash);
    }, 2000);
  }, [address, amount, destChain, inputSettlerAddress, isCorrectChain, sourceChain, switchChain, token, writeContractAsync]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-accent)',
          borderRadius: '20px',
          padding: '32px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Create Intent</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Cross-chain swap via OIF
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              padding: '8px',
              borderRadius: '8px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Source Chain */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              From
            </label>
            <div style={{ display: 'flex', gap: '12px' }}>
              <select
                value={sourceChain}
                onChange={(e) => setSourceChain(Number(e.target.value))}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                }}
              >
                {chains?.map((chain) => (
                  <option key={chain.chainId} value={chain.chainId}>
                    {chain.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                style={{
                  width: '120px',
                  padding: '12px 16px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '16px',
                  fontFamily: 'var(--font-mono)',
                  textAlign: 'right',
                }}
              />
            </div>
          </div>

          {/* Arrow */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <ArrowRight size={18} color="var(--text-secondary)" style={{ transform: 'rotate(90deg)' }} />
            </div>
          </div>

          {/* Destination Chain */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              To
            </label>
            <select
              value={destChain}
              onChange={(e) => setDestChain(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                color: 'var(--text-primary)',
                fontSize: '14px',
              }}
            >
              {chains?.filter(c => c.chainId !== sourceChain).map((chain) => (
                <option key={chain.chainId} value={chain.chainId}>
                  {chain.name}
                </option>
              ))}
            </select>
          </div>

          {/* Quote Info */}
          {bestQuote && (
            <div style={{
              padding: '16px',
              background: 'var(--bg-tertiary)',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>You'll receive</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {(parseFloat(bestQuote.outputAmount) / 1e18).toFixed(4)} ETH
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Fee</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--warning)' }}>
                  {(bestQuote.feePercent / 100).toFixed(2)}%
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Est. Time</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-accent)' }}>
                  ~{bestQuote.estimatedFillTimeSeconds}s
                </span>
              </div>
            </div>
          )}

          {quotesLoading && (
            <div style={{
              padding: '16px',
              background: 'var(--bg-tertiary)',
              borderRadius: '12px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '13px',
            }}>
              Fetching quotes...
            </div>
          )}

          {/* Status Messages */}
          {!isConnected && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px',
              background: 'var(--warning)10',
              border: '1px solid var(--warning)30',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--warning)',
            }}>
              <AlertCircle size={16} />
              Connect wallet to create intent
            </div>
          )}

          {isConnected && !isCorrectChain && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px',
              background: 'var(--warning)10',
              border: '1px solid var(--warning)30',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--warning)',
            }}>
              <AlertCircle size={16} />
              Switch to source chain to create intent
            </div>
          )}

          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px',
              background: 'var(--error)10',
              border: '1px solid var(--error)30',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--error)',
            }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {txStatus === 'success' && intentId && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px',
              background: 'var(--success)10',
              border: '1px solid var(--success)30',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--success)',
            }}>
              <CheckCircle size={16} />
              Intent created! ID: {intentId.slice(0, 10)}...
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || txStatus === 'pending' || txStatus === 'confirming'}
            style={{
              width: '100%',
              padding: '16px',
              background: canSubmit && txStatus === 'idle'
                ? 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))'
                : 'var(--bg-tertiary)',
              border: canSubmit ? 'none' : '1px solid var(--border-subtle)',
              borderRadius: '12px',
              color: canSubmit ? 'var(--bg-primary)' : 'var(--text-secondary)',
              fontSize: '16px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: canSubmit && txStatus === 'idle' ? 'pointer' : 'not-allowed',
            }}
          >
            {txStatus === 'pending' || txStatus === 'confirming' ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                {txStatus === 'pending' ? 'Confirm in wallet...' : 'Confirming...'}
              </>
            ) : txStatus === 'success' ? (
              <>
                <CheckCircle size={18} />
                Intent Created
              </>
            ) : !isConnected ? (
              'Connect Wallet'
            ) : !isCorrectChain ? (
              'Switch Network'
            ) : (
              <>
                <Zap size={18} />
                Create Intent
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

