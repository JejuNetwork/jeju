'use client';

import { useAccount } from 'wagmi';
import {
  useBanStatus,
  BanBanner,
  BanOverlay,
  BanIndicator,
  BanType,
} from '@jejunetwork/shared';

/**
 * Ban check wrapper for Bazaar
 * Shows banner for users on notice, full overlay for permanently banned users
 */
export function BanCheckWrapper({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const banStatus = useBanStatus(address);

  return (
    <>
      {/* Full-screen overlay for permanently banned users */}
      <BanOverlay 
        banStatus={banStatus} 
        appName="Bazaar"
        appealUrl="/moderation"
      />
      
      {/* Banner for on-notice or challenged users */}
      <BanBanner 
        banStatus={banStatus} 
        appName="Bazaar"
        appealUrl="/moderation"
      />
      
      {children}
    </>
  );
}

/**
 * Compact ban indicator for use in navigation/header
 */
export function BanStatusIndicator() {
  const { address } = useAccount();
  const banStatus = useBanStatus(address);
  
  return <BanIndicator banStatus={banStatus} />;
}

/**
 * Hook to check if user can perform actions
 */
export function useCanPerformAction(): { canAct: boolean; reason: string | null; loading: boolean } {
  const { address } = useAccount();
  const banStatus = useBanStatus(address);
  
  if (banStatus.loading) {
    return { canAct: true, reason: null, loading: true };
  }
  
  if (banStatus.isBanned && banStatus.banType === BanType.PERMANENT) {
    return { canAct: false, reason: banStatus.reason || 'Account banned', loading: false };
  }
  
  return { canAct: true, reason: null, loading: false };
}
