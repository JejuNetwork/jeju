/**
 * TrustCenterWidget
 *
 * React component for visualizing TEE verification status.
 * Shows attestation status, provider details, and audit trail.
 */

import { type FC, useCallback, useEffect, useState } from 'react'

// ============================================================================
// Types
// ============================================================================

export type AttestationStatus = 'valid' | 'expired' | 'unverified' | 'pending'

export type TEEPlatform =
  | 'intel_tdx'
  | 'intel_sgx'
  | 'amd_sev_snp'
  | 'phala'
  | 'aws_nitro'
  | 'gcp_confidential'
  | 'unknown'

export interface ProviderInfo {
  name: string
  address: string
  endpoint: string
  teePlatform: TEEPlatform
  mrEnclave: string
  mrSigner: string
}

export interface AttestationRecord {
  id: string
  timestamp: number
  status: AttestationStatus
  mrEnclave: string
  verifier?: string
}

export interface TrustCenterProps {
  /** Provider information */
  provider: ProviderInfo
  /** Current attestation status */
  status: AttestationStatus
  /** When attestation expires (unix timestamp) */
  expiresAt?: number
  /** Recent attestation history */
  attestationHistory?: AttestationRecord[]
  /** Whether to show expanded view by default */
  defaultExpanded?: boolean
  /** Custom class name */
  className?: string
  /** Callback when user requests attestation refresh */
  onRefreshAttestation?: () => Promise<void>
  /** Callback when user clicks verify */
  onVerify?: () => Promise<void>
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}

function formatTimeRemaining(expiresAt: number): string {
  const now = Date.now()
  const remaining = expiresAt - now

  if (remaining <= 0) {
    return 'Expired'
  }

  const hours = Math.floor(remaining / (1000 * 60 * 60))
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }

  return `${hours}h ${minutes}m`
}

function truncateHash(hash: string, length: number = 8): string {
  if (hash.length <= length * 2 + 3) {
    return hash
  }
  return `${hash.slice(0, length + 2)}...${hash.slice(-length)}`
}

function getPlatformDisplayName(platform: TEEPlatform): string {
  const names: Record<TEEPlatform, string> = {
    intel_tdx: 'Intel TDX',
    intel_sgx: 'Intel SGX',
    amd_sev_snp: 'AMD SEV-SNP',
    phala: 'Phala Network',
    aws_nitro: 'AWS Nitro',
    gcp_confidential: 'GCP Confidential',
    unknown: 'Unknown',
  }
  return names[platform]
}

// ============================================================================
// Sub-Components
// ============================================================================

interface StatusBadgeProps {
  status: AttestationStatus
  size?: 'sm' | 'md' | 'lg'
}

