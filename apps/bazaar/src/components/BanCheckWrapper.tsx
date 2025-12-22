/**
 * Ban Check Wrapper for Bazaar (Browser-compatible)
 *
 * Shows banner for users on notice, full overlay for permanently banned users.
 * Uses browser-compatible stubs when server packages are not available.
 */

import { useAccount } from 'wagmi'
import { BanType, useBanStatus } from '../lib/browser-stubs'

/**
 * Ban overlay for permanently banned users
 */
function BanOverlay({
  isBanned,
  reason,
}: {
  isBanned: boolean
  reason: string | null
}) {
  if (!isBanned) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.9)' }}
    >
      <div className="max-w-md text-center">
        <div className="text-6xl mb-4">🚫</div>
        <h1
          className="text-2xl font-bold mb-2"
          style={{ color: 'var(--color-error)' }}
        >
          Account Banned
        </h1>
        <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
          {reason || 'Your account has been permanently banned from Bazaar.'}
        </p>
        <a href="/moderation" className="btn-secondary inline-block">
          Learn More
        </a>
      </div>
    </div>
  )
}

/**
 * Warning banner for users on notice
 */
function BanBanner({
  isOnNotice,
  reason,
}: {
  isOnNotice: boolean
  reason: string | null
}) {
  if (!isOnNotice) return null

  return (
    <div
      className="fixed top-16 md:top-20 left-0 right-0 z-40 px-4 py-2"
      style={{ backgroundColor: 'var(--color-warning)', color: '#000' }}
    >
      <div className="container mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span>⚠️</span>
          <span className="text-sm font-medium">
            {reason || 'Your account is on notice.'}
          </span>
        </div>
        <a href="/moderation" className="text-sm font-semibold underline">
          View Details
        </a>
      </div>
    </div>
  )
}

/**
 * Ban check wrapper component
 */
export function BanCheckWrapper({ children }: { children: React.ReactNode }) {
  const { address } = useAccount()
  const banStatus = useBanStatus(address)

  const isPermanentlyBanned =
    banStatus.isBanned && banStatus.banType === BanType.PERMANENT
  const isOnNotice =
    banStatus.isOnNotice || banStatus.banType === BanType.ON_NOTICE

  return (
    <>
      <BanOverlay isBanned={isPermanentlyBanned} reason={banStatus.reason} />
      <BanBanner
        isOnNotice={isOnNotice && !isPermanentlyBanned}
        reason={banStatus.reason}
      />
      {children}
    </>
  )
}

/**
 * Compact ban indicator for navigation
 */
export function BanStatusIndicator() {
  const { address } = useAccount()
  const banStatus = useBanStatus(address)

  if (!banStatus.isBanned && !banStatus.isOnNotice) {
    return null
  }

  return (
    <span
      className="px-2 py-1 rounded-full text-xs font-semibold"
      style={{
        backgroundColor: banStatus.isBanned
          ? 'rgba(239, 68, 68, 0.15)'
          : 'rgba(245, 158, 11, 0.15)',
        color: banStatus.isBanned
          ? 'var(--color-error)'
          : 'var(--color-warning)',
      }}
    >
      {banStatus.isBanned ? '🚫 Banned' : '⚠️ Notice'}
    </span>
  )
}

/**
 * Hook to check if user can perform actions
 */
export function useCanPerformAction(): {
  canAct: boolean
  reason: string | null
  loading: boolean
} {
  const { address } = useAccount()
  const banStatus = useBanStatus(address)

  if (banStatus.loading) {
    return { canAct: true, reason: null, loading: true }
  }

  if (banStatus.isBanned && banStatus.banType === BanType.PERMANENT) {
    return {
      canAct: false,
      reason: banStatus.reason || 'Account banned',
      loading: false,
    }
  }

  return { canAct: true, reason: null, loading: false }
}
