import { useMemo, useState } from 'react'
import { type Address, formatEther, type Hash, parseEther } from 'viem'
import {
  useAccount,
  useBalance,
  useChainId,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { useOIFConfig } from '@/hooks/useOIF'

const CHAINS = [
  { id: 1, name: 'Ethereum', color: 'var(--chain-ethereum)' },
  { id: 42161, name: 'Arbitrum', color: 'var(--chain-arbitrum)' },
  { id: 10, name: 'Optimism', color: 'var(--chain-optimism)' },
  { id: 420691, name: 'Network', color: 'var(--chain-jeju)' },
  { id: 11155111, name: 'Sepolia', color: 'var(--accent-primary)' },
]

const TOKENS = {
  ETH: {
    symbol: 'ETH',
    address: '0x0000000000000000000000000000000000000000' as Address,
    decimals: 18,
  },
}

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
] as const

export function CrossChainIntent() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const config = useOIFConfig()

  const [amount, setAmount] = useState('')
  const [destChain, setDestChain] = useState(
    CHAINS[0].id === chainId ? CHAINS[1].id : CHAINS[0].id,
  )
  const [maxFee, setMaxFee] = useState('0.005')
  const [intentId, setIntentId] = useState<Hash | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [status, setStatus] = useState<string>('idle')

  const inputSettlerAddress = config.inputSettlers[chainId] as
    | Address
    | undefined
  const { writeContractAsync, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: intentId ?? undefined,
  })

  const { data: balance } = useBalance({ address })

  const sourceChain = useMemo(
    () => CHAINS.find((c) => c.id === chainId),
    [chainId],
  )
  const destChainInfo = useMemo(
    () => CHAINS.find((c) => c.id === destChain),
    [destChain],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address || !amount || !inputSettlerAddress) return

    setError(null)
    setStatus('pending')

    const amountWei = parseEther(amount)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const nonce = BigInt(Date.now())

    const order = {
      sourceChainId: BigInt(chainId),
      targetChainId: BigInt(destChain),
      sourceToken: TOKENS.ETH.address,
      targetToken: TOKENS.ETH.address,
      sourceAmount: amountWei,
      targetAddress: address,
      deadline,
      data: '0x' as `0x${string}`,
      resolver: '0x0000000000000000000000000000000000000000' as Address,
      resolverFee: 0n,
      refundAddress: address,
      nonce,
    }

    try {
      const hash = await writeContractAsync({
        address: inputSettlerAddress,
        abi: INPUT_SETTLER_ABI,
        functionName: 'createIntent',
        args: [order],
        value: amountWei,
      })
      setIntentId(hash)
      setStatus('confirming')
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Transaction failed'))
      setStatus('error')
    }
  }

  if (!isConnected) {
    return (
      <div
        style={{
          background:
            'linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--surface) 100%)',
          borderRadius: '16px',
          padding: '32px',
          textAlign: 'center',
        }}
      >
        <p style={{ color: 'var(--text-muted)' }}>
          Connect your wallet to create cross-chain intents
        </p>
      </div>
    )
  }

  return (
    <div
      style={{
        background:
          'linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--surface) 100%)',
        borderRadius: '16px',
        border: '1px solid var(--accent-tertiary-soft)',
        padding: '24px',
      }}
    >
      <h3
        style={{
          fontSize: '18px',
          fontWeight: 600,
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span
          style={{
            width: '32px',
            height: '32px',
            background:
              'linear-gradient(135deg, var(--chain-jeju), var(--accent-primary))',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ⚡
        </span>
        Cross-Chain Intent
      </h3>

      <form onSubmit={handleSubmit}>
        {/* From Chain */}
        <div style={{ marginBottom: '16px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '8px',
            }}
          >
            From
          </label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              background: 'var(--surface)',
              borderRadius: '10px',
              border: '1px solid var(--accent-tertiary-soft)',
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                background: sourceChain?.color || '#888',
              }}
            />
            <span style={{ flex: 1 }}>{sourceChain?.name || 'Unknown'}</span>
            <div style={{ textAlign: 'right' }}>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontSize: '20px',
                  fontFamily: 'JetBrains Mono, monospace',
                  textAlign: 'right',
                  width: '120px',
                  outline: 'none',
                }}
              />
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Balance:{' '}
                {balance ? formatEther(balance.value).slice(0, 8) : '0'} ETH
              </div>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div
          style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              background: 'var(--surface)',
              border: '1px solid var(--accent-tertiary-soft)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
            }}
          >
            ↓
          </div>
        </div>

        {/* To Chain */}
        <div style={{ marginBottom: '16px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '8px',
            }}
          >
            To
          </label>
          <select
            value={destChain}
            onChange={(e) => setDestChain(Number(e.target.value))}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'var(--surface)',
              border: '1px solid var(--accent-tertiary-soft)',
              borderRadius: '10px',
              color: 'var(--text-primary)',
              fontSize: '14px',
            }}
          >
            {CHAINS.filter((c) => c.id !== chainId).map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </div>

        {/* Fee */}
        <div style={{ marginBottom: '20px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '8px',
            }}
          >
            Max Solver Fee
          </label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              background: 'var(--surface)',
              borderRadius: '10px',
              border: '1px solid var(--accent-tertiary-soft)',
            }}
          >
            <input
              type="text"
              value={maxFee}
              onChange={(e) => setMaxFee(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: '16px',
                fontFamily: 'JetBrains Mono, monospace',
                width: '100%',
                outline: 'none',
              }}
            />
            <span style={{ color: 'var(--text-muted)' }}>ETH</span>
          </div>
        </div>

        {/* Quote Preview */}
        {amount && parseFloat(amount) > 0 && (
          <div
            style={{
              padding: '16px',
              background: 'var(--accent-tertiary-soft)',
              borderRadius: '10px',
              marginBottom: '20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '8px',
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                You receive
              </span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                ~{(parseFloat(amount) * 0.995).toFixed(6)} ETH
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '8px',
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                Solver fee
              </span>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  color: 'var(--warning-bright)',
                }}
              >
                ~0.5%
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                Est. time
              </span>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  color: 'var(--chain-jeju)',
                }}
              >
                ~30s
              </span>
            </div>
          </div>
        )}

        {/* Status */}
        {intentId && (
          <div
            style={{
              padding: '12px 16px',
              background: isSuccess
                ? 'var(--success-soft)'
                : 'var(--accent-tertiary-soft)',
              borderRadius: '10px',
              marginBottom: '16px',
              fontSize: '13px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '4px',
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>Intent ID</span>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '11px',
                }}
              >
                {intentId.slice(0, 10)}...{intentId.slice(-8)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Status</span>
              <span
                style={{
                  fontWeight: 600,
                  color: isSuccess
                    ? 'var(--success-bright)'
                    : isConfirming
                      ? 'var(--warning-bright)'
                      : 'var(--chain-jeju)',
                }}
              >
                {isSuccess
                  ? 'CONFIRMED'
                  : isConfirming
                    ? 'CONFIRMING'
                    : status.toUpperCase()}
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '12px 16px',
              background: 'var(--error-soft)',
              border: '1px solid var(--error)',
              borderRadius: '10px',
              marginBottom: '16px',
              fontSize: '13px',
              color: 'var(--error-bright)',
            }}
          >
            {error.message}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={
            isPending ||
            isConfirming ||
            !amount ||
            parseFloat(amount) <= 0 ||
            !inputSettlerAddress
          }
          style={{
            width: '100%',
            padding: '16px',
            background:
              isPending || isConfirming
                ? 'var(--accent-tertiary-soft)'
                : 'linear-gradient(135deg, var(--chain-jeju), var(--accent-primary))',
            border: 'none',
            borderRadius: '12px',
            color: 'var(--text-inverse)',
            fontSize: '16px',
            fontWeight: 600,
            cursor: isPending || isConfirming ? 'not-allowed' : 'pointer',
            opacity: !amount || parseFloat(amount) <= 0 ? 0.5 : 1,
          }}
        >
          {isPending
            ? 'Confirm in Wallet...'
            : isConfirming
              ? 'Creating Intent...'
              : isSuccess
                ? 'Intent Created!'
                : `Bridge to ${destChainInfo?.name || 'Chain'}`}
        </button>
      </form>
    </div>
  )
}

export default CrossChainIntent
