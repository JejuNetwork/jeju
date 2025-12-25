import { Outlet } from 'react-router-dom'
import { Header } from './Header'

export function Layout() {
  return (
    <div className="min-h-screen min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-3 sm:px-4 pt-16 sm:pt-18 pb-6 sm:pb-8">
        <Outlet />
      </main>
    </div>
  )
}
