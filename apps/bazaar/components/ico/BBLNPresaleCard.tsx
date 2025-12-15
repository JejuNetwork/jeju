'use client'

import { useState, useEffect } from 'react'
import { formatEther, parseEther } from 'viem'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { toast } from 'sonner'

// Phase enum from canonical Presale.sol
type PresalePhase = 'NOT_STARTED' | 'WHITELIST' | 'PUBLIC' | 'ENDED' | 'CLEARING' | 'DISTRIBUTION' | 'FAILED'

interface PresaleStats {
  raised: bigint
  participants: number
  tokensSold: bigint
  softCap: bigint
  hardCap: bigint
  currentPrice: bigint
  phase: PresalePhase
}

interface ContributionInfo {
  ethAmount: bigint
  tokenAllocation: bigint
  bonusTokens: bigint
  claimedTokens: bigint
  claimable: bigint
  refundAmount: bigint
  claimed: boolean
  refunded: boolean
}

// Canonical Presale ABI from @jeju/contracts
const BBLN_PRESALE_ABI = [
  {
    name: 'contributeWithMaxPrice',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'maxPrice', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'contribute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claimRefund',
    type: 'function',
    stateMutability: 'nonpayable',
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
      { name: 'price', type: 'uint256' },
      { name: 'phase', type: 'uint8' },
    ],
  },
  {
    name: 'getContribution',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'ethAmount', type: 'uint256' },
      { name: 'tokenAllocation', type: 'uint256' },
      { name: 'bonusTokens', type: 'uint256' },
      { name: 'claimedTokens', type: 'uint256' },
      { name: 'claimable', type: 'uint256' },
      { name: 'refundAmount', type: 'uint256' },
      { name: 'claimed', type: 'bool' },
      { name: 'refunded', type: 'bool' },
    ],
  },
  {
    name: 'getCurrentPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'previewAllocation',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'ethAmount', type: 'uint256' },
      { name: 'isWhitelist', type: 'bool' },
      { name: 'isHolder', type: 'bool' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'currentPhase',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

const PHASES: PresalePhase[] = ['NOT_STARTED', 'WHITELIST', 'PUBLIC', 'ENDED', 'CLEARING', 'DISTRIBUTION', 'FAILED']

// BBLN Tokenomics (from packages/token/src/config/tokenomics.ts)
const BBLN_TOKENOMICS = {
  name: 'Babylon',
  symbol: 'BBLN',
  totalSupply: 1_000_000_000n,
  publicSaleTokens: 100_000_000n, // 10% of total
  elizaBonusMultiplier: 150, // 1.5x
}

// Contract addresses - to be updated after deployment
const BBLN_CONTRACTS = {
  sepolia: {
    token: '0x0000000000000000000000000000000000000000',
    presale: '0x0000000000000000000000000000000000000000',
  },
  mainnet: {
    token: '0x0000000000000000000000000000000000000000',
    presale: '0x0000000000000000000000000000000000000000',
  },
}

export function BBLNPresaleCard() {
  const { address, isConnected, chain } = useAccount()
  const [amount, setAmount] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 })
  
  const isMainnet = chain?.id === 1
  const presaleAddress = isMainnet 
    ? BBLN_CONTRACTS.mainnet.presale 
    : BBLN_CONTRACTS.sepolia.presale
  
  const isDeployed = presaleAddress !== '0x0000000000000000000000000000000000000000'
  
  // Read presale stats
  const { data: statsData } = useReadContract({
    address: presaleAddress as `0x${string}`,
    abi: BBLN_PRESALE_ABI,
    functionName: 'getPresaleStats',
    query: {
      enabled: isDeployed,
      refetchInterval: 10000,
    },
  })
  
  const stats: PresaleStats = statsData ? {
    raised: statsData[0],
    participants: Number(statsData[1]),
    tokensSold: statsData[2],
    softCap: statsData[3],
    hardCap: statsData[4],
    currentPrice: statsData[5],
    phase: PHASES[Number(statsData[6])] ?? 'NOT_STARTED',
  } : {
    raised: 0n,
    participants: 0,
    tokensSold: 0n,
    softCap: 0n,
    hardCap: 0n,
    currentPrice: 0n,
    phase: 'NOT_STARTED',
  }
  
  // Read user's contribution
  const { data: contributionData } = useReadContract({
    address: presaleAddress as `0x${string}`,
    abi: BBLN_PRESALE_ABI,
    functionName: 'getContribution',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    query: {
      enabled: isDeployed && !!address,
      refetchInterval: 10000,
    },
  })
  
  const userContribution: ContributionInfo | null = contributionData ? {
    ethAmount: contributionData[0],
    tokenAllocation: contributionData[1],
    bonusTokens: contributionData[2],
    claimedTokens: contributionData[3],
    claimable: contributionData[4],
    refundAmount: contributionData[5],
    claimed: contributionData[6],
    refunded: contributionData[7],
  } : null
  
  // Preview allocation
  const { data: previewData } = useReadContract({
    address: presaleAddress as `0x${string}`,
    abi: BBLN_PRESALE_ABI,
    functionName: 'previewAllocation',
    args: [amount ? parseEther(amount) : 0n, false, false], // [ethAmount, isWhitelist, isHolder]
    query: {
      enabled: isDeployed && !!amount && parseFloat(amount) > 0,
    },
  })
  
  // Bid
  const { writeContract: writeBid, data: bidHash, isPending: isBidding } = useWriteContract()
  const { isLoading: isConfirmingBid, isSuccess: bidSuccess } = useWaitForTransactionReceipt({ hash: bidHash })
  
  // Claim
  const { writeContract: writeClaim, data: claimHash, isPending: isClaiming } = useWriteContract()
  const { isLoading: isConfirmingClaim, isSuccess: claimSuccess } = useWaitForTransactionReceipt({ hash: claimHash })
  
  useEffect(() => {
    if (bidSuccess) {
      toast.success('Bid placed successfully', { description: 'Your bid has been recorded' })
      setAmount('')
      setMaxPrice('')
    }
  }, [bidSuccess])
  
  useEffect(() => {
    if (claimSuccess) {
      toast.success('Claim successful', { description: 'BBLN tokens have been sent to your wallet' })
    }
  }, [claimSuccess])
  
  // Read presale config for timeline
  const { data: configData } = useReadContract({
    address: presaleAddress as `0x${string}`,
    abi: [{
      name: 'config',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [
        { name: 'mode', type: 'uint8' },
        { name: 'totalTokens', type: 'uint256' },
        { name: 'softCap', type: 'uint256' },
        { name: 'hardCap', type: 'uint256' },
        { name: 'minContribution', type: 'uint256' },
        { name: 'maxContribution', type: 'uint256' },
        { name: 'tokenPrice', type: 'uint256' },
        { name: 'startPrice', type: 'uint256' },
        { name: 'reservePrice', type: 'uint256' },
        { name: 'priceDecayPerBlock', type: 'uint256' },
        { name: 'whitelistStart', type: 'uint256' },
        { name: 'publicStart', type: 'uint256' },
        { name: 'presaleEnd', type: 'uint256' },
        { name: 'tgeTimestamp', type: 'uint256' },
      ],
    }] as const,
    functionName: 'config',
    query: {
      enabled: isDeployed,
    },
  })

  const presaleEnd = configData ? Number(configData[12]) * 1000 : 0

  // Countdown timer - uses contract data
  useEffect(() => {
    if (!presaleEnd) {
      setCountdown({ days: 0, hours: 0, mins: 0, secs: 0 })
      return
    }

    const timer = setInterval(() => {
      const now = Date.now()
      const diff = Math.max(0, presaleEnd - now)
      
      setCountdown({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        mins: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        secs: Math.floor((diff % (1000 * 60)) / 1000),
      })
    }, 1000)
    
    return () => clearInterval(timer)
  }, [presaleEnd])
  
  const handleBid = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount')
      return
    }
    
    // Use contributeWithMaxPrice if max price specified, otherwise contribute
    if (maxPrice && parseFloat(maxPrice) > 0) {
      writeBid({
        address: presaleAddress as `0x${string}`,
        abi: BBLN_PRESALE_ABI,
        functionName: 'contributeWithMaxPrice',
        args: [parseEther(maxPrice)],
        value: parseEther(amount),
      })
    } else {
      writeBid({
        address: presaleAddress as `0x${string}`,
        abi: BBLN_PRESALE_ABI,
        functionName: 'contribute',
        value: parseEther(amount),
      })
    }
  }
  
  const handleClaim = () => {
    writeClaim({
      address: presaleAddress as `0x${string}`,
      abi: BBLN_PRESALE_ABI,
      functionName: 'claim',
    })
  }
  
  const progressPercent = stats.hardCap > 0n
    ? Number((stats.raised * 100n) / stats.hardCap)
    : 0
  
  const formatPrice = (wei: bigint) => {
    return `${formatEther(wei)} ETH`
  }
  
  const formatTokens = (wei: bigint) => {
    const tokens = Number(wei) / 1e18
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(2)}K`
    return tokens.toFixed(2)
  }
  
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/20 via-black to-orange-950/20 p-6 shadow-xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-2xl font-bold text-white">
            B
          </div>
          <div>
            <h2 className="text-xl font-bold text-amber-100">Babylon Token Sale</h2>
            <p className="text-sm text-amber-300/70">CCA Auction • 100M BBLN</p>
          </div>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-medium ${
          stats.phase === 'PUBLIC' ? 'bg-green-500/20 text-green-400' :
          stats.phase === 'WHITELIST' ? 'bg-amber-500/20 text-amber-400' :
          stats.phase === 'CLEARING' ? 'bg-blue-500/20 text-blue-400' :
          stats.phase === 'DISTRIBUTION' ? 'bg-green-500/20 text-green-400' :
          'bg-gray-500/20 text-gray-400'
        }`}>
          {stats.phase === 'PUBLIC' ? 'Public Auction' : 
           stats.phase === 'WHITELIST' ? 'Early Bird' : 
           stats.phase.replace('_', ' ')}
        </div>
      </div>
      
      {/* Countdown */}
      <div className="mb-6 grid grid-cols-4 gap-2 text-center">
        {[
          { label: 'Days', value: countdown.days },
          { label: 'Hours', value: countdown.hours },
          { label: 'Mins', value: countdown.mins },
          { label: 'Secs', value: countdown.secs },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-amber-950/30 p-3">
            <div className="text-2xl font-bold text-amber-100">{value}</div>
            <div className="text-xs text-amber-300/50">{label}</div>
          </div>
        ))}
      </div>
      
      {/* Current Price */}
      <div className="mb-6 rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/10 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-amber-300/70">Current Price</span>
          <span className="text-lg font-bold text-amber-100">{formatPrice(stats.currentPrice)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-amber-300/50">
          <span>Price decreases over time</span>
          <span>~${(Number(formatEther(stats.currentPrice)) * 3000).toFixed(2)} per BBLN</span>
        </div>
      </div>
      
      {/* Stats */}
      <div className="mb-6 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-amber-300/70">Total Raised</span>
          <span className="font-medium text-amber-100">{formatEther(stats.raised)} ETH</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-amber-300/70">Participants</span>
          <span className="font-medium text-amber-100">{stats.participants.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-amber-300/70">Tokens Sold</span>
          <span className="font-medium text-amber-100">{formatTokens(stats.tokensSold)} BBLN</span>
        </div>
        
        {/* Progress bar */}
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-amber-300/50">Allocation Progress</span>
            <span className="text-amber-300/50">{progressPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-amber-950/50">
            <div 
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
              style={{ width: `${Math.min(progressPercent, 100)}%` }}
            />
          </div>
        </div>
      </div>
      
      {/* User's Contribution */}
      {userContribution && userContribution.ethAmount > 0n && (
        <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-950/20 p-4">
          <h3 className="mb-3 text-sm font-medium text-amber-300">Your Contribution</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-amber-300/70">Committed</span>
              <span className="text-amber-100">{formatEther(userContribution.ethAmount)} ETH</span>
            </div>
            {userContribution.tokenAllocation > 0n && (
              <div className="flex justify-between">
                <span className="text-amber-300/70">Allocation</span>
                <span className="text-amber-100">{formatTokens(userContribution.tokenAllocation)} BBLN</span>
              </div>
            )}
            {userContribution.bonusTokens > 0n && (
              <div className="flex justify-between">
                <span className="text-amber-300/70">Bonus</span>
                <span className="text-green-400">+{formatTokens(userContribution.bonusTokens)} BBLN</span>
              </div>
            )}
            {userContribution.claimable > 0n && (
              <div className="flex justify-between">
                <span className="text-amber-300/70">Claimable</span>
                <span className="text-amber-100">{formatTokens(userContribution.claimable)} BBLN</span>
              </div>
            )}
          </div>
          
          {/* Claim button */}
          {stats.phase === 'DISTRIBUTION' && !userContribution.claimed && userContribution.claimable > 0n && (
            <button
              onClick={handleClaim}
              disabled={isClaiming || isConfirmingClaim}
              className="mt-4 w-full rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 py-2 font-medium text-white hover:from-amber-600 hover:to-orange-600 disabled:opacity-50"
            >
              {isClaiming || isConfirmingClaim ? 'Claiming...' : 'Claim BBLN'}
            </button>
          )}
        </div>
      )}
      
      {/* Bid Form */}
      {(stats.phase === 'WHITELIST' || stats.phase === 'PUBLIC') && (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-amber-300/70">Bid Amount (ETH)</label>
            <input
              type="number"
              step="0.01"
              min="0.1"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-amber-100 placeholder:text-amber-300/30 focus:border-amber-500 focus:outline-none"
            />
          </div>
          
          <div>
            <label className="mb-2 block text-sm text-amber-300/70">
              Max Price (optional, leave empty to accept any price)
            </label>
            <input
              type="number"
              step="0.0001"
              placeholder="0.0"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-full rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-amber-100 placeholder:text-amber-300/30 focus:border-amber-500 focus:outline-none"
            />
          </div>
          
          {/* Preview */}
          {previewData && previewData > 0n && (
            <div className="rounded-lg bg-amber-500/10 p-3 text-sm">
              <span className="text-amber-300/70">Estimated allocation: </span>
              <span className="font-medium text-amber-100">{formatTokens(previewData)} BBLN</span>
            </div>
          )}
          
          {!isConnected ? (
            <div className="rounded-lg bg-amber-950/30 p-4 text-center text-sm text-amber-300/70">
              Connect wallet to participate
            </div>
          ) : !isDeployed ? (
            <div className="rounded-lg bg-amber-950/30 p-4 text-center text-sm text-amber-300/70">
              Sale not yet deployed - coming soon
            </div>
          ) : (
            <button
              onClick={handleBid}
              disabled={isBidding || isConfirmingBid || !amount}
              className="w-full rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 py-3 font-bold text-white hover:from-amber-600 hover:to-orange-600 disabled:opacity-50"
            >
              {isBidding || isConfirmingBid ? 'Processing...' : 'Place Bid'}
            </button>
          )}
        </div>
      )}
      
      {/* Info */}
      <div className="mt-6 rounded-lg bg-amber-950/20 p-4 text-xs text-amber-300/50">
        <p className="font-medium text-amber-300/70">About CCA Auction</p>
        <p className="mt-1">
          Continuous Clearing Auction - price starts high and decreases over time. 
          All successful bidders pay the same final clearing price. 
          ELIZA OS holders get 1.5x allocation bonus.
        </p>
      </div>
    </div>
  )
}
