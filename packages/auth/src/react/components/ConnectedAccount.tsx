/**
 * ConnectedAccount Component
 *
 * Displays the currently connected account with logout option.
 */

import type React from 'react'
import { useState } from 'react'
import { useOAuth3 } from '../provider'

export interface ConnectedAccountProps {
  showAddress?: boolean
  showLogout?: boolean
  onLogout?: () => void
  className?: string
  style?: React.CSSProperties
}

export function ConnectedAccount({
  showAddress = true,
  showLogout = true,
  onLogout,
  className = '',
  style,
}: ConnectedAccountProps) {
  const { session, isAuthenticated, logout, smartAccountAddress } = useOAuth3()
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  if (!isAuthenticated || !session) {
    return null
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const handleLogout = async () => {
    await logout()
    onLogout?.()
    setIsDropdownOpen(false)
  }

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-block',
    ...style,
  }

  const buttonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    borderRadius: '8px',
    border: '1px solid #e0e0e0',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  }

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '8px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    minWidth: '200px',
    overflow: 'hidden',
    zIndex: 1000,
  }

  const dropdownItemStyle: React.CSSProperties = {
    padding: '12px 16px',
    cursor: 'pointer',
    fontSize: '14px',
    borderBottom: '1px solid #f0f0f0',
  }

  const statusDotStyle: React.CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#22C55E',
  }

  return (
    <div
      style={containerStyle}
      className={`oauth3-connected-account ${className}`}
    >
      <button
        type="button"
        style={buttonStyle}
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
      >
        <span style={statusDotStyle} />
        {showAddress && smartAccountAddress && (
          <span>{formatAddress(smartAccountAddress)}</span>
        )}
        <span>▼</span>
      </button>

      {isDropdownOpen && (
        <div style={dropdownStyle}>
          {smartAccountAddress && (
            <div
              style={{
                ...dropdownItemStyle,
                fontFamily: 'monospace',
                fontSize: '12px',
              }}
            >
              <div style={{ color: '#666', marginBottom: '4px' }}>
                Smart Account
              </div>
              <div>{smartAccountAddress}</div>
            </div>
          )}

          <div
            style={{
              ...dropdownItemStyle,
              fontFamily: 'monospace',
              fontSize: '12px',
            }}
          >
            <div style={{ color: '#666', marginBottom: '4px' }}>Session ID</div>
            <div>{formatAddress(session.sessionId)}</div>
          </div>

          <div
            style={{ ...dropdownItemStyle, fontSize: '12px', color: '#666' }}
          >
            Expires: {new Date(session.expiresAt).toLocaleString()}
          </div>

          {showLogout && (
            <button
              type="button"
              onClick={handleLogout}
              style={{
                ...dropdownItemStyle,
                width: '100%',
                textAlign: 'left',
                border: 'none',
                backgroundColor: 'transparent',
                color: '#DC2626',
                borderBottom: 'none',
              }}
            >
              Sign Out
            </button>
          )}
        </div>
      )}
    </div>
  )
}
