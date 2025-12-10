'use client';

import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import type { Market } from '@/types/markets';
import { checkUserBan } from '@/lib/erc8004';
import { calculateExpectedShares } from '@/lib/markets/lmsrPricing';
import { toast } from 'sonner';
import { CONTRACTS } from '@/config';

const PREDIMARKET_ADDRESS = CONTRACTS.predimarket;
const ELIZAOS_TOKEN_ADDRESS = CONTRACTS.elizaOS;

const BUY_ABI = [{
  name: 'buy',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'outcome', type: 'bool' },
    { name: 'tokenAmount', type: 'uint256' },
    { name: 'minShares', type: 'uint256' },
    { name: 'token', type: 'address' }
  ],
  outputs: [{ name: 'shares', type: 'uint256' }]
}] as const;

export function TradingInterface({ market }: { market: Market }) {
  const { address, isConnected } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });
  
  const [outcome, setOutcome] = useState<boolean>(true);
  const [amount, setAmount] = useState<string>('100');
  const [banReason, setBanReason] = useState<string | null>(null);

  useEffect(() => {
    if (address) {
      checkUserBan(address, 'markets').then(result => {
        if (!result.allowed) setBanReason(result.reason || 'Banned');
      });
    }
  }, [address]);

  const handleBuy = () => {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    if (banReason) {
      toast.error('Trading not allowed', { description: banReason });
      return;
    }

    const amountWei = parseEther(amount);
    const currentPrice = outcome ? market.yesPrice : market.noPrice;
    const expectedShares = calculateExpectedShares(amountWei, currentPrice);
    const minShares = (expectedShares * 95n) / 100n;
    
    writeContract({
      address: PREDIMARKET_ADDRESS,
      abi: BUY_ABI,
      functionName: 'buy',
      args: [market.sessionId as `0x${string}`, outcome, amountWei, minShares, ELIZAOS_TOKEN_ADDRESS],
    });
  };

  const yesPercent = Number(market.yesPrice) / 1e16;
  const noPercent = Number(market.noPrice) / 1e16;

  if (banReason) {
    return (
      <div className="card p-5 md:p-6 border-bazaar-error/50 bg-bazaar-error/10" data-testid="trading-banned">
        <h2 className="text-lg font-bold text-bazaar-error mb-2">Trading Restricted</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{banReason}</p>
      </div>
    );
  }

  return (
    <div className="card p-5 md:p-6" data-testid="trading-interface">
      <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        Place Bet
      </h2>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setOutcome(true)}
          className={`px-4 py-3 rounded-xl font-medium transition ${
            outcome 
              ? 'bg-bazaar-success text-white ring-2 ring-bazaar-success/50' 
              : ''
          }`}
          style={!outcome ? { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' } : undefined}
          data-testid="outcome-yes-button"
        >
          YES {yesPercent.toFixed(1)}%
        </button>
        <button
          onClick={() => setOutcome(false)}
          className={`px-4 py-3 rounded-xl font-medium transition ${
            !outcome 
              ? 'bg-bazaar-error text-white ring-2 ring-bazaar-error/50' 
              : ''
          }`}
          style={outcome ? { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' } : undefined}
          data-testid="outcome-no-button"
        >
          NO {noPercent.toFixed(1)}%
        </button>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
          Amount
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input"
          placeholder="100"
          data-testid="amount-input"
        />
      </div>

      <button
        onClick={handleBuy}
        disabled={!isConnected || isPending || isConfirming}
        className="btn-accent w-full py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="buy-button"
      >
        {isPending || isConfirming ? 'Confirming...' : `Buy ${outcome ? 'YES' : 'NO'}`}
      </button>
    </div>
  );
}
