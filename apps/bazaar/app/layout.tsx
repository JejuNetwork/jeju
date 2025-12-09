import type { Metadata, Viewport } from 'next'
import { Outfit, Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Header } from '@/components/Header'
import { Toaster } from 'sonner'

const outfit = Outfit({ 
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({ 
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Bazaar - Agent Marketplace on Jeju',
  description: 'The fun, light-hearted marketplace for tokens, NFTs, prediction markets, and more. Trade, swap, and discover on Jeju.',
  keywords: ['DeFi', 'NFT', 'marketplace', 'tokens', 'prediction markets', 'Jeju', 'crypto'],
  authors: [{ name: 'Jeju Network' }],
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFBF7' },
    { media: '(prefers-color-scheme: dark)', color: '#0D0B14' },
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
                  const savedTheme = localStorage.getItem('bazaar-theme');
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
      <body className={`${outfit.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers>
          <div className="min-h-screen">
            <Header />
            <main className="container mx-auto px-4 pt-24 md:pt-28 pb-12">
              {children}
            </main>
            <footer 
              className="border-t py-8 mt-16"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="container mx-auto px-4">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🏝️</span>
                    <span className="font-bold text-gradient">Bazaar</span>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                    Powered by Jeju Network
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
