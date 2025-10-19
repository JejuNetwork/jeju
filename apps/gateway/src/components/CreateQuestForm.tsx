/**
 * @fileoverview Create governance quest form
 * @module gateway/components/CreateQuestForm
 */

import { useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import TokenSelector from './TokenSelector';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import type { TokenOption } from './TokenSelector';

const FUTARCHY_GOVERNOR_ABI = [
  {
    type: 'function',
    name: 'createQuest',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'objectiveMetric', type: 'string' },
      { name: 'targetContract', type: 'address' },
      { name: 'changeCalldata', type: 'bytes' },
      { name: 'prizePool', type: 'uint256' },
      { name: 'prizeToken', type: 'address' }
    ],
    outputs: [{ name: 'questId', type: 'bytes32' }],
    stateMutability: 'nonpayable'
  }
] as const;

export default function CreateQuestForm() {
  const { tokens } = useProtocolTokens();
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [prizeToken, setPrizeToken] = useState<TokenOption | null>(null);
  const [prizeAmount, setPrizeAmount] = useState('');
  
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash });
  
  const tokenOptions = tokens.map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
  }));
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const governorAddress = import.meta.env.VITE_FUTARCHY_GOVERNOR_ADDRESS as `0x${string}`;
    if (!governorAddress || !prizeToken) return;
    
    // Example: Change geographic bonus
    const targetContract = import.meta.env.VITE_NODE_STAKING_MANAGER_ADDRESS as `0x${string}`;
    const changeCalldata = '0x'; // Encoded function call
    
    writeContract({
      address: governorAddress,
      abi: FUTARCHY_GOVERNOR_ABI,
      functionName: 'createQuest',
      args: [
        title,
        objective,
        targetContract,
        changeCalldata,
        parseEther(prizeAmount || '0'),
        prizeToken.address as `0x${string}`
      ]
    });
  };
  
  return (
    <div className="card">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Create Governance Quest</h2>
      
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Quest Title
          </label>
          <input
            className="input"
            type="text"
            placeholder="Increase Africa Bonus"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isPending}
          />
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Objective Metric
          </label>
          <input
            className="input"
            type="text"
            placeholder="Network geographic diversity will improve"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            disabled={isPending}
          />
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <TokenSelector
            tokens={tokenOptions}
            selectedToken={prizeToken?.symbol}
            onSelect={setPrizeToken}
            label="Prize Token (optional)"
            placeholder="Choose token for prize pool..."
            showBalances={false}
            disabled={isPending}
          />
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Prize Amount (optional)
          </label>
          <input
            className="input"
            type="number"
            placeholder="1000"
            value={prizeAmount}
            onChange={(e) => setPrizeAmount(e.target.value)}
            disabled={isPending || !prizeToken}
          />
        </div>
        
        {isSuccess && (
          <div style={{ padding: '1rem', background: '#dcfce7', borderRadius: '8px', marginBottom: '1rem' }}>
            <p style={{ color: '#16a34a', margin: 0 }}>
              Quest created! Markets will be available for 7 days.
            </p>
          </div>
        )}
        
        <button
          type="submit"
          className="button"
          style={{ width: '100%' }}
          disabled={!title || !objective || isPending}
        >
          {isPending ? 'Creating Quest...' : 'Create Quest & Spawn Markets'}
        </button>
      </form>
    </div>
  );
}

