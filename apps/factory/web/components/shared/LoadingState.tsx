import { Loader2 } from 'lucide-react'

interface LoadingStateProps {
  text?: string
  className?: string
}

export function LoadingState({
  text = 'Loading...',
  className = '',
}: LoadingStateProps) {
  return (
    <output
      className={`relative bg-gradient-to-br from-surface-800/90 to-surface-900/95 border border-surface-700/60 p-12 flex flex-col items-center justify-center gap-4 animate-in ${className}`}
      style={{ clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))' }}
      aria-label={text}
    >
      {/* Corner accents */}
      <div className="absolute top-0 right-0 w-3 h-3 bg-gradient-to-bl from-factory-500/50 to-transparent" />
      <div className="absolute bottom-0 left-0 w-3 h-3 bg-gradient-to-tr from-factory-500/50 to-transparent" />

      <div className="relative">
        <Loader2
          className="w-8 h-8 animate-spin text-factory-400"
          aria-hidden="true"
        />
        {/* Glow ring */}
        <div className="absolute inset-0 animate-ping opacity-30">
          <div className="w-8 h-8 border-2 border-factory-400 opacity-50" />
        </div>
      </div>
      <p className="text-surface-400 text-sm uppercase tracking-widest font-medium">{text}</p>
    </output>
  )
}
