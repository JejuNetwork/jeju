import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { type Address, formatUnits, parseEther } from 'viem'
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { InfoCard } from '../components/ui'
import {
  useTFMMPoolState,
  useTFMMUserBalance,
} from '../hooks/tfmm/useTFMMPools'

const TFMM_POOL_ABI = [
  {
    name: 'addLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountsIn', type: 'uint256[]' },
      { name: 'minLpOut', type: 'uint256' },
    ],
    outputs: [{ name: 'lpAmount', type: 'uint256' }],
  },
] as const

export default function LiquidityPage() {
  const [searchParams] = useSearchParams()
  const poolAddress = searchParams.get('pool') as Address | null
  const { address, isConnected } = useAccount()
  const [token0Amount, setToken0Amount] = useState('')
  const [token1Amount, setToken1Amount] = useState('')

  const { poolState, isLoading: poolLoading } = useTFMMPoolState(poolAddress)
  const { balance: userBalance } = useTFMMUserBalance(poolAddress)

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  if (isSuccess) {
    toast.success('Liquidity added successfully.')
  }

  const handleAddLiquidity = () => {
    if (!isConnected || !address) {
      toast.error('Connect your wallet first')
      return
    }

    if (!poolAddress) {
      toast.error('No pool selected')
      return
    }

    const amount0 = parseFloat(token0Amount)
    const amount1 = parseFloat(token1Amount)
    if (
      Number.isNaN(amount0) ||
      Number.isNaN(amount1) ||
      amount0 <= 0 ||
      amount1 <= 0
    ) {
      toast.error('Enter valid amounts')
      return
    }

    writeContract({
      address: poolAddress,
      abi: TFMM_POOL_ABI,
      functionName: 'addLiquidity',
      args: [[parseEther(token0Amount), parseEther(token1Amount)], 0n],
    })
  }

  const isSubmitting = isPending || isConfirming

  return (
    <div className="max-w-lg mx-auto">
      <Link
        to="/pools"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Pools
      </Link>

      <h1
        className="text-2xl sm:text-3xl font-bold mb-6"
        style={{ color: 'var(--text-primary)' }}
      >
        💧 Add Liquidity
      </h1>

      {!poolAddress && (
        <InfoCard variant="warning" className="mb-6">
          No pool selected. Go to{' '}
          <Link to="/pools" className="underline">
            Pools
          </Link>{' '}
          and select a pool to add liquidity.
        </InfoCard>
      )}

      {poolAddress && !poolState && !poolLoading && (
        <InfoCard variant="warning" className="mb-6">
          Pool contracts pending deployment. TFMM pools will be available soon.
        </InfoCard>
      )}

      <div className="card p-6">
        <div className="space-y-4">
          <div>
            <label
              htmlFor="token0-amount"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Token 1
            </label>
            <input
              id="token0-amount"
              type="number"
              value={token0Amount}
              onChange={(e) => setToken0Amount(e.target.value)}
              placeholder="0.0"
              className="input w-full"
            />
          </div>

          <div className="flex justify-center">
            <div
              className="p-2 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              +
            </div>
          </div>

          <div>
            <label
              htmlFor="token1-amount"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Token 2
            </label>
            <input
              id="token1-amount"
              type="number"
              value={token1Amount}
              onChange={(e) => setToken1Amount(e.target.value)}
              placeholder="0.0"
              className="input w-full"
            />
          </div>

          {poolState && (
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="flex justify-between text-sm mb-2">
                <span style={{ color: 'var(--text-tertiary)' }}>Fee Tier</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {Number(formatUnits(poolState.swapFee, 16)).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-tertiary)' }}>
                  Your LP Balance
                </span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {Number(formatUnits(userBalance, 18)).toFixed(4)}
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleAddLiquidity}
            disabled={
              isSubmitting ||
              !isConnected ||
              !poolAddress ||
              !token0Amount ||
              !token1Amount
            }
            className="btn-primary w-full py-3 disabled:opacity-50"
          >
            {!isConnected
              ? 'Sign In'
              : !poolAddress
                ? 'Select a Pool'
                : isSubmitting
                  ? 'Adding Liquidity...'
                  : 'Add Liquidity'}
          </button>
        </div>
      </div>
    </div>
  )
}
