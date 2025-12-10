import { useState, useCallback, useEffect } from 'react';
import { X, ArrowRight, Zap, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { useAccount, useWriteContract, useSwitchChain, useChainId, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { useSupportedChains, useIntentQuote } from '../../hooks/useIntentAPI';
import { useOIFConfig } from '../../hooks/useOIF';

interface CreateIntentModalProps {
  onClose: () => void;
}

const INPUT_SETTLER_ABI = [
  { type: 'function', name: 'createIntent', inputs: [{ name: 'order', type: 'tuple', components: [{ name: 'sourceChainId', type: 'uint256' }, { name: 'targetChainId', type: 'uint256' }, { name: 'sourceToken', type: 'address' }, { name: 'targetToken', type: 'address' }, { name: 'sourceAmount', type: 'uint256' }, { name: 'targetAddress', type: 'address' }, { name: 'deadline', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'resolver', type: 'address' }, { name: 'resolverFee', type: 'uint256' }, { name: 'refundAddress', type: 'address' }, { name: 'nonce', type: 'uint256' }] }], outputs: [{ name: 'intentId', type: 'bytes32' }], stateMutability: 'payable' },
] as const;

type TxStatus = 'idle' | 'preparing' | 'pending' | 'confirming' | 'success' | 'error';

export function CreateIntentModal({ onClose }: CreateIntentModalProps) {
  const { data: chains } = useSupportedChains();
  const oifConfig = useOIFConfig();
  const chainId = useChainId();
  
  const [sourceChain, setSourceChain] = useState(chainId || 1);
  const [destChain, setDestChain] = useState(42161);
  const [amount, setAmount] = useState('0.1');
  const [token] = useState('0x0000000000000000000000000000000000000000');
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [intentId, setIntentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { address, isConnected, chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync, data: txHash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Update status when transaction confirms
  useEffect(() => {
    if (isConfirming) setTxStatus('confirming');
    if (isConfirmed) {
      setTxStatus('success');
      if (txHash) setIntentId(txHash);
    }
  }, [isConfirming, isConfirmed, txHash]);

  const { data: quotes, isLoading: quotesLoading } = useIntentQuote({
    sourceChain,
    destinationChain: destChain,
    sourceToken: token,
    destinationToken: token,
    amount: (parseFloat(amount) * 1e18).toString(),
  });

  const bestQuote = quotes?.[0];
  const inputSettlerAddress = oifConfig.inputSettlers[sourceChain as keyof typeof oifConfig.inputSettlers];
  const isCorrectChain = chain?.id === sourceChain;
  const canSubmit = isConnected && inputSettlerAddress && parseFloat(amount) > 0;

  const handleSubmit = useCallback(async () => {
    if (!address || !inputSettlerAddress) return;
    
    setError(null);
    setTxStatus('preparing');
    
    if (!isCorrectChain) {
      try {
        await switchChain({ chainId: sourceChain });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to switch network');
        setTxStatus('error');
        return;
      }
    }

    const amountWei = parseEther(amount);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
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
    try {
      await writeContractAsync({
        address: inputSettlerAddress,
        abi: INPUT_SETTLER_ABI,
        functionName: 'createIntent',
        args: [order],
        value: token === '0x0000000000000000000000000000000000000000' ? amountWei : undefined,
      });
      // Status updates handled by useEffect watching isConfirming/isConfirmed
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed');
      setTxStatus('error');
    }
  }, [address, amount, destChain, inputSettlerAddress, isCorrectChain, sourceChain, switchChain, token, writeContractAsync]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={onClose}>
      <div className="card" style={{ margin: 0, padding: 'clamp(1rem, 4vw, 2rem)', width: '100%', maxWidth: '480px', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: 'clamp(1.125rem, 4vw, 1.25rem)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Create Intent</h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>Cross-chain swap via OIF</p>
          </div>
          <button onClick={onClose} className="button button-ghost" style={{ padding: '0.5rem', flexShrink: 0 }}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>From</label>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <select className="input" value={sourceChain} onChange={(e) => setSourceChain(Number(e.target.value))} style={{ flex: '1 1 140px', minWidth: 0 }}>
                {chains?.map((c) => <option key={c.chainId} value={c.chainId}>{c.name}</option>)}
              </select>
              <input className="input" type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" style={{ width: '110px', fontFamily: 'var(--font-mono)', textAlign: 'right', flexShrink: 0 }} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-md)', background: 'var(--surface-hover)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowRight size={16} color="var(--text-muted)" style={{ transform: 'rotate(90deg)' }} />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>To</label>
            <select className="input" value={destChain} onChange={(e) => setDestChain(Number(e.target.value))}>
              {chains?.filter(c => c.chainId !== sourceChain).map((c) => <option key={c.chainId} value={c.chainId}>{c.name}</option>)}
            </select>
          </div>

          {bestQuote && (
            <div style={{ padding: '1rem', background: 'var(--surface-hover)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>You'll receive</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{(parseFloat(bestQuote.outputAmount) / 1e18).toFixed(4)} ETH</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Fee</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--warning)' }}>{(bestQuote.feePercent / 100).toFixed(2)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Est. Time</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>~{bestQuote.estimatedFillTimeSeconds}s</span>
              </div>
            </div>
          )}

          {quotesLoading && <div style={{ padding: '1rem', background: 'var(--surface-hover)', borderRadius: 'var(--radius-md)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Fetching quotes...</div>}

          {!isConnected && (
            <div className="banner banner-warning" style={{ fontSize: '0.75rem' }}><AlertCircle size={16} />Connect wallet to create intent</div>
          )}

          {isConnected && !isCorrectChain && (
            <div className="banner banner-warning" style={{ fontSize: '0.75rem' }}><AlertCircle size={16} />Switch to source chain to create intent</div>
          )}

          {error && (
            <div className="banner" style={{ background: 'var(--error-soft)', border: '1px solid var(--error)', color: 'var(--error)', fontSize: '0.75rem' }}><AlertCircle size={16} />{error}</div>
          )}

          {txStatus === 'success' && intentId && (
            <div className="banner banner-success" style={{ fontSize: '0.75rem' }}><CheckCircle size={16} />Intent created! ID: {intentId.slice(0, 10)}...</div>
          )}

          <button
            className="button"
            onClick={handleSubmit}
            disabled={!canSubmit || txStatus === 'pending' || txStatus === 'confirming'}
            style={{ width: '100%', padding: '1rem' }}
          >
            {txStatus === 'pending' || txStatus === 'confirming' ? (
              <><Loader2 size={18} className="animate-spin" />{txStatus === 'pending' ? 'Confirm in wallet...' : 'Confirming...'}</>
            ) : txStatus === 'success' ? (
              <><CheckCircle size={18} />Intent Created</>
            ) : !isConnected ? (
              'Connect Wallet'
            ) : !isCorrectChain ? (
              'Switch Network'
            ) : (
              <><Zap size={18} />Create Intent</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
