import { WalletButton } from '@jejunetwork/ui'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import {
  usePaymasterDeployment,
  usePaymasterFactory,
} from '../hooks/usePaymasterFactory'
import { useProtocolTokens } from '../hooks/useProtocolTokens'
import { useTokenConfig } from '../hooks/useTokenRegistry'
import type { TokenOption } from './TokenSelector'
import TokenSelector from './TokenSelector'

export default function DeployPaymaster({
  tokenAddress: propTokenAddress,
}: {
  tokenAddress?: `0x${string}`
}) {
  const [feeMargin, setFeeMargin] = useState('100')
  const [selectedToken, setSelectedToken] = useState<TokenOption | null>(null)
  const { address: userAddress, isConnected } = useAccount()

  const { tokens } = useProtocolTokens()

  const tokenOptions = tokens.map((t) => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
  }))

  const tokenAddress =
    propTokenAddress || (selectedToken?.address as `0x${string}` | undefined)
  const { config } = useTokenConfig(tokenAddress)
  const { deployment } = usePaymasterDeployment(tokenAddress)
  const { deployPaymaster, isPending, isSuccess } = usePaymasterFactory()

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!tokenAddress || !userAddress) return

    await deployPaymaster(tokenAddress, parseInt(feeMargin, 10), userAddress)
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
        Deploy Paymaster
      </h2>

      <TokenSelector
        tokens={tokenOptions}
        selectedToken={selectedToken?.symbol}
        onSelect={setSelectedToken}
        label="Select Token"
        placeholder="Choose token for paymaster..."
        showBalances={false}
        disabled={isPending}
      />

      {selectedToken && deployment && (
        <div
          style={{
            padding: '1rem',
            background: 'var(--warning-soft)',
            borderRadius: '8px',
            marginTop: '1rem',
            border: '1px solid var(--warning)',
          }}
        >
          <p style={{ color: 'var(--warning)', margin: 0 }}>
            <strong>⚠️ Paymaster already deployed</strong> for{' '}
            {selectedToken.symbol}
          </p>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--warning)',
              marginTop: '0.5rem',
            }}
          >
            Vault: {deployment.vault.slice(0, 10)}... • Paymaster:{' '}
            {deployment.paymaster.slice(0, 10)}...
          </p>
        </div>
      )}

      {selectedToken && !deployment && !config && (
        <div
          style={{
            padding: '1rem',
            background: 'var(--info-soft)',
            borderRadius: '8px',
            marginTop: '1rem',
          }}
        >
          <p style={{ color: 'var(--info)', margin: 0 }}>
            <strong>ℹ️ Token not yet registered</strong>
          </p>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--info)',
              marginTop: '0.5rem',
            }}
          >
            You can deploy a paymaster for {selectedToken.symbol} now, or
            register it in TokenRegistry first for better protocol integration.
          </p>
        </div>
      )}

      {selectedToken && !deployment && config && (
        <form onSubmit={handleDeploy} style={{ marginTop: '1.5rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label
              htmlFor="fee-margin"
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: '600',
              }}
            >
              Fee Margin (basis points)
            </label>
            <input
              id="fee-margin"
              className="input"
              type="range"
              min="10"
              max="500"
              value={feeMargin}
              onChange={(e) => setFeeMargin(e.target.value)}
              disabled={isPending}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.875rem',
                color: 'var(--text-secondary)',
                marginTop: '0.5rem',
              }}
            >
              <span>0.1% min</span>
              <span
                style={{ fontWeight: '600', color: 'var(--accent-primary)' }}
              >
                {parseInt(feeMargin, 10) / 100}% selected
              </span>
              <span>5% max</span>
            </div>
          </div>

          <div
            style={{
              padding: '1rem',
              background: 'var(--surface-hover)',
              borderRadius: '8px',
              marginBottom: '1rem',
            }}
          >
            <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
              <strong>Deploying paymaster for {selectedToken.symbol}</strong>
            </p>
            <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
              This will deploy 3 contracts:
            </p>
            <ul
              style={{
                fontSize: '0.875rem',
                color: 'var(--text-secondary)',
                margin: '0.5rem 0',
                paddingLeft: '1.5rem',
              }}
            >
              <li>LiquidityVault (for ETH + token pools)</li>
              <li>FeeDistributor (splits fees between operator and LPs)</li>
              <li>LiquidityPaymaster (ERC-4337 gas sponsorship)</li>
            </ul>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                margin: '0.5rem 0',
              }}
            >
              Estimated cost: ~3M gas (~$0.01 on the network)
            </p>
          </div>

          {isSuccess && (
            <div
              style={{
                padding: '1rem',
                background: 'var(--success-soft)',
                borderRadius: '8px',
                marginBottom: '1rem',
              }}
            >
              <p style={{ color: 'var(--success)', margin: 0 }}>
                Paymaster deployed successfully for {selectedToken.symbol}!
              </p>
            </div>
          )}

          {isConnected ? (
            <button
              type="submit"
              className="button"
              style={{ width: '100%' }}
              disabled={isPending}
            >
              {isPending
                ? `Deploying ${selectedToken.symbol} Paymaster...`
                : `Deploy Paymaster for ${selectedToken.symbol}`}
            </button>
          ) : (
            <div
              style={{
                padding: '1rem',
                textAlign: 'center',
                background: 'var(--surface-hover)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <p
                style={{
                  color: 'var(--text-secondary)',
                  marginBottom: '0.75rem',
                  fontSize: '0.875rem',
                }}
              >
                Connect your wallet to deploy
              </p>
              <WalletButton />
            </div>
          )}
        </form>
      )}
    </div>
  )
}
