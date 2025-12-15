import { useState, useEffect } from 'react';
import { X, Loader2, Wallet } from 'lucide-react';
import { useConnect, useDisconnect } from 'wagmi';
import type { Address } from 'viem';

const AUTH_SERVER = import.meta.env.VITE_OAUTH3_AUTH_SERVER || 'http://localhost:4200';

// Provider Icons
const DiscordIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

const TwitterIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const GitHubIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
  </svg>
);

interface ProviderButtonConfig {
  icon: React.ReactNode;
  label: string;
  color: string;
  textColor?: string;
}

const PROVIDER_BUTTONS: Record<string, ProviderButtonConfig> = {
  discord: { icon: <DiscordIcon />, label: 'Discord', color: '#5865F2' },
  twitter: { icon: <TwitterIcon />, label: 'X (Twitter)', color: '#000000' },
  google: { icon: <GoogleIcon />, label: 'Google', color: '#ffffff', textColor: '#333' },
  github: { icon: <GitHubIcon />, label: 'GitHub', color: '#181717' },
};

interface LoginModalProps {
  onClose: () => void;
  onLogin: (provider: string) => Promise<void>;
  isLoading: boolean;
  walletAddress?: Address;
  isWalletConnected: boolean;
  enabledProviders?: string[];
}

export function LoginModal({ 
  onClose, 
  onLogin, 
  isLoading, 
  walletAddress,
  isWalletConnected,
  enabledProviders = ['discord', 'google', 'github', 'twitter'],
}: LoginModalProps) {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [availableProviders, setAvailableProviders] = useState<string[]>(enabledProviders);
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  useEffect(() => {
    fetch(`${AUTH_SERVER}/providers`)
      .then(res => res.json())
      .then(data => {
        const enabled = data.providers
          .filter((p: { enabled: boolean }) => p.enabled)
          .map((p: { id: string }) => p.id)
          .filter((id: string) => id !== 'wallet');
        setAvailableProviders(enabled);
      })
      .catch(() => {});
  }, []);

  const handleLogin = async (provider: string) => {
    setLoadingProvider(provider);
    await onLogin(provider);
    setLoadingProvider(null);
  };

  const primaryProviders = ['discord', 'google', 'github', 'twitter'].filter(p => availableProviders.includes(p));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 relative" onClick={e => e.stopPropagation()}>
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white"
        >
          <X size={20} />
        </button>

        <h2 className="text-xl font-semibold mb-2">Sign In</h2>
        <p className="text-gray-400 text-sm mb-6">Choose a login method</p>

        <div className="space-y-3">
          {primaryProviders.map(provider => {
            const config = PROVIDER_BUTTONS[provider];
            if (!config) return null;
            
            return (
              <button 
                key={provider}
                onClick={() => handleLogin(provider)}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-colors"
                style={{ 
                  background: config.color,
                  color: config.textColor || 'white',
                  border: config.textColor ? '1px solid #ddd' : 'none',
                }}
              >
                {loadingProvider === provider ? <Loader2 size={20} className="animate-spin" /> : config.icon}
                Continue with {config.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 border-t border-gray-600" />
          <span className="text-gray-500 text-sm">or</span>
          <div className="flex-1 border-t border-gray-600" />
        </div>

        <div className="space-y-3">
          {isWalletConnected && walletAddress ? (
            <>
              <button 
                onClick={() => handleLogin('wallet')}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
              >
                {loadingProvider === 'wallet' ? <Loader2 size={20} className="animate-spin" /> : <Wallet size={20} />}
                Sign in with {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </button>
              <button 
                onClick={() => disconnect()}
                className="w-full px-4 py-2 text-gray-400 hover:text-white text-sm"
              >
                Disconnect Wallet
              </button>
            </>
          ) : (
            <div className="text-center space-y-3">
              <p className="text-gray-400 text-sm">Connect a wallet to sign in with Ethereum</p>
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => connect({ connector })}
                  disabled={isPending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                >
                  {isPending ? <Loader2 size={20} className="animate-spin" /> : <Wallet size={20} />}
                  {connector.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="text-gray-500 text-xs text-center mt-6">
          Your session is secured by TEE attestation.
          <br />
          No passwords stored. Self-custodial keys.
        </p>
      </div>
    </div>
  );
}
