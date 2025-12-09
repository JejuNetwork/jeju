import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Header } from '@/src/components/Header'
import { Toaster } from 'sonner'

const geist = Geist({ 
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({ 
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const geistMono = Geist_Mono({ 
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Storage - Decentralized File Storage on Jeju',
  description: 'Upload, store, and share files across IPFS, cloud, and permanent storage. Pay with crypto, no logins required.',
  keywords: ['IPFS', 'storage', 'decentralized', 'files', 'crypto', 'Jeju', 'Arweave', 'cloud'],
  authors: [{ name: 'Jeju Network' }],
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8FAFC' },
    { media: '(prefers-color-scheme: dark)', color: '#030712' },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const savedTheme = localStorage.getItem('storage-theme');
                  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark;
                  if (shouldBeDark) {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={`${geist.variable} ${spaceGrotesk.variable} ${geistMono.variable} font-sans antialiased`}>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 container mx-auto px-3 sm:px-4 md:px-6 lg:px-8 pt-[72px] sm:pt-20 md:pt-24 pb-8 sm:pb-12 max-w-7xl">
              {children}
            </main>
            <footer 
              className="border-t py-5 sm:py-6 md:py-8 mt-auto"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="container mx-auto px-3 sm:px-4 md:px-6 lg:px-8 max-w-7xl">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className="text-xl sm:text-2xl">📦</span>
                    <span className="text-lg sm:text-xl font-bold text-gradient">Jeju Storage</span>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 md:gap-6">
                    <p className="text-xs sm:text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                      Decentralized File Storage
                    </p>
                    <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-storage-success" />
                        IPFS
                      </span>
                      <span>•</span>
                      <span>Arweave</span>
                      <span>•</span>
                      <span>Cloud</span>
                    </div>
                  </div>
                </div>
              </div>
            </footer>
            <Toaster 
              position="bottom-center"
              toastOptions={{
                style: {
                  background: 'var(--surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  fontSize: '14px',
                },
              }}
            />
          </div>
        </Providers>
      </body>
    </html>
  )
}

