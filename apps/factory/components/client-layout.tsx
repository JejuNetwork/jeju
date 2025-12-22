'use client'

import dynamic from 'next/dynamic'
import { BanCheckWrapper } from '@/components/BanCheckWrapper'
import { MobileNav } from '@/components/mobile-nav'
import { Navigation } from '@/components/navigation'

// Dynamic import providers to avoid SSR issues with WalletConnect
const Providers = dynamic(
  () => import('@/components/providers').then((mod) => mod.Providers),
  { ssr: false },
)

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      {/* Mobile Navigation */}
      <MobileNav />

      <div className="flex min-h-screen">
        {/* Desktop Sidebar - hidden on mobile */}
        <div className="hidden lg:block">
          <Navigation />
        </div>

        {/* Main Content - full width on mobile, offset on desktop */}
        <main className="flex-1 lg:ml-64 min-h-screen">
          <BanCheckWrapper>{children}</BanCheckWrapper>
        </main>
      </div>
    </Providers>
  )
}
