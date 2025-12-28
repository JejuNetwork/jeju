import { Loader2, Lock, Power, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

interface VPNToggleProps {
  isConnected: boolean
  isLoading: boolean
  onToggle: () => void
}

export function VPNToggle({
  isConnected,
  isLoading,
  onToggle,
}: VPNToggleProps) {
  const [showRipple, setShowRipple] = useState(false)

  useEffect(() => {
    if (isConnected && !isLoading) {
      setShowRipple(true)
      const timer = setTimeout(() => setShowRipple(false), 1000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isConnected, isLoading])

  return (
    <div className="flex flex-col items-center py-6 sm:py-8">
      <div className="relative">
        <div
          className={`absolute inset-0 rounded-full transition-all duration-500 ${
            isConnected ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          }`}
        >
          <div className="absolute inset-[-8px] rounded-full bg-gradient-to-r from-accent/20 via-accent-secondary/10 to-accent/20 animate-spin-slow" />
        </div>

        {showRipple && (
          <>
            <div className="absolute inset-[-20px] rounded-full border-2 border-accent/50 animate-ripple" />
            <div className="absolute inset-[-40px] rounded-full border border-accent/30 animate-ripple-delay" />
          </>
        )}

        {isConnected && (
          <div className="absolute inset-[-4px] rounded-full animate-pulse-glow bg-accent/10" />
        )}

        <button
          type="button"
          onClick={onToggle}
          disabled={isLoading}
          aria-label={isConnected ? 'Disconnect VPN' : 'Connect VPN'}
          aria-pressed={isConnected}
          className={`
            relative w-32 h-32 sm:w-36 sm:h-36 rounded-full flex items-center justify-center
            transition-all duration-500 transform
            focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface
            ${
              isConnected
                ? 'bg-gradient-to-br from-accent via-accent-secondary to-accent-tertiary shadow-2xl shadow-accent/40'
                : 'bg-gradient-to-br from-surface-hover to-surface-elevated border-2 border-border hover:border-accent/30 hover:shadow-glow'
            }
            ${isLoading ? 'scale-95' : 'hover:scale-105 active:scale-95'}
            disabled:cursor-wait
          `}
        >
          <div
            className={`absolute inset-2 rounded-full transition-all duration-300 ${
              isConnected
                ? 'bg-gradient-to-br from-white/20 to-transparent'
                : 'bg-gradient-to-br from-white/5 to-transparent'
            }`}
          />

          {isLoading ? (
            <Loader2
              className={`w-12 h-12 sm:w-14 sm:h-14 animate-spin ${
                isConnected ? 'text-black/80' : 'text-accent'
              }`}
            />
          ) : isConnected ? (
            <ShieldCheck className="w-12 h-12 sm:w-14 sm:h-14 text-black/90 drop-shadow-sm" />
          ) : (
            <Power className="w-12 h-12 sm:w-14 sm:h-14 text-muted group-hover:text-accent transition-colors" />
          )}
        </button>
      </div>

      <div className="mt-6 sm:mt-8 text-center px-4">
        <div className="flex items-center justify-center gap-2 mb-2">
          {isConnected && !isLoading && (
            <Lock className="w-4 h-4 text-accent animate-fade-in" />
          )}
          <h2
            className={`text-xl sm:text-2xl font-semibold transition-all duration-300 ${
              isConnected ? 'text-accent glow-text' : 'text-white'
            }`}
          >
            {isLoading
              ? isConnected
                ? 'Disconnecting...'
                : 'Connecting...'
              : isConnected
                ? 'Connected'
                : 'Tap to Connect'}
          </h2>
        </div>
        <p className="text-sm text-muted-light max-w-xs mx-auto leading-relaxed">
          {isLoading
            ? isConnected
              ? 'Disconnecting...'
              : 'Connecting...'
            : isConnected
              ? 'Traffic encrypted'
              : 'Secure your connection'}
        </p>
      </div>

    </div>
  )
}
