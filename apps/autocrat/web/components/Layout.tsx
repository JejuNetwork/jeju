import { Outlet, useLocation } from 'react-router-dom'
import { Breadcrumbs } from './Breadcrumbs'
import { Header } from './Header'

export function Layout() {
  const location = useLocation()
  // Show breadcrumbs on detail pages
  const showBreadcrumbs =
    location.pathname !== '/' && location.pathname !== '/my-daos'

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <Header />
      <main className="flex-1">
        {showBreadcrumbs && (
          <div className="container mx-auto">
            <Breadcrumbs />
          </div>
        )}
        <Outlet />
      </main>
      <footer
        className="py-6 border-t"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="container mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
            <p style={{ color: 'var(--text-tertiary)' }}>
              Built with care by the Jeju Network
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://docs.jejunetwork.org"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:underline"
                style={{ color: 'var(--text-secondary)' }}
              >
                Docs
              </a>
              <a
                href="https://github.com/jejunetwork"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:underline"
                style={{ color: 'var(--text-secondary)' }}
              >
                GitHub
              </a>
              <a
                href="https://warpcast.com/jeju"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:underline"
                style={{ color: 'var(--text-secondary)' }}
              >
                Farcaster
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
