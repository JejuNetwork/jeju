import { Loader2, Power } from 'lucide-react'

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
  return (
    <div className="flex flex-col items-center py-8">
      {/* Outer ring */}
      <div
        className={`relative p-2 rounded-full ${
          isConnected
            ? 'bg-gradient-to-r from-[#00ff88]/20 to-[#00cc6a]/20'
            : 'bg-[#1a1a25]'
        }`}
      >
        {/* Animated ring when connected */}
        {isConnected && (
          <div className="absolute inset-0 rounded-full animate-pulse-glow" />
        )}

        {/* Button */}
        <button
          type="button"
          onClick={onToggle}
          disabled={isLoading}
          className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
            isConnected
              ? 'bg-gradient-to-br from-[#00ff88] to-[#00cc6a] shadow-lg shadow-[#00ff88]/30'
              : 'bg-[#12121a] border-2 border-[#2a2a35] hover:border-[#3a3a45]'
          } ${isLoading ? 'opacity-70' : ''}`}
        >
          {isLoading ? (
            <Loader2
              className={`w-12 h-12 animate-spin ${isConnected ? 'text-black' : 'text-[#606070]'}`}
            />
          ) : (
            <Power
              className={`w-12 h-12 ${isConnected ? 'text-black' : 'text-[#606070]'}`}
            />
          )}
        </button>
      </div>

      {/* Status text */}
      <div className="mt-6 text-center">
        <h2
          className={`text-xl font-semibold ${isConnected ? 'text-[#00ff88] glow-text' : 'text-white'}`}
        >
          {isLoading
            ? isConnected
              ? 'Disconnecting...'
              : 'Connecting...'
            : isConnected
              ? 'Protected'
              : 'Tap to Connect'}
        </h2>
        <p className="text-sm text-[#606070] mt-1">
          {isConnected
            ? 'Your traffic is encrypted and routed through Jeju'
            : 'Connect to secure your internet connection'}
        </p>
      </div>
    </div>
  )
}
