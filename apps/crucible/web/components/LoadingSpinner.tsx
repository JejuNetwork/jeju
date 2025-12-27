/**
 * Loading Spinner Component
 *
 * Animated loading indicator with multiple sizes
 */

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}

export function LoadingSpinner({
  size = 'md',
  className = '',
  label = 'Loading',
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-2',
    lg: 'w-12 h-12 border-3',
  }

  return (
    <div
      className={`${sizeClasses[size]} ${className}`}
      role="status"
      aria-label={label}
    >
      <div
        className="w-full h-full rounded-full animate-spin"
        style={{
          borderColor: 'var(--border)',
          borderTopColor: 'var(--color-primary)',
          borderRightColor: 'var(--color-accent)',
          borderStyle: 'solid',
          borderWidth: 'inherit',
        }}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </div>
  )
}
