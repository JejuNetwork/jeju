import './globals.css';
import type { Metadata } from 'next';
import { ClientLayout } from '@/components/client-layout';

export const metadata: Metadata = {
  title: 'Factory | Jeju Developer Hub',
  description: 'Bounties, jobs, git, packages, containers, models - developer coordination powered by Jeju',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-factory-950 text-factory-100 antialiased">
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  );
}
