/**
 * AuthHeaderButton - Compact Auth Button for Headers
 *
 * A compact version of JejuAuthButton designed for use in navigation headers.
 * Shows a small connect button or the connected address with a dropdown.
 */

import { useJejuAuth } from '@jejunetwork/auth/react'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'

export interface AuthHeaderButtonProps {
  /** Custom label for the connect button */
  connectLabel?: string
  /** Show full address when connected */
  showFullAddress?: boolean
  /** Callback when authentication succeeds */
  onSuccess?: () => void
  /** Callback when user disconnects */
  onDisconnect?: () => void
  /** Additional CSS class names */
  className?: string
  /** Custom styles */
  style?: React.CSSProperties
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function AuthHeaderButton({
  connectLabel = 'Connect',
  showFullAddress = false,
  onSuccess,
  onDisconnect,
  className = '',
  style,
}: AuthHeaderButtonProps) {
  const { authenticated, loading, walletAddress, loginWithWallet, logout } =
    useJejuAuth()

  const [showDropdown, setShowDropdown] = useState(false)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowDropdown(false)
    if (showDropdown) {
      document.addEventListener('click', handleClickOutside)
    }
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showDropdown])

  const handleConnect = useCallback(async () => {
    await loginWithWallet()
    onSuccess?.()
  }, [loginWithWallet, onSuccess])

  const handleDisconnect = useCallback(async () => {
    await logout()
    setShowDropdown(false)
    onDisconnect?.()
  }, [logout, onDisconnect])

  // Connected state
  if (authenticated && walletAddress) {
    const displayAddress = showFullAddress
      ? walletAddress
      : truncateAddress(walletAddress)

    return (
      <div className="relative" style={style}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setShowDropdown(!showDropdown)
          }}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all ${className}`}
          style={{
            backgroundColor: 'var(--bg-tertiary, #374151)',
            color: 'var(--text-primary, #f9fafb)',
          }}
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: '#22c55e' }}
            aria-hidden="true"
          />
          <span className="text-sm font-mono">{displayAddress}</span>
        </button>

        {showDropdown && (
          <div className="absolute right-0 top-full mt-2 opacity-100 visible transition-all">
            <button
              type="button"
              onClick={handleDisconnect}
              className="px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap"
              style={{
                backgroundColor: 'var(--surface, #1f2937)',
                color: 'var(--color-error, #ef4444)',
                border: '1px solid var(--border, #374151)',
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    )
  }

  // Disconnected state
  return (
    <button
      type="button"
      onClick={handleConnect}
      disabled={loading}
      className={`px-4 py-2 rounded-xl font-medium text-sm transition-all ${className}`}
      style={{
        backgroundColor: 'var(--color-primary, #4F46E5)',
        color: 'white',
        opacity: loading ? 0.7 : 1,
        cursor: loading ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {loading ? 'Connecting...' : connectLabel}
    </button>
  )
}
