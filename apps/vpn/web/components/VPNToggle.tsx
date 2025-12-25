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

  // Trigger ripple effect on connection
  useEffect(() => {
    if (isConnected && !isLoading) {
      setShowRipple(true)
      const timer = setTimeout(() => setShowRipple(false), 1000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isConnected, isLoading])

  return (
    <div className="flex flex-col items-center py-8">
      {/* Outer ring with animated gradient */}
      <div className="relative">
        {/* Background ring animation */}
        <div
          className={`absolute inset-0 rounded-full transition-all duration-500 ${
            isConnected ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          }`}
        >
          <div className="absolute inset-[-8px] rounded-full bg-gradient-to-r from-[#00ff88]/20 via-[#00cc6a]/10 to-[#00ff88]/20 animate-spin-slow" />
        </div>

        {/* Ripple effect on connect */}
        {showRipple && (
          <>
            <div className="absolute inset-[-20px] rounded-full border-2 border-[#00ff88]/50 animate-ripple" />
            <div className="absolute inset-[-40px] rounded-full border border-[#00ff88]/30 animate-ripple-delay" />
          </>
        )}

        {/* Pulse glow when connected */}
        {isConnected && (
          <div className="absolute inset-[-4px] rounded-full animate-pulse-glow bg-[#00ff88]/10" />
        )}

        {/* Main button */}
        <button
          type="button"
          onClick={onToggle}
          disabled={isLoading}
          aria-label={isConnected ? 'Disconnect VPN' : 'Connect VPN'}
          className={`
            relative w-36 h-36 rounded-full flex items-center justify-center
            transition-all duration-500 transform
            focus:outline-none focus:ring-4 focus:ring-[#00ff88]/30
            ${
              isConnected
                ? 'bg-gradient-to-br from-[#00ff88] via-[#00dd77] to-[#00cc6a] shadow-2xl shadow-[#00ff88]/40'
                : 'bg-gradient-to-br from-[#1a1a25] to-[#12121a] border-2 border-[#2a2a35] hover:border-[#00ff88]/30 hover:shadow-lg hover:shadow-[#00ff88]/10'
            }
            ${isLoading ? 'scale-95' : 'hover:scale-105 active:scale-95'}
          `}
        >
          {/* Inner glow ring */}
          <div
            className={`absolute inset-2 rounded-full transition-all duration-300 ${
              isConnected
                ? 'bg-gradient-to-br from-white/20 to-transparent'
                : 'bg-gradient-to-br from-white/5 to-transparent'
            }`}
          />

          {/* Icon */}
          {isLoading ? (
            <div className="relative">
              <Loader2
                className={`w-14 h-14 animate-spin ${
                  isConnected ? 'text-black/80' : 'text-[#00ff88]'
                }`}
              />
            </div>
          ) : isConnected ? (
            <ShieldCheck className="w-14 h-14 text-black/90 drop-shadow-sm" />
          ) : (
            <Power className="w-14 h-14 text-[#606070] group-hover:text-[#00ff88] transition-colors" />
          )}
        </button>
      </div>

      {/* Status text */}
      <div className="mt-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          {isConnected && !isLoading && (
            <Lock className="w-4 h-4 text-[#00ff88] animate-fade-in" />
          )}
          <h2
            className={`text-2xl font-semibold transition-all duration-300 ${
              isConnected ? 'text-[#00ff88] glow-text' : 'text-white'
            }`}
          >
            {isLoading
              ? isConnected
                ? 'Disconnecting...'
                : 'Connecting...'
              : isConnected
                ? 'Protected'
                : 'Tap to Connect'}
          </h2>
        </div>
        <p className="text-sm text-[#808090] max-w-xs mx-auto">
          {isLoading
            ? isConnected
              ? 'Safely closing your secure tunnel...'
              : 'Establishing encrypted connection...'
            : isConnected
              ? 'Your traffic is encrypted and routed through Jeju'
              : 'Connect to secure your internet connection'}
        </p>
      </div>

      {/* Keyboard shortcut hint */}
      <div className="mt-4 text-xs text-[#505060]">
        <kbd className="px-2 py-1 bg-[#1a1a25] rounded border border-[#2a2a35] font-mono">
          {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Shift+V
        </kbd>
        <span className="ml-2">to toggle</span>
      </div>
    </div>
  )
}
