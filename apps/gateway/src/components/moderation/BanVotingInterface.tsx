/**
 * Ban Voting Interface
 * Vote on ban proposals via Predimarket futarchy markets
 */

'use client';

import { useState } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { MODERATION_CONTRACTS } from '../../config/moderation';

interface BanVotingInterfaceProps {
  reportId: bigint;
  marketId: `0x${string}`;
}

const PREDIMARKET_ABI = [
  {
    name: 'getMarket',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'sessionId', type: 'bytes32' },
          { name: 'question', type: 'string' },
          { name: 'yesShares', type: 'uint256' },
          { name: 'noShares', type: 'uint256' },
          { name: 'liquidityParameter', type: 'uint256' },
          { name: 'totalVolume', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'resolved', type: 'bool' },
          { name: 'outcome', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getMarketPrices',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [
      { name: 'yesPrice', type: 'uint256' },
      { name: 'noPrice', type: 'uint256' },
    ],
  },
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'outcome', type: 'bool' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'minShares', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
] as const;

const REPORTING_SYSTEM_ABI = [
  {
    name: 'getReport',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'reportId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'reportId', type: 'uint256' },
          { name: 'reportType', type: 'uint8' },
          { name: 'severity', type: 'uint8' },
          { name: 'targetAgentId', type: 'uint256' },
          { name: 'sourceAppId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'reporterAgentId', type: 'uint256' },
          { name: 'evidenceHash', type: 'bytes32' },
          { name: 'details', type: 'string' },
          { name: 'marketId', type: 'bytes32' },
          { name: 'reportBond', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'votingEnds', type: 'uint256' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
] as const;

export default function BanVotingInterface({ reportId, marketId }: BanVotingInterfaceProps) {
  const [voteAmount, setVoteAmount] = useState('0.01');
  const [votingFor, setVotingFor] = useState<boolean | null>(null); // true = YES, false = NO

  // Query report details
  const { data: report } = useReadContract({
    address: MODERATION_CONTRACTS.ReportingSystem as `0x${string}`,
    abi: REPORTING_SYSTEM_ABI,
    functionName: 'getReport',
    args: [reportId],
  });

  // Query market data
  const { data: market } = useReadContract({
    address: MODERATION_CONTRACTS.Predimarket as `0x${string}`,
    abi: PREDIMARKET_ABI,
    functionName: 'getMarket',
    args: [marketId],
  });

  // Query current prices
  const { data: prices } = useReadContract({
    address: MODERATION_CONTRACTS.Predimarket as `0x${string}`,
    abi: PREDIMARKET_ABI,
    functionName: 'getMarketPrices',
    args: [marketId],
  });

  // Buy shares
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const handleVote = (outcome: boolean) => {
    setVotingFor(outcome);
    
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    
    writeContract({
      address: MODERATION_CONTRACTS.Predimarket as `0x${string}`,
      abi: PREDIMARKET_ABI,
      functionName: 'buy',
      args: [marketId, outcome, parseEther(voteAmount), 0n, BigInt(deadline)],
      value: parseEther(voteAmount),
    });
  };

  if (!report || !market || !prices) {
    return <div className="animate-pulse">Loading...</div>;
  }

  const yesPrice = Number(prices[0]) / 10000; // Convert from basis points to percentage
  const noPrice = Number(prices[1]) / 10000;
  const timeRemaining = Number(report.votingEnds) * 1000 - Date.now();
  const isActive = timeRemaining > 0 && !market.resolved;

  return (
    <div className="space-y-6">
      {/* Market Prices */}
      <div className="grid grid-cols-2 gap-4">
        <div className={`p-6 rounded-lg border-2 ${yesPrice > noPrice ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
          <div className="text-sm text-gray-600 mb-1">YES (Ban/Label)</div>
          <div className="text-3xl font-bold text-green-600">{(yesPrice * 100).toFixed(1)}%</div>
          <div className="text-sm text-gray-500 mt-2">
            {market.yesShares.toString()} shares
          </div>
        </div>

        <div className={`p-6 rounded-lg border-2 ${noPrice > yesPrice ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}>
          <div className="text-sm text-gray-600 mb-1">NO (Reject)</div>
          <div className="text-3xl font-bold text-red-600">{(noPrice * 100).toFixed(1)}%</div>
          <div className="text-sm text-gray-500 mt-2">
            {market.noShares.toString()} shares
          </div>
        </div>
      </div>

      {/* Time Remaining */}
      {isActive && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <Clock className="text-blue-500" size={20} />
            <div>
              <div className="font-semibold text-blue-900">Voting Active</div>
              <div className="text-sm text-blue-700">
                {Math.floor(timeRemaining / (1000 * 60 * 60))}h {Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))}m remaining
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Voting UI */}
      {isActive ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Vote Amount (ETH)</label>
            <input
              type="number"
              value={voteAmount}
              onChange={(e) => setVoteAmount(e.target.value)}
              step="0.001"
              min="0.001"
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => handleVote(true)}
              disabled={isPending || isConfirming}
              className="py-4 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 disabled:bg-gray-300 flex items-center justify-center gap-2"
            >
              <TrendingUp size={20} />
              Vote YES (Ban)
            </button>

            <button
              onClick={() => handleVote(false)}
              disabled={isPending || isConfirming}
              className="py-4 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 disabled:bg-gray-300 flex items-center justify-center gap-2"
            >
              <TrendingDown size={20} />
              Vote NO (Reject)
            </button>
          </div>

          {isSuccess && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <div className="text-green-900 font-semibold">Vote submitted!</div>
              <div className="text-sm text-gray-600 mt-1">
                You bought {votingFor ? 'YES' : 'NO'} shares worth {voteAmount} ETH
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
          <Clock className="mx-auto text-gray-400 mb-2" size={32} />
          <div className="font-semibold text-gray-700">Voting Closed</div>
          {market.resolved && (
            <div className="text-sm text-gray-600 mt-2">
              Result: {market.outcome ? 'YES (Ban approved)' : 'NO (Ban rejected)'}
            </div>
          )}
        </div>
      )}

      {/* Market Stats */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="font-semibold mb-3">Market Statistics</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-gray-600">Total Volume</div>
            <div className="font-semibold">{formatEther(market.totalVolume)} ETH</div>
          </div>
          <div>
            <div className="text-gray-600">Liquidity Parameter</div>
            <div className="font-semibold">{formatEther(market.liquidityParameter)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

