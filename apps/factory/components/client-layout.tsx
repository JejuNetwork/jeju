'use client';

import dynamic from 'next/dynamic';
import { Navigation } from '@/components/navigation';

// Dynamic import providers to avoid SSR issues with WalletConnect
const Providers = dynamic(
  () => import('@/components/providers').then((mod) => mod.Providers),
  { ssr: false }
);

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-screen">
        <Navigation />
        <main className="flex-1 ml-64">
          {children}
        </main>
      </div>
    </Providers>
  );
}

