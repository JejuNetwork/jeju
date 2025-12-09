interface HealthRingProps {
  percentage: number
  size?: number
  strokeWidth?: number
  label?: string
  value?: string
  status?: 'success' | 'warning' | 'error'
}

export function HealthRing({ 
  percentage, 
  size = 120, 
  strokeWidth = 10,
  label,
  value,
  status
}: HealthRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (percentage / 100) * circumference

  const getColor = () => {
    if (status === 'success' || percentage >= 80) return 'var(--color-success)'
    if (status === 'warning' || percentage >= 50) return 'var(--color-warning)'
    return 'var(--color-error)'
  }

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--bg-tertiary)"
          strokeWidth={strokeWidth}
        />
        {/* Progress ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
          style={{
            filter: `drop-shadow(0 0 6px ${getColor()})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span 
          className="text-2xl md:text-3xl font-bold"
          style={{ color: 'var(--text-primary)' }}
        >
          {value || `${Math.round(percentage)}%`}
        </span>
        {label && (
          <span 
            className="text-xs font-medium mt-0.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {label}
          </span>
        )}
      </div>
    </div>
  )
}

