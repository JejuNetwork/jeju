/**
 * Autocrat Layout Component
 *
 * Main layout wrapper with header for the application.
 */

import { Outlet } from 'react-router-dom'
import { Header } from './Header'

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-950">
      <Header />
      <main>
        <Outlet />
      </main>
    </div>
  )
}
