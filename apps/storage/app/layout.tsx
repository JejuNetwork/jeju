import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Header } from '@/components/Header'
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
            <main className="flex-1 container mx-auto px-4 pt-20 md:pt-24 pb-12">
              {children}
            </main>
            <footer 
              className="border-t py-6 mt-auto"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="container mx-auto px-4">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📦</span>
                    <span className="font-bold text-gradient">Storage</span>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                    Powered by Jeju Network • IPFS • Arweave • Cloud
                  </p>
                </div>
              </div>
            </footer>
            <Toaster 
              position="bottom-right"
              toastOptions={{
                style: {
                  background: 'var(--surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                },
              }}
            />
          </div>
        </Providers>
      </body>
    </html>
  )
}


