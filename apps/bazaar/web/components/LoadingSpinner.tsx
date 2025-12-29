interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

const SIZE_CLASSES = {
  sm: 'w-4 h-4 border-2',
  md: 'w-8 h-8 border-3',
  lg: 'w-12 h-12 border-4',
}

export function LoadingSpinner({
  size = 'md',
  label = 'Loading',
}: LoadingSpinnerProps) {
  return (
    <output className="flex items-center justify-center" aria-label={label}>
      <div
        className={`${SIZE_CLASSES[size]} rounded-full animate-spin border-border border-t-primary-color`}
        style={{
          borderColor: 'var(--border)',
          borderTopColor: 'var(--color-primary)',
        }}
      />
      <span className="sr-only">{label}</span>
    </output>
  )
}
