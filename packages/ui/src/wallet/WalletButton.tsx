/**
 * Decentralized Wallet Button
 *
 * A simple wallet connection button that works with wagmi's injected connector.
 * No RainbowKit, no WalletConnect, no centralized dependencies.
 *
 * For styling, this component uses inline styles by default but accepts className
 * for Tailwind or other CSS frameworks.
 */

import type React from 'react'
import { useCallback, useState } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'

export interface WalletButtonProps {
  /** Custom label for connect button */
  connectLabel?: string
  /** Show full address instead of truncated */
  showFullAddress?: boolean
  /** Additional CSS class names */
  className?: string
  /** Custom styles */
  style?: React.CSSProperties
  /** Callback when connected */
  onConnect?: (address: string) => void
  /** Callback when disconnected */
  onDisconnect?: () => void
}

export function WalletButton({
  connectLabel = 'Connect Wallet',
  showFullAddress = false,
  className = '',
  style,
  onConnect,
  onDisconnect,
}: WalletButtonProps) {
  const { address, isConnected, isConnecting } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const [showDropdown, setShowDropdown] = useState(false)

  const formatAddress = (addr: string) => {
    if (showFullAddress) return addr
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const handleConnect = useCallback(() => {
    const injectedConnector = connectors.find((c) => c.id === 'injected')
    if (injectedConnector) {
      connect(
        { connector: injectedConnector },
        {
          onSuccess: (data) => {
            if (data.accounts[0]) {
              onConnect?.(data.accounts[0])
            }
          },
        },
      )
    }
  }, [connect, connectors, onConnect])

  const handleDisconnect = useCallback(() => {
    disconnect()
    setShowDropdown(false)
    onDisconnect?.()
  }, [disconnect, onDisconnect])

  const buttonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderRadius: '8px',
    border: '1px solid #374151',
    backgroundColor: '#1f2937',
    color: '#f9fafb',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    transition: 'all 0.15s ease',
    ...style,
  }

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '8px',
    backgroundColor: '#1f2937',
    borderRadius: '8px',
    border: '1px solid #374151',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    minWidth: '200px',
    overflow: 'hidden',
    zIndex: 1000,
  }

  const dropdownItemStyle: React.CSSProperties = {
    padding: '12px 16px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#f9fafb',
    borderBottom: '1px solid #374151',
    backgroundColor: 'transparent',
    width: '100%',
    textAlign: 'left',
    border: 'none',
  }

  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={handleConnect}
        disabled={isConnecting}
        style={buttonStyle}
        className={`jeju-wallet-button ${className}`}
      >
        {isConnecting ? (
          <span style={{ opacity: 0.7 }}>Connecting...</span>
        ) : (
          <>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
              <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
            </svg>
            {connectLabel}
          </>
        )}
      </button>
    )
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        style={buttonStyle}
        className={`jeju-wallet-button ${className}`}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#22c55e',
          }}
        />
        <span style={{ fontFamily: 'monospace' }}>
          {address ? formatAddress(address) : 'Connected'}
        </span>
        <span style={{ fontSize: '10px', opacity: 0.7 }}>▼</span>
      </button>

      {showDropdown && (
        <div style={dropdownStyle}>
          {address && (
            <div
              style={{
                ...dropdownItemStyle,
                fontFamily: 'monospace',
                fontSize: '12px',
              }}
            >
              <div style={{ color: '#9ca3af', marginBottom: '4px' }}>
                Address
              </div>
              <div style={{ wordBreak: 'break-all' }}>{address}</div>
            </div>
          )}
          <button
            type="button"
            onClick={handleDisconnect}
            style={{
              ...dropdownItemStyle,
              color: '#ef4444',
              borderBottom: 'none',
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Hook for wallet connection without UI
 */
export function useWallet() {
  const { address, isConnected, isConnecting } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()

  const connectWallet = useCallback(() => {
    const injectedConnector = connectors.find((c) => c.id === 'injected')
    if (injectedConnector) {
      connect({ connector: injectedConnector })
    }
  }, [connect, connectors])

  return {
    address,
    isConnected,
    isConnecting,
    connect: connectWallet,
    disconnect,
  }
}
