/**
 * StatsGrid Component
 *
 * Responsive grid of stat cards with loading states and animations.
 */

import { clsx } from 'clsx'
import { Loader2 } from 'lucide-react'

interface StatItem {
  label: string
  value: string | number
  color?: string
  loading?: boolean
}

interface StatsGridProps {
  stats: StatItem[]
  columns?: 2 | 3 | 4
}

const columnClasses = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
}

export function StatsGrid({ stats, columns = 4 }: StatsGridProps) {
  return (
    <section
      className={clsx(
        'grid gap-3 sm:gap-4 mb-6 sm:mb-8',
        columnClasses[columns],
      )}
      aria-label="Statistics"
    >
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={clsx(
            'card stat-card p-4 sm:p-5 text-center animate-slide-up',
            `stagger-${index + 1}`,
          )}
        >
          {stat.loading ? (
            <div className="flex justify-center py-1">
              <Loader2
                className="w-6 h-6 animate-spin text-surface-500"
                aria-hidden="true"
              />
              <span className="sr-only">Loading {stat.label}</span>
            </div>
          ) : (
            <p
              className={clsx(
                'text-2xl sm:text-3xl font-bold font-display',
                stat.color,
              )}
            >
              {stat.value}
            </p>
          )}
          <p className="text-surface-500 text-sm mt-1">{stat.label}</p>
        </div>
      ))}
    </section>
  )
}
