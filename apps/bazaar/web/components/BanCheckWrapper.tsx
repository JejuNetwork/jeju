import { useAccount } from 'wagmi'
import { BanType, useBanStatus } from '../../lib/browser-stubs'

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
          {reason ?? 'Your account has been permanently banned from Bazaar.'}
        </p>
        <a href="/moderation" className="btn-secondary inline-block">
          Learn More
        </a>
      </div>
    </div>
  )
}

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
            {reason ?? 'Your account is on notice.'}
          </span>
        </div>
        <a href="/moderation" className="text-sm font-semibold underline">
          View Details
        </a>
      </div>
    </div>
  )
}

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
