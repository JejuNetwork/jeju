import { AuthProvider } from '@jejunetwork/auth'
import { LoginModal, useJejuAuth } from '@jejunetwork/auth/react'
import { useState } from 'react'

export function WalletButton() {
  const { authenticated, loading, walletAddress, logout } = useJejuAuth()
  const [open, setOpen] = useState(false)

  if (authenticated && walletAddress) {
    return (
      <button
        type="button"
        onClick={() => logout()}
        className="hover:shadow-glow transition-all [clip-path:polygon(8px_0,100%_0,calc(100%-8px)_100%,0_100%)] uppercase tracking-wider font-semibold"
      >
        {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={loading}
        className="hover:shadow-glow transition-all [clip-path:polygon(8px_0,100%_0,calc(100%-8px)_100%,0_100%)] uppercase tracking-wider font-semibold"
      >
        {loading ? 'Connecting...' : 'Sign In'}
      </button>
      <LoginModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onSuccess={() => setOpen(false)}
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
