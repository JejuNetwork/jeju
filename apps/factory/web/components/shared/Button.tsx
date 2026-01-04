import { clsx } from 'clsx'
import { Loader2, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: LucideIcon
  iconPosition?: 'left' | 'right'
  children: ReactNode
}

const variants = {
  primary:
    'bg-gradient-to-r from-factory-500 to-factory-600 text-white shadow-glow hover:from-factory-400 hover:to-factory-500 hover:shadow-glow-lg',
  secondary:
    'bg-surface-800 text-surface-100 border border-surface-600 hover:border-factory-500 hover:bg-surface-700',
  ghost:
    'bg-transparent text-surface-400 hover:text-factory-400 hover:bg-surface-800/50 [clip-path:none]',
  danger:
    'bg-gradient-to-r from-error-500/80 to-error-600/90 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:shadow-[0_0_25px_rgba(239,68,68,0.5)]',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-5 py-2 text-sm gap-2',
  lg: 'px-7 py-3 text-base gap-2.5',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconPosition = 'left',
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'

  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={clsx(
        // Base styles - Angular rhombus shape
        'inline-flex items-center justify-center font-semibold',
        'font-[Rajdhani,system-ui,sans-serif] uppercase tracking-wider',
        'transition-all duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        // Rhombus clip-path (slanted parallelogram)
        '[clip-path:polygon(8px_0,100%_0,calc(100%-8px)_100%,0_100%)]',
        // Variant and size
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className={clsx(iconSize, 'animate-spin')} />}
      {!loading && Icon && iconPosition === 'left' && (
        <Icon className={iconSize} aria-hidden="true" />
      )}
      <span className="relative">{children}</span>
      {!loading && Icon && iconPosition === 'right' && (
        <Icon className={iconSize} aria-hidden="true" />
      )}
    </button>
  )
}
