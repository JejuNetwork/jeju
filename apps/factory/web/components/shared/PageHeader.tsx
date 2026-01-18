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
            className={`flex-shrink-0 w-12 h-12 bg-surface-800/80 border border-surface-700/50 flex items-center justify-center ${iconColor}`}
            style={{
              clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
            }}
            aria-hidden="true"
          >
            <Icon className="w-6 h-6" />
          </div>
        )}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50 font-display tracking-wider uppercase">
            {title}
          </h1>
          {description && (
            <p className="text-surface-400 mt-1 text-sm tracking-wide">
              {description}
            </p>
          )}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </header>
  )
}
