import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Wallet, type LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'

const WalletIcon = Wallet as ComponentType<LucideProps>

interface ConnectPromptProps {
  message?: string
  action?: string
}

/**
 * A compact prompt shown when a user needs to connect their wallet to perform an action.
 * Used inline within components instead of blocking entire pages.
 */
export function ConnectPrompt({
  message = 'Connect your wallet to continue',
  action,
}: ConnectPromptProps) {
  return (
    <div
      style={{
        padding: '1.5rem',
        background: 'var(--surface-hover)',
        borderRadius: 'var(--radius-lg)',
        textAlign: 'center',
        border: '1px dashed var(--border)',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          margin: '0 auto 1rem',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--gradient-brand)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <WalletIcon size={24} color="white" />
      </div>
      <p
        style={{
          color: 'var(--text-secondary)',
          marginBottom: '0.5rem',
          fontSize: '0.9375rem',
        }}
      >
        {message}
      </p>
      {action && (
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: '0.8125rem',
            marginBottom: '1rem',
          }}
        >
          {action}
        </p>
      )}
      <ConnectButton />
    </div>
  )
}

/**
 * A smaller inline connect button for use in forms or action areas.
 */
export function ConnectButtonInline({ label = 'Connect Wallet' }: { label?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <ConnectButton.Custom>
        {({ openConnectModal }) => (
          <button
            type="button"
            className="button"
            onClick={openConnectModal}
            style={{ gap: '0.5rem' }}
          >
            <WalletIcon size={16} />
            {label}
          </button>
        )}
      </ConnectButton.Custom>
    </div>
  )
}
