'use client';

import dynamic from 'next/dynamic';
import { Navigation } from '@/components/navigation';
import { MobileNav } from '@/components/mobile-nav';

// Dynamic import providers to avoid SSR issues with WalletConnect
const Providers = dynamic(
  () => import('@/components/providers').then((mod) => mod.Providers),
  { ssr: false }
);

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
          {children}
        </main>
      </div>
    </Providers>
  );
}

