import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  icon?: LucideIcon
  iconColor?: string
  action?: ReactNode
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  iconColor = 'text-factory-400',
  action,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between page-header animate-in mb-6">
      <div className="flex items-center gap-4">
        {Icon && (
          <div
            className={`flex-shrink-0 w-12 h-12 rounded-xl bg-surface-800/80 border border-surface-700/50 flex items-center justify-center ${iconColor}`}
            aria-hidden="true"
          >
            <Icon className="w-6 h-6" />
          </div>
        )}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-surface-50 font-display">
            {title}
          </h1>
          {description && <p className="text-white/60 mt-1">{description}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </header>
  )
}
