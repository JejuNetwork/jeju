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
      className="relative bg-gradient-to-br from-surface-800/90 to-surface-900/95 border border-surface-700/60 p-8 sm:p-12 text-center animate-in flex flex-col items-center justify-center"
      style={{ clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))' }}
      aria-label={title}
    >
      {/* Corner accents */}
      <div className="absolute top-0 right-0 w-4 h-4 bg-gradient-to-bl from-factory-500/40 to-transparent" />
      <div className="absolute bottom-0 left-0 w-4 h-4 bg-gradient-to-tr from-factory-500/40 to-transparent" />

      <div
        className="w-16 h-16 mb-5 bg-surface-800/80 border border-surface-700/50 flex items-center justify-center"
        style={{ clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)' }}
      >
        <Icon className="w-8 h-8 text-surface-500" aria-hidden="true" />
      </div>

      <h3 className="text-lg sm:text-xl font-bold text-surface-200 mb-2 font-display uppercase tracking-wider">
        {title}
      </h3>

      <p className="text-surface-400 text-sm sm:text-base mb-6 max-w-md">
        {description}
      </p>

      {actionLabel &&
        (actionHref || onAction) &&
        (actionHref ? (
          <Link to={actionHref} className="btn btn-primary inline-flex">
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
