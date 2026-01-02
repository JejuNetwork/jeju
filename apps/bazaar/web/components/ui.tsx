import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// ============================================================================
// PageHeader - Consistent page headers with title, description, and actions
// ============================================================================

interface PageHeaderProps {
  icon: string
  title: string
  description: ReactNode
  action?:
    | {
        label: string
        href?: string
        onClick?: () => void
      }
    | ReactNode
}

export function PageHeader({
  icon,
  title,
  description,
  action,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gradient-warm flex items-center gap-3">
          <span
            className="text-3xl md:text-4xl animate-bounce-subtle"
            aria-hidden="true"
          >
            {icon}
          </span>
          <span>{title}</span>
        </h1>
        <p className="text-sm sm:text-base text-secondary max-w-xl">
          {description}
        </p>
      </div>
      {action &&
        (typeof action === 'object' && 'label' in action ? (
          action.href ? (
            <Link
              to={action.href}
              className="btn-primary w-full sm:w-auto text-center whitespace-nowrap"
            >
              {action.label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="btn-primary w-full sm:w-auto whitespace-nowrap"
            >
              {action.label}
            </button>
          )
        ) : (
          action
        ))}
    </header>
  )
}

// ============================================================================
// FilterTabs - Horizontal scrollable filter tabs
// ============================================================================

interface FilterOption<T extends string> {
  value: T
  label: string
  icon?: string
  disabled?: boolean
}

interface FilterTabsProps<T extends string> {
  options: FilterOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: FilterTabsProps<T>) {
  return (
    <div
      className={`flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide ${className}`}
      role="tablist"
      aria-label="Filter options"
    >
      {options.map((option) => {
        const isActive = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={`
              px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap 
              transition-all duration-200 focus-ring
              disabled:opacity-50 disabled:cursor-not-allowed
              ${
                isActive
                  ? 'bg-gradient-warm text-white shadow-glow-sm'
                  : 'bg-surface-secondary text-secondary hover:text-primary hover:bg-surface-elevated'
              }
            `}
          >
            {option.icon && <span className="mr-1.5">{option.icon}</span>}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// ============================================================================
// EmptyState - Consistent empty state displays
// ============================================================================

interface EmptyStateProps {
  icon: string
  title: string
  description: string
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="text-center py-16 px-4 animate-fade-in">
      <div
        className="text-6xl md:text-7xl mb-6 animate-float"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h3 className="text-xl md:text-2xl font-bold mb-3 text-primary">
        {title}
      </h3>
      <p className="text-secondary mb-6 max-w-md mx-auto">{description}</p>
      {action &&
        (action.href ? (
          <Link to={action.href} className="btn-primary">
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="btn-primary"
          >
            {action.label}
          </button>
        ))}
    </div>
  )
}

// ============================================================================
// StatCard - Stats display cards with optional icons and trends
// ============================================================================

interface StatCardProps {
  label: string
  value: string
  icon?: LucideIcon | string
  trend?: {
    value: string
    positive: boolean
  }
  className?: string
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  className = '',
}: StatCardProps) {
  const iconElement =
    typeof Icon === 'string' ? (
      <span className="text-2xl">{Icon}</span>
    ) : Icon ? (
      <Icon className="w-5 h-5 text-primary-color" />
    ) : null

  return (
    <div
      className={`card p-4 md:p-5 hover:scale-[1.02] transition-transform ${className}`}
    >
      <div className="flex items-start gap-3">
        {iconElement && (
          <div className="w-10 h-10 rounded-xl bg-primary-soft flex items-center justify-center shrink-0">
            {iconElement}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-tertiary uppercase tracking-wide font-medium mb-1">
            {label}
          </p>
          <div className="flex items-baseline gap-2">
            <p className="text-xl md:text-2xl font-bold text-primary truncate">
              {value}
            </p>
            {trend && (
              <span
                className={`text-xs font-semibold ${
                  trend.positive ? 'text-success' : 'text-error'
                }`}
              >
                {trend.positive ? '↑' : '↓'} {trend.value}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// InfoCard - Alert/info cards for warnings, errors, etc.
// ============================================================================

interface InfoCardProps {
  variant: 'info' | 'warning' | 'error' | 'success'
  icon?: string
  title?: string
  children: ReactNode
  className?: string
}

const infoCardStyles = {
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  warning: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400',
  error: 'border-red-500/30 bg-red-500/10 text-red-400',
  success: 'border-green-500/30 bg-green-500/10 text-green-400',
}

const defaultIcons = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '❌',
  success: '✓',
}

export function InfoCard({
  variant,
  icon,
  title,
  children,
  className = '',
}: InfoCardProps) {
  const displayIcon = icon ?? defaultIcons[variant]

  return (
    <div
      className={`card p-4 ${infoCardStyles[variant]} ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0" aria-hidden="true">
          {displayIcon}
        </span>
        <div className="flex-1 min-w-0">
          {title && <p className="font-semibold mb-1">{title}</p>}
          <div className="text-sm">{children}</div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Modal - Accessible modal dialog
// ============================================================================

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl'
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'md',
}: ModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
        onClick={onClose}
        aria-label="Close modal"
      />
      <div
        className={`relative w-full ${maxWidthClasses[maxWidth]} rounded-2xl border bg-surface border-default shadow-2xl overflow-hidden animate-modal-in`}
      >
        <header className="flex items-center justify-between p-5 border-b border-default">
          <h2 id="modal-title" className="text-xl font-bold text-primary">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-colors focus-ring"
            aria-label="Close"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ============================================================================
// Grid Layouts - Responsive grid helpers
// ============================================================================

interface GridProps {
  children: ReactNode
  cols?: 1 | 2 | 3 | 4 | 5 | 6
  className?: string
}

export function Grid({ children, cols = 3, className = '' }: GridProps) {
  const colClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
    5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
    6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
  }

  return (
    <div className={`grid gap-4 ${colClasses[cols]} ${className}`}>
      {children}
    </div>
  )
}

// ============================================================================
// BackLink - Consistent back navigation
// ============================================================================

interface BackLinkProps {
  to: string
  label?: string
}

export function BackLink({ to, label = 'Back' }: BackLinkProps) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors mb-4 group"
    >
      <span className="group-hover:-translate-x-0.5 transition-transform">
        ←
      </span>
      {label}
    </Link>
  )
}

// ============================================================================
// ErrorState - Error display with retry
// ============================================================================

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="card p-6 border-red-500/30 bg-red-500/5 animate-fade-in">
      <div className="flex items-start gap-4">
        <span className="text-3xl" aria-hidden="true">
          ⚠️
        </span>
        <div className="flex-1">
          <p className="font-semibold text-red-400 mb-1">{title}</p>
          <p className="text-sm text-secondary mb-4">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="btn-secondary text-sm"
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Skeleton - Loading placeholder
// ============================================================================

interface SkeletonProps {
  className?: string
  variant?: 'text' | 'circular' | 'rectangular'
  width?: string | number
  height?: string | number
}

export function Skeleton({
  className = '',
  variant = 'rectangular',
  width,
  height,
}: SkeletonProps) {
  const variantClasses = {
    text: 'rounded h-4',
    circular: 'rounded-full',
    rectangular: 'rounded-xl',
  }

  return (
    <div
      className={`shimmer ${variantClasses[variant]} ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}
