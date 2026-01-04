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
            'relative bg-gradient-to-br from-surface-800/90 to-surface-900/95 border border-surface-700/60 p-4 sm:p-5 text-center animate-slide-up overflow-hidden',
            `stagger-${index + 1}`,
          )}
          style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))' }}
        >
          {/* Left accent bar */}
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-factory-500 to-accent-500 opacity-60"
          />

          {/* Corner accent */}
          <div className="absolute top-0 right-0 w-[10px] h-[10px] bg-gradient-to-bl from-factory-500/40 to-transparent" />

          {stat.loading ? (
            <div className="flex justify-center py-1">
              <Loader2
                className="w-6 h-6 animate-spin text-factory-400"
                aria-hidden="true"
              />
              <span className="sr-only">Loading {stat.label}</span>
            </div>
          ) : (
            <p
              className={clsx(
                'text-2xl sm:text-3xl font-bold font-display tracking-wide',
                stat.color,
              )}
            >
              {stat.value}
            </p>
          )}
          <p className="text-surface-500 text-xs sm:text-sm mt-1 uppercase tracking-widest font-medium">
            {stat.label}
          </p>
        </div>
      ))}
    </section>
  )
}
