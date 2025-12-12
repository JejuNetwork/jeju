import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Header } from '@/components/Header'

const geist = Geist({ 
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

const geistMono = Geist_Mono({ 
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Council',
  description: 'AI governance',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Council',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
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
                  const savedTheme = localStorage.getItem('council-theme');
                  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  if (savedTheme ? savedTheme === 'dark' : prefersDark) {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}>
        <Providers>
          <div className="min-h-screen min-h-dvh flex flex-col">
            <Header />
            <main className="flex-1 container mx-auto px-3 sm:px-4 pt-16 sm:pt-18 pb-6 sm:pb-8">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  )
}
