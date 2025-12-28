import type { ReactNode } from 'react'
import { MobileNav } from './MobileNav'
import { Navigation } from './Navigation'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <>
      <MobileNav />
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <div className="hidden lg:block" aria-hidden="false">
          <Navigation />
        </div>

        {/* Main content */}
        <main className="flex-1 lg:ml-64 min-h-screen" id="main-content">
          {children}
        </main>
      </div>
    </>
  )
}
