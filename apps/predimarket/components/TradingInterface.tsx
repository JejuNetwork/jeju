'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import type { Market } from '@/types';
// import { ApprovalButton } from './ApprovalButton';  // Will enable when contracts deployed

const PREDIMARKET_ADDRESS = (process.env.NEXT_PUBLIC_PREDIMARKET_ADDRESS || '0x0') as `0x${string}`;
const ELIZAOS_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_ELIZA_OS_ADDRESS || '0x0') as `0x${string}`;

export function TradingInterface({ market }: { market: Market }) {
  const { address, isConnected } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });
  
  const [outcome, setOutcome] = useState<boolean>(true);
  const [amount, setAmount] = useState<string>('100');
  const [error, setError] = useState<string>('');
  // const [isApproved, setIsApproved] = useState<boolean>(false);  // Will enable when contracts deployed

  const handleBuy = async () => {
    if (!isConnected) {
      setError('Please connect your wallet');
      return;
    }

    try {
      setError('');
      const amountWei = parseEther(amount);
      
      writeContract({
        address: PREDIMARKET_ADDRESS,
        abi: [{
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
        }],
        functionName: 'buy',
        args: [market.sessionId as `0x${string}`, outcome, amountWei, 0n, ELIZAOS_TOKEN_ADDRESS],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    }
  };

  const yesPercent = Number(market.yesPrice) / 1e16;
  const noPercent = Number(market.noPrice) / 1e16;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="trading-interface">
      <h2 className="text-lg font-bold text-white mb-4">Place Bet</h2>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setOutcome(true)}
          className={`px-4 py-3 rounded-lg font-medium transition ${
            outcome
              ? 'bg-green-600 text-white ring-2 ring-green-400'
              : 'bg-gray-800 text-gray-400'
          }`}
          data-testid="outcome-yes-button"
        >
          YES {yesPercent.toFixed(1)}%
        </button>
        <button
          onClick={() => setOutcome(false)}
          className={`px-4 py-3 rounded-lg font-medium transition ${
            !outcome
              ? 'bg-red-600 text-white ring-2 ring-red-400'
              : 'bg-gray-800 text-gray-400'
          }`}
          data-testid="outcome-no-button"
        >
          NO {noPercent.toFixed(1)}%
        </button>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-400 mb-2">Amount</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white"
          placeholder="100"
          data-testid="amount-input"
        />
      </div>

      {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500 rounded-lg text-red-400 text-sm" data-testid="error-message">{error}</div>}

      {/* Approval button - shows if user hasn't approved token yet */}
      {/* Temporarily disabled for initial testing - will enable once contracts deployed */}
      {/* {isConnected && !isApproved && (
        <ApprovalButton
          tokenAddress={ELIZAOS_TOKEN_ADDRESS}
          spenderAddress={PREDIMARKET_ADDRESS}
          amount={amount}
          onApproved={() => setIsApproved(true)}
          tokenSymbol="ETH"
        />
      )} */}

      <button
        onClick={handleBuy}
        disabled={!isConnected || isPending || isConfirming}
        className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white font-bold rounded-lg transition"
        data-testid="buy-button"
      >
        {isPending || isConfirming ? 'Confirming...' : `Buy ${outcome ? 'YES' : 'NO'}`}
      </button>

      {/* {!isApproved && isConnected && (
        <p className="mt-2 text-xs text-gray-400 text-center">
          You need to approve ETH spending before buying shares
        </p>
      )} */}
    </div>
  );
}
