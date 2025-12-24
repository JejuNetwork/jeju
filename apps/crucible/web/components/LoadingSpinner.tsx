/**
 * Loading Spinner Component
 */

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function LoadingSpinner({
  size = 'md',
  className = '',
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  }

  return (
    <div className={`${sizeClasses[size]} ${className}`}>
      <div
        className="w-full h-full rounded-full border-2 animate-spin"
        style={{
          borderColor: 'var(--border)',
          borderTopColor: 'var(--color-primary)',
        }}
      />
    </div>
  )
}
