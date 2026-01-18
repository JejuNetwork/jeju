import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: EmptyStateProps) {
  const buttonContent = (
    <>
      <Sparkles className="w-4 h-4" aria-hidden="true" />
      <span>{actionLabel}</span>
      <ArrowRight
        className="w-4 h-4 transition-transform group-hover:translate-x-1"
        aria-hidden="true"
      />
    </>
  )

  return (
    <output
      className="relative bg-gradient-to-br from-surface-800/90 via-surface-850/95 to-surface-900/98 border border-surface-700/60 p-10 sm:p-14 text-center animate-in flex flex-col items-center justify-center overflow-hidden"
      style={{
        clipPath:
          'polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 20px 100%, 0 calc(100% - 20px))',
      }}
      aria-label={title}
    >
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(6, 182, 212, 0.8) 1px, transparent 1px),
            linear-gradient(90deg, rgba(6, 182, 212, 0.8) 1px, transparent 1px)
          `,
          backgroundSize: '32px 32px',
        }}
      />

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-radial from-factory-500/10 via-accent-500/5 to-transparent rounded-full blur-2xl pointer-events-none" />

      <div className="absolute top-0 right-0 w-5 h-5 bg-gradient-to-bl from-factory-500/50 to-transparent" />
      <div className="absolute bottom-0 left-0 w-5 h-5 bg-gradient-to-tr from-accent-500/40 to-transparent" />

      <div className="absolute top-0 left-0 w-24 h-px bg-gradient-to-r from-factory-500/60 to-transparent" />
      <div className="absolute bottom-0 right-0 w-24 h-px bg-gradient-to-l from-accent-500/60 to-transparent" />
      <div className="absolute top-0 left-0 h-16 w-px bg-gradient-to-b from-factory-500/60 to-transparent" />
      <div className="absolute bottom-0 right-0 h-16 w-px bg-gradient-to-t from-accent-500/60 to-transparent" />

      <div className="relative mb-6">
        <div
          className="relative w-20 h-20 bg-gradient-to-br from-surface-700/80 to-surface-800/90 border border-surface-600/60 flex items-center justify-center shadow-lg"
          style={{
            clipPath: 'polygon(12px 0, 100% 0, calc(100% - 12px) 100%, 0 100%)',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-factory-500/10 to-transparent" />
          <Icon
            className="relative w-9 h-9 text-factory-400/80"
            aria-hidden="true"
          />
        </div>
        <div
          className="absolute -bottom-1 left-1 w-20 h-20 bg-factory-500/20 blur-sm -z-10"
          style={{
            clipPath: 'polygon(12px 0, 100% 0, calc(100% - 12px) 100%, 0 100%)',
          }}
        />
      </div>

      <h3 className="text-xl sm:text-2xl font-bold text-surface-100 mb-3 font-display uppercase tracking-wider">
        {title}
      </h3>

      <p className="text-surface-400 text-sm sm:text-base mb-8 max-w-sm leading-relaxed">
        {description}
      </p>

      {actionLabel &&
        (actionHref || onAction) &&
        (actionHref ? (
          <Link
            to={actionHref}
            className="group relative inline-flex items-center gap-2.5 px-6 py-3 font-semibold text-sm uppercase tracking-wider transition-all duration-200"
            style={{
              clipPath:
                'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-factory-500 via-factory-400 to-factory-500 opacity-90 group-hover:opacity-100 transition-opacity" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            <div className="absolute -inset-1 bg-factory-500/30 blur-lg opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
            <span className="relative flex items-center gap-2.5 text-white">
              {buttonContent}
            </span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={onAction}
            className="group relative inline-flex items-center gap-2.5 px-6 py-3 font-semibold text-sm uppercase tracking-wider transition-all duration-200"
            style={{
              clipPath:
                'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-factory-500 via-factory-400 to-factory-500 opacity-90 group-hover:opacity-100 transition-opacity" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            <div className="absolute -inset-1 bg-factory-500/30 blur-lg opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
            <span className="relative flex items-center gap-2.5 text-white">
              {buttonContent}
            </span>
          </button>
        ))}
    </output>
  )
}
