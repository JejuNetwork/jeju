import { Loader2 } from 'lucide-react';

// Provider icons/logos
const PROVIDER_ICONS: Record<string, { icon: string; bg: string; label: string }> = {
  wallet: { icon: '🔐', bg: 'from-blue-600 to-blue-700', label: 'MetaMask / Wallet' },
  farcaster: { icon: '🟣', bg: 'from-purple-600 to-purple-700', label: 'Farcaster' },
  discord: { icon: '💬', bg: 'from-indigo-600 to-indigo-700', label: 'Discord' },
  twitter: { icon: '𝕏', bg: 'from-gray-700 to-gray-800', label: 'X (Twitter)' },
  google: { icon: '🔴', bg: 'from-red-500 to-red-600', label: 'Google' },
  github: { icon: '🐙', bg: 'from-gray-700 to-gray-800', label: 'GitHub' },
  facebook: { icon: '📘', bg: 'from-blue-700 to-blue-800', label: 'Facebook' },
  linkedin: { icon: '💼', bg: 'from-blue-600 to-blue-700', label: 'LinkedIn' },
  slack: { icon: '💬', bg: 'from-purple-500 to-pink-500', label: 'Slack' },
  tiktok: { icon: '🎵', bg: 'from-gray-900 to-black', label: 'TikTok' },
  notion: { icon: '📝', bg: 'from-gray-700 to-gray-800', label: 'Notion' },
  instagram: { icon: '📸', bg: 'from-pink-500 via-purple-500 to-orange-400', label: 'Instagram' },
};

interface ProviderGridProps {
  onSelect: (provider: string) => void;
  isLoading: boolean;
  enabledProviders: string[];
}

export function ProviderGrid({ onSelect, isLoading, enabledProviders }: ProviderGridProps) {
  // Order providers: wallet first, then by popularity
  const orderedProviders = [
    'wallet',
    'google',
    'github',
    'discord',
    'twitter',
    'farcaster',
    'facebook',
    'linkedin',
    'slack',
    'notion',
    'tiktok',
    'instagram',
  ].filter((p) => enabledProviders.includes(p));

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {orderedProviders.map((provider) => {
        const config = PROVIDER_ICONS[provider];
        if (!config) return null;

        return (
          <button
            key={provider}
            onClick={() => onSelect(provider)}
            disabled={isLoading}
            className={`
              relative flex flex-col items-center justify-center gap-2 p-4 rounded-lg
              bg-gradient-to-br ${config.bg}
              hover:opacity-90 hover:scale-[1.02]
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-all duration-200
              border border-white/10
            `}
          >
            {isLoading ? (
              <Loader2 size={24} className="animate-spin" />
            ) : (
              <span className="text-2xl">{config.icon}</span>
            )}
            <span className="text-sm font-medium">{config.label}</span>
            {provider === 'wallet' && (
              <span className="absolute top-1 right-1 px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
                SIWE
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
