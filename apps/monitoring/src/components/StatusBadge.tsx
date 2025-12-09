interface StatusBadgeProps {
  status: 'online' | 'offline' | 'warning' | 'unknown'
  label?: string
  pulse?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function StatusBadge({ status, label, pulse = true, size = 'md' }: StatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case 'online':
        return {
          dotClass: 'status-online',
          label: label || 'Online',
          bgColor: 'rgba(16, 185, 129, 0.15)',
          textColor: 'var(--color-success)',
        }
      case 'offline':
        return {
          dotClass: 'status-offline',
          label: label || 'Offline',
          bgColor: 'rgba(239, 68, 68, 0.15)',
          textColor: 'var(--color-error)',
        }
      case 'warning':
        return {
          dotClass: 'status-warning',
          label: label || 'Warning',
          bgColor: 'rgba(245, 158, 11, 0.15)',
          textColor: 'var(--color-warning)',
        }
      default:
        return {
          dotClass: 'bg-gray-400',
          label: label || 'Unknown',
          bgColor: 'var(--bg-secondary)',
          textColor: 'var(--text-tertiary)',
        }
    }
  }

  const config = getStatusConfig()
  
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-3 py-1 text-xs',
    lg: 'px-4 py-1.5 text-sm',
  }
  
  const dotSizes = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${sizeClasses[size]}`}
      style={{ backgroundColor: config.bgColor, color: config.textColor }}
    >
      <span className={`${dotSizes[size]} rounded-full ${config.dotClass} ${pulse ? 'animate-pulse' : ''}`} />
      {config.label}
    </span>
  )
}

