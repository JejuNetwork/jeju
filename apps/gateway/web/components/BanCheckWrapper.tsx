import { useAccount } from 'wagmi'
import {
  BanBanner,
  BanIndicator,
  BanOverlay,
  BanType,
  useBanStatus,
} from '../lib/ban'

export function BanCheckWrapper({ children }: { children: React.ReactNode }) {
  const { address } = useAccount()
  const banStatus = useBanStatus(address)

  return (
    <>
      <BanOverlay
        banStatus={banStatus}
        appName="Gateway"
        appealUrl="/moderation"
      />
      <BanBanner
        banStatus={banStatus}
        appName="Gateway"
        appealUrl="/moderation"
      />
      {children}
    </>
  )
}

export function BanStatusIndicator() {
  const { address } = useAccount()
  const banStatus = useBanStatus(address)

  return <BanIndicator banStatus={banStatus} />
}

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
