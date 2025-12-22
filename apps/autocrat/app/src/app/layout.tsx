import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Header } from '@/components/Header'
import { Providers } from './providers'

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
  title: 'Autocrat',
  description: 'AI governance',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Autocrat',
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

// Theme initialization script to prevent flash of wrong theme
const themeScript = `(function() {
  try {
    const savedTheme = localStorage.getItem('autocrat-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme ? savedTheme === 'dark' : prefersDark) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {
    console.warn('Failed to initialize theme:', e);
  }
})();`

function ThemeScript() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: Theme initialization requires inline script to prevent flash of wrong theme
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body
        className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}
      >
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
