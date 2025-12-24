import type { ReactNode } from 'react'
import { MobileNav } from './MobileNav'
import { Navigation } from './Navigation'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <MobileNav />
      <div className="flex min-h-screen">
        <div className="hidden lg:block">
          <Navigation />
        </div>
        <main className="flex-1 lg:ml-64 min-h-screen">{children}</main>
      </div>
    </>
  )
}
