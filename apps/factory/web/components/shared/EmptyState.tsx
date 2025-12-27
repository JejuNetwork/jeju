/**
 * EmptyState Component
 *
 * Engaging empty state with icon, title, description, and optional action.
 * Provides helpful context when no data is available.
 */

import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: EmptyStateProps) {
  return (
    <output
      className="card p-8 sm:p-12 text-center animate-in"
      aria-label={title}
    >
      <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-surface-800/80 border border-surface-700/50 flex items-center justify-center">
        <Icon className="w-8 h-8 text-surface-500" aria-hidden="true" />
      </div>

      <h3 className="text-lg sm:text-xl font-semibold text-surface-200 mb-2 font-display">
        {title}
      </h3>

      <p className="text-surface-400 text-sm sm:text-base mb-6 max-w-md mx-auto">
        {description}
      </p>

      {actionLabel &&
        (actionHref || onAction) &&
        (actionHref ? (
          <Link to={actionHref} className="btn btn-primary">
            {actionLabel}
          </Link>
        ) : (
          <button type="button" onClick={onAction} className="btn btn-primary">
            {actionLabel}
          </button>
        ))}
    </output>
  )
}
