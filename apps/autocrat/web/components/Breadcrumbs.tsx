import { ChevronRight, Home } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useDAO } from '../hooks/useDAO'

interface BreadcrumbItem {
  label: string
  href?: string
}

export function Breadcrumbs() {
  const location = useLocation()
  const { daoId, proposalId, agentId } = useParams()
  const { data: dao } = useDAO(daoId)

  const items: BreadcrumbItem[] = []

  // Build breadcrumb items based on current route
  const pathParts = location.pathname.split('/').filter(Boolean)

  if (pathParts[0] === 'dao' && daoId) {
    items.push({
      label: dao?.displayName ?? daoId,
      href: `/dao/${daoId}`,
    })

    if (pathParts[2] === 'proposal') {
      if (proposalId === 'new') {
        items.push({ label: 'New Proposal' })
      } else if (proposalId) {
        items.push({
          label: `Proposal ${proposalId.slice(0, 8)}...`,
        })
      }
    }

    if (pathParts[2] === 'agent' && agentId) {
      items.push({ label: 'Edit Agent' })
    }
  }

  if (pathParts[0] === 'create') {
    items.push({ label: 'Create DAO' })
  }

  if (pathParts[0] === 'my-daos') {
    items.push({ label: 'My DAOs' })
  }

  if (pathParts[0] === 'director') {
    items.push({ label: 'Director Dashboard' })
  }

  // Don't render if we only have home or single item
  if (items.length === 0) return null

  return (
    <nav
      className="flex items-center gap-2 text-sm py-3"
      aria-label="Breadcrumb"
    >
      <Link
        to="/"
        className="p-1.5 rounded-lg transition-colors hover:bg-[var(--bg-secondary)]"
        style={{ color: 'var(--text-tertiary)' }}
        aria-label="Home"
      >
        <Home className="w-4 h-4" />
      </Link>

      {items.map((item, index) => (
        <div key={item.label} className="flex items-center gap-2">
          <ChevronRight
            className="w-4 h-4"
            style={{ color: 'var(--text-tertiary)' }}
            aria-hidden="true"
          />
          {item.href && index < items.length - 1 ? (
            <Link
              to={item.href}
              className="px-2 py-1 rounded-lg transition-colors hover:bg-[var(--bg-secondary)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              {item.label}
            </Link>
          ) : (
            <span
              className="px-2 py-1"
              style={{ color: 'var(--text-primary)' }}
              aria-current="page"
            >
              {item.label}
            </span>
          )}
        </div>
      ))}
    </nav>
  )
}
