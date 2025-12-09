import { ReactNode } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  icon: ReactNode
  trend?: {
    value: number
    label?: string
  }
  status?: 'success' | 'warning' | 'error' | 'info'
  loading?: boolean
}

export function StatCard({ label, value, icon, trend, status, loading }: StatCardProps) {
  const getStatusColor = () => {
    switch (status) {
      case 'success': return 'var(--color-success)'
      case 'warning': return 'var(--color-warning)'
      case 'error': return 'var(--color-error)'
      case 'info': return 'var(--color-info)'
      default: return 'var(--color-primary)'
    }
  }

  const getTrendIcon = () => {
    if (!trend) return null
    if (trend.value > 0) return <TrendingUp className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
    if (trend.value < 0) return <TrendingDown className="w-4 h-4" style={{ color: 'var(--color-error)' }} />
    return <Minus className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
  }

  if (loading) {
    return (
      <div className="card-static p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-3 flex-1">
            <div className="shimmer h-4 w-24 rounded" />
            <div className="shimmer h-8 w-32 rounded" />
          </div>
          <div className="shimmer w-12 h-12 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="card-static p-4 md:p-6 group">
      <div className="flex items-start justify-between">
        <div>
          <p className="stat-label">{label}</p>
          <p className="stat-value mt-1">{value}</p>
          
          {trend && (
            <div className="flex items-center gap-1.5 mt-2">
              {getTrendIcon()}
              <span 
                className="text-sm font-medium"
                style={{ color: trend.value > 0 ? 'var(--color-success)' : trend.value < 0 ? 'var(--color-error)' : 'var(--text-tertiary)' }}
              >
                {trend.value > 0 ? '+' : ''}{trend.value}%
              </span>
              {trend.label && (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {trend.label}
                </span>
              )}
            </div>
          )}
        </div>
        
        <div 
          className="w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
          style={{ 
            backgroundColor: `color-mix(in srgb, ${getStatusColor()} 15%, transparent)`,
            color: getStatusColor(),
          }}
        >
          {icon}
        </div>
      </div>
    </div>
  )
}

