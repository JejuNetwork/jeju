import { clsx } from 'clsx'
import { Search, X } from 'lucide-react'

interface FilterOption {
  value: string
  label: string
}

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  filters?: FilterOption[]
  activeFilter?: string
  onFilterChange?: (filter: string) => void
  className?: string
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
  filters,
  activeFilter,
  onFilterChange,
  className,
}: SearchBarProps) {
  return (
    <div
      className={clsx(
        'relative bg-gradient-to-br from-surface-800/90 to-surface-900/95 border border-surface-700/60 p-3 sm:p-4 mb-6 animate-in',
        className,
      )}
      style={{ clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))' }}
    >
      {/* Corner accents */}
      <div className="absolute top-0 right-0 w-3 h-3 bg-gradient-to-bl from-factory-500/50 to-transparent" />
      <div className="absolute bottom-0 left-0 w-3 h-3 bg-gradient-to-tr from-factory-500/50 to-transparent" />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        {/* Search input */}
        <div className="flex-1 relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder.toUpperCase()}
            className="input pl-10 pr-10"
            aria-label={placeholder}
          />
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-surface-700 text-surface-500 hover:text-factory-400 transition-colors"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter chips */}
        {filters && filters.length > 0 && onFilterChange && (
          <fieldset
            className="flex gap-2 flex-wrap border-0"
            aria-label="Filter options"
          >
            {filters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => onFilterChange(filter.value)}
                className={clsx(
                  'px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all',
                  activeFilter === filter.value
                    ? 'bg-factory-500 text-white shadow-glow'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-100 hover:bg-surface-700 border border-surface-600 hover:border-factory-500',
                )}
                style={{ clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)' }}
                aria-pressed={activeFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </fieldset>
        )}
      </div>
    </div>
  )
}
