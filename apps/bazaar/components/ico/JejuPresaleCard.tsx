'use client'

import { useState, useEffect } from 'react'
import { formatEther, parseEther } from 'viem'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { toast } from 'sonner'
import { JEJU_TOKENOMICS, JEJU_CONTRACTS } from '@/config/jeju-tokenomics'
import { JEJU_CHAIN_ID } from '@/config/chains'

type PresalePhase = 'NOT_STARTED' | 'WHITELIST' | 'PUBLIC' | 'ENDED' | 'FAILED' | 'DISTRIBUTED'

interface PresaleStats {
  raised: bigint
  participants: number
  tokensSold: bigint
  softCap: bigint
  hardCap: bigint
  phase: PresalePhase
}

const PRESALE_ABI = [
  {
    name: 'contribute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'getPresaleStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'raised', type: 'uint256' },
      { name: 'participants', type: 'uint256' },
      { name: 'tokensSold', type: 'uint256' },
      { name: 'softCap', type: 'uint256' },
      { name: 'hardCap', type: 'uint256' },
      { name: 'phase', type: 'uint8' },
    ],
  },
  {
    name: 'currentPhase',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

const PHASES: PresalePhase[] = ['NOT_STARTED', 'WHITELIST', 'PUBLIC', 'ENDED', 'FAILED', 'DISTRIBUTED']

export function JejuPresaleCard() {
  const { isConnected, chain } = useAccount()
  const [amount, setAmount] = useState('')
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 })
  
  const isCorrectChain = chain?.id === JEJU_CHAIN_ID || chain?.id === 1337
  const presaleAddress = chain?.id === 1337 
    ? JEJU_CONTRACTS.localnet.presale 
    : JEJU_CONTRACTS.testnet.presale
  
  // Read presale stats
  const { data: statsData } = useReadContract({
    address: presaleAddress as `0x${string}`,
    abi: PRESALE_ABI,
    functionName: 'getPresaleStats',
    query: {
      enabled: presaleAddress !== '0x0000000000000000000000000000000000000000',
      refetchInterval: 10000,
    },
  })
  
  const stats: PresaleStats = statsData ? {
    raised: statsData[0],
    participants: Number(statsData[1]),
    tokensSold: statsData[2],
    softCap: statsData[3],
    hardCap: statsData[4],
    phase: PHASES[Number(statsData[5])] ?? 'NOT_STARTED',
  } : {
    raised: 0n,
    participants: 0,
    tokensSold: 0n,
    softCap: JEJU_TOKENOMICS.presale.softCap,
    hardCap: JEJU_TOKENOMICS.presale.hardCap,
    phase: 'PUBLIC', // Demo mode
  }
  
  // Contribute
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  
  useEffect(() => {
    if (isSuccess) {
      toast.success('Contribution successful', { description: 'Your tokens will be claimable at TGE' })
      setAmount('')
    }
  }, [isSuccess])
  
  // Countdown timer
  useEffect(() => {
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + 14)
    
    const timer = setInterval(() => {
      const now = new Date().getTime()
      const distance = endDate.getTime() - now
      
      if (distance < 0) {
        clearInterval(timer)
        return
      }
      
      setCountdown({
        days: Math.floor(distance / (1000 * 60 * 60 * 24)),
        hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        mins: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
        secs: Math.floor((distance % (1000 * 60)) / 1000),
      })
    }, 1000)
    
    return () => clearInterval(timer)
  }, [])
  
  const tokenPrice = JEJU_TOKENOMICS.presale.tokenPrice
  const tokensReceived = amount ? (parseEther(amount) * 10n ** 18n) / tokenPrice : 0n
  const bonus = stats.phase === 'WHITELIST' ? 10 : 
    amount && parseFloat(amount) >= 10 ? 5 : 
    amount && parseFloat(amount) >= 5 ? 3 : 
    amount && parseFloat(amount) >= 1 ? 1 : 0
  const bonusTokens = (tokensReceived * BigInt(bonus)) / 100n
  const progress = stats.hardCap > 0n ? Number((stats.raised * 100n) / stats.hardCap) : 0
  
  const handleContribute = () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }
    if (!isCorrectChain) {
      toast.error('Please switch to Jeju network')
      return
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter an amount')
      return
    }
    if (presaleAddress === '0x0000000000000000000000000000000000000000') {
      toast.info('Presale contract not deployed yet', { description: 'Coming soon on testnet' })
      return
    }
    
    writeContract({
      address: presaleAddress as `0x${string}`,
      abi: PRESALE_ABI,
      functionName: 'contribute',
      value: parseEther(amount),
    })
  }
  
  const isContributing = isPending || isConfirming
  
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          Participate in Presale
        </h2>
        <span className={`text-xs px-2 py-1 rounded-full ${
          stats.phase === 'PUBLIC' ? 'bg-bazaar-primary/20 text-bazaar-primary' :
          stats.phase === 'WHITELIST' ? 'bg-blue-500/20 text-blue-400' :
          'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
        }`}>
          {stats.phase === 'PUBLIC' ? 'Public Sale' : 
           stats.phase === 'WHITELIST' ? 'Whitelist Only' : 
           stats.phase.replace('_', ' ')}
        </span>
      </div>
      
      {/* Countdown */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {(['days', 'hours', 'mins', 'secs'] as const).map((unit) => (
          <div key={unit} className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {countdown[unit].toString().padStart(2, '0')}
            </div>
            <div className="text-xs capitalize" style={{ color: 'var(--text-tertiary)' }}>{unit}</div>
          </div>
        ))}
      </div>
      
      {/* Progress */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span style={{ color: 'var(--text-tertiary)' }}>Progress</span>
          <span style={{ color: 'var(--text-primary)' }}>{progress.toFixed(1)}%</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div 
            className="h-full rounded-full bg-bazaar-primary transition-all duration-500"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          <span>{formatEther(stats.raised)} ETH raised</span>
          <span>{formatEther(stats.hardCap)} ETH goal</span>
        </div>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {stats.participants}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Participants</div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>~$0.009</div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Price</div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>20%</div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>TGE Unlock</div>
        </div>
      </div>
      
      {/* Input */}
      <div className="space-y-4">
        <div>
          <label className="text-sm mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
            Contribution Amount (ETH)
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="input w-full pr-28"
              data-testid="presale-amount"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
              {['0.1', '1', '5'].map((val) => (
                <button 
                  key={val}
                  onClick={() => setAmount(val)}
                  className="text-xs px-2 py-1 rounded hover:bg-bazaar-primary/20 transition-colors"
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        {amount && parseFloat(amount) > 0 && (
          <div className="rounded-lg p-4 space-y-2" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-tertiary)' }}>You receive</span>
              <span style={{ color: 'var(--text-primary)' }}>
                {Number(tokensReceived / 10n ** 18n).toLocaleString()} JEJU
              </span>
            </div>
            {bonus > 0 && (
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-tertiary)' }}>Bonus ({bonus}%)</span>
                <span className="text-bazaar-primary">
                  +{Number(bonusTokens / 10n ** 18n).toLocaleString()} JEJU
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm pt-2 border-t" style={{ borderColor: 'var(--border-primary)' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Total</span>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {Number((tokensReceived + bonusTokens) / 10n ** 18n).toLocaleString()} JEJU
              </span>
            </div>
          </div>
        )}
        
        <button
          onClick={handleContribute}
          disabled={isContributing || !amount}
          className="btn-primary w-full py-4 disabled:opacity-50"
          data-testid="presale-contribute-btn"
        >
          {isContributing ? 'Contributing...' : !isConnected ? 'Connect Wallet' : 'Contribute'}
        </button>
        
        <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
          Min: {formatEther(JEJU_TOKENOMICS.presale.minContribution)} ETH · 
          Max: {formatEther(JEJU_TOKENOMICS.presale.maxContribution)} ETH
        </p>
      </div>
    </div>
  )
}
