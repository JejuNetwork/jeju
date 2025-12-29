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
      className={`card p-12 flex flex-col items-center justify-center gap-4 animate-in ${className}`}
      aria-label={text}
    >
      <Loader2
        className="w-8 h-8 animate-spin text-factory-400"
        aria-hidden="true"
      />
      <p className="text-surface-400 text-sm">{text}</p>
    </output>
  )
}
