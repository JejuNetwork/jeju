import { AuthProvider } from '@jejunetwork/auth'
import { LoginModal, useJejuAuth } from '@jejunetwork/auth/react'
import { useState } from 'react'

interface AuthButtonProps {
  onAuthSuccess?: () => void
  className?: string
  variant?: 'default' | 'compact' | 'icon'
}

export function AuthButton({
  onAuthSuccess,
  className = '',
  variant = 'default',
}: AuthButtonProps) {
  const { authenticated, loading, walletAddress, logout } = useJejuAuth()
  const [showModal, setShowModal] = useState(false)

  if (authenticated && walletAddress) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-primary">
          {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
        </span>
        <button
          type="button"
          onClick={() => logout()}
          className="btn-secondary"
        >
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        disabled={loading}
        className={`btn-primary ${className}`}
      >
        {variant === 'icon' ? '🔐' : loading ? 'Connecting...' : 'Sign In'}
      </button>

      <LoginModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={() => {
          setShowModal(false)
          onAuthSuccess?.()
        }}
        title="Sign In"
        subtitle="Use wallet or passkey"
        providers={[
          AuthProvider.WALLET,
          AuthProvider.PASSKEY,
          AuthProvider.FARCASTER,
          AuthProvider.GOOGLE,
          AuthProvider.GITHUB,
          AuthProvider.TWITTER,
          AuthProvider.DISCORD,
        ]}
        showEmailPhone={false}
      />
    </>
  )
}

export default AuthButton