const StatusBadge: FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5',
  }

  const statusStyles: Record<
    AttestationStatus,
    { bg: string; text: string; icon: string }
  > = {
    valid: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-700 dark:text-green-300',
      icon: '✓',
    },
    expired: {
      bg: 'bg-red-100 dark:bg-red-900/30',
      text: 'text-red-700 dark:text-red-300',
      icon: '✗',
    },
    unverified: {
      bg: 'bg-yellow-100 dark:bg-yellow-900/30',
      text: 'text-yellow-700 dark:text-yellow-300',
      icon: '?',
    },
    pending: {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      text: 'text-blue-700 dark:text-blue-300',
      icon: '⏳',
    },
  }

  const style = statusStyles[status]

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${style.bg} ${style.text} ${sizeClasses[size]}`}
    >
      <span>{style.icon}</span>
      <span className="capitalize">{status}</span>
    </span>
  )
}

interface InfoRowProps {
  label: string
  value: string
  copyable?: boolean
}

const InfoRow: FC<InfoRowProps> = ({ label, value, copyable = false }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [value])

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
          {value}
        </span>
        {copyable && (
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title="Copy to clipboard"
          >
            {copied ? '✓' : '📋'}
          </button>
        )}
      </div>
    </div>
  )
}

interface TooltipProps {
  children: React.ReactNode
  content: string
}

const Tooltip: FC<TooltipProps> = ({ children, content }) => {
  const [show, setShow] = useState(false)

  return (
    <div className="relative inline-block">
      <span
        role="button"
        tabIndex={0}
        aria-expanded={show}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setShow((v) => !v)
          } else if (e.key === 'Escape') {
            setShow(false)
          }
        }}
      >
        {children}
      </span>
      {show && (
        <div className="absolute z-50 px-3 py-2 text-sm text-white bg-gray-900 rounded-lg shadow-lg -top-2 left-full ml-2 w-64">
          {content}
          <div className="absolute top-3 -left-1 w-2 h-2 bg-gray-900 rotate-45" />
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export const TrustCenterWidget: FC<TrustCenterProps> = ({
  provider,
  status,
  expiresAt,
  attestationHistory = [],
  defaultExpanded = false,
  className = '',
  onRefreshAttestation,
  onVerify,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [showHistory, setShowHistory] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState<string>('')

  // Update time remaining
  useEffect(() => {
    if (!expiresAt) return

    const update = () => {
      setTimeRemaining(formatTimeRemaining(expiresAt))
    }

    update()
    const interval = setInterval(update, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [expiresAt])

  const handleRefresh = async () => {
    if (!onRefreshAttestation) return

    setRefreshing(true)
    try {
      await onRefreshAttestation()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div
      className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm ${className}`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
      >
        <div className="flex items-center gap-3">
          {/* TEE Badge */}
          <div
            className={`flex items-center justify-center w-10 h-10 rounded-full ${
              status === 'valid'
                ? 'bg-green-100 dark:bg-green-900/30'
                : status === 'expired'
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-gray-100 dark:bg-gray-700'
            }`}
          >
            <span className="text-xl">
              {status === 'valid' ? '🔒' : status === 'expired' ? '🔓' : '❓'}
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {status === 'valid'
                  ? 'Verified by TEE'
                  : status === 'expired'
                    ? 'Attestation Expired'
                    : 'Unverified'}
              </h3>
              <Tooltip content="Trusted Execution Environment (TEE) provides hardware-level isolation and attestation, ensuring code runs in a secure enclave that cannot be tampered with.">
                <span className="text-gray-400 cursor-help">ⓘ</span>
              </Tooltip>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {provider.name} • {getPlatformDisplayName(provider.teePlatform)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          <span
            className={`transform transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            ▼
          </span>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700">
          {/* Expiration Timer */}
          {expiresAt && status === 'valid' && (
            <div className="flex items-center justify-between py-3 mb-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 mt-3">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Attestation expires in
              </span>
              <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
                {timeRemaining}
              </span>
            </div>
          )}

          {/* Provider Details */}
          <div className="mt-3">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Provider Details
            </h4>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <InfoRow
                label="Address"
                value={truncateHash(provider.address)}
                copyable
              />
              <InfoRow label="Endpoint" value={provider.endpoint} />
              <InfoRow
                label="Platform"
                value={getPlatformDisplayName(provider.teePlatform)}
              />
              <InfoRow
                label="mrEnclave"
                value={truncateHash(provider.mrEnclave)}
                copyable
              />
              <InfoRow
                label="mrSigner"
                value={truncateHash(provider.mrSigner)}
                copyable
              />
            </div>
          </div>

          {/* Attestation History */}
          {attestationHistory.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              >
                <span
                  className={`transform transition-transform ${showHistory ? 'rotate-90' : ''}`}
                >
                  ▶
                </span>
                <span>Attestation History ({attestationHistory.length})</span>
              </button>

              {showHistory && (
                <div className="mt-2 space-y-2">
                  {attestationHistory.slice(0, 10).map((record) => (
                    <div
                      key={record.id}
                      className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <StatusBadge status={record.status} size="sm" />
                        <span className="font-mono text-xs text-gray-500">
                          {truncateHash(record.mrEnclave, 6)}
                        </span>
                      </div>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">
                        {formatTimestamp(record.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mt-4">
            {onRefreshAttestation && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex-1 py-2 px-4 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white rounded-lg font-medium transition-colors"
              >
                {refreshing ? 'Refreshing...' : 'Refresh Attestation'}
              </button>
            )}
            {onVerify && (
              <button
                type="button"
                onClick={onVerify}
                className="flex-1 py-2 px-4 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors"
              >
                Verify
              </button>
            )}
          </div>

          {/* What is TEE? */}
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <h5 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">
              What is TEE?
            </h5>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              A Trusted Execution Environment (TEE) is a secure area of a
              processor that guarantees code and data loaded inside are
              protected with respect to confidentiality and integrity. Remote
              attestation proves that the code running is exactly what was
              expected, preventing tampering or unauthorized access.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default TrustCenterWidget
