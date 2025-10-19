import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Header } from '@/components/Header'
import { Toaster } from 'sonner'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Bazaar - Jeju DeFi + NFT + Token Launchpad',
  description: 'Unified token launchpad, Uniswap V4 swaps, liquidity pools, and NFT marketplace on Jeju L3',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
            <Header />
            <main className="container mx-auto px-4 py-8 mt-20">
              {children}
            </main>
            <Toaster position="bottom-right" />
          </div>
        </Providers>
      </body>
    </html>
  )
}

