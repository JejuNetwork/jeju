/**
 * LoginModal - OAuth3 Authentication UI
 * 
 * Multiple login options:
 * - Wallet connect (MetaMask, WalletConnect)
 * - Social logins (Google, Apple, Twitter, GitHub, Discord)
 * - Farcaster
 * - Generate new wallet (no friction, just works)
 */

import { useState } from 'react';
import { X, Wallet, Chrome, Apple, Twitter, Github, MessageCircle, Sparkles, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth, type AuthProvider } from '../../hooks/useAuth';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const SOCIAL_PROVIDERS = [
  { id: 'google' as AuthProvider, name: 'Google', icon: Chrome, color: 'hover:bg-red-500/10 hover:border-red-500/30' },
  { id: 'apple' as AuthProvider, name: 'Apple', icon: Apple, color: 'hover:bg-gray-500/10 hover:border-gray-400/30' },
  { id: 'twitter' as AuthProvider, name: 'Twitter', icon: Twitter, color: 'hover:bg-blue-500/10 hover:border-blue-500/30' },
  { id: 'github' as AuthProvider, name: 'GitHub', icon: Github, color: 'hover:bg-purple-500/10 hover:border-purple-500/30' },
  { id: 'discord' as AuthProvider, name: 'Discord', icon: MessageCircle, color: 'hover:bg-indigo-500/10 hover:border-indigo-500/30' },
] as const;

export function LoginModal({ isOpen, onClose, onSuccess }: LoginModalProps) {
  const { login, generateWallet, isLoading, error } = useAuth();
  const [activeProvider, setActiveProvider] = useState<AuthProvider | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!isOpen) return null;

  const handleLogin = async (provider: AuthProvider) => {
    setActiveProvider(provider);
    try {
      await login(provider);
      onSuccess?.();
      onClose();
    } catch {
      // Error is set in useAuth
    } finally {
      setActiveProvider(null);
    }
  };

  const handleGenerateWallet = async () => {
    setActiveProvider('wallet');
    try {
      const { address } = await generateWallet();
      console.log('Generated wallet:', address);
      // Auto login with the generated wallet
      await login('wallet');
      onSuccess?.();
      onClose();
    } catch {
      // Error handling
    } finally {
      setActiveProvider(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-card rounded-2xl border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <span className="text-lg font-bold text-white">J</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold">Sign In</h2>
              <p className="text-sm text-muted-foreground">to Jeju Wallet</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Quick Start - Generate Wallet */}
          <button
            onClick={handleGenerateWallet}
            disabled={isLoading}
            className="w-full flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 hover:from-emerald-500/20 hover:to-teal-500/20 transition-all group"
          >
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-emerald-400">Quick Start</p>
              <p className="text-sm text-muted-foreground">Create wallet instantly, no setup needed</p>
            </div>
            {activeProvider === 'wallet' ? (
              <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-emerald-400 transition-colors" />
            )}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or continue with</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Wallet Connect */}
          <button
            onClick={() => handleLogin('wallet')}
            disabled={isLoading}
            className="w-full flex items-center gap-4 p-4 rounded-xl bg-secondary/50 border border-border hover:bg-secondary hover:border-orange-500/30 transition-all group"
          >
            <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-orange-400" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-medium">Connect Wallet</p>
              <p className="text-xs text-muted-foreground">MetaMask, WalletConnect, etc.</p>
            </div>
            {activeProvider === 'wallet' && (
              <Loader2 className="w-5 h-5 animate-spin" />
            )}
          </button>

          {/* Social Logins - 2 column grid */}
          <div className="grid grid-cols-2 gap-3">
            {SOCIAL_PROVIDERS.slice(0, 4).map(({ id, name, icon: Icon, color }) => (
              <button
                key={id}
                onClick={() => handleLogin(id)}
                disabled={isLoading}
                className={`flex items-center gap-3 p-3 rounded-xl bg-secondary/30 border border-border transition-all ${color}`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-sm font-medium">{name}</span>
                {activeProvider === id && (
                  <Loader2 className="w-4 h-4 animate-spin ml-auto" />
                )}
              </button>
            ))}
          </div>

          {/* More Options */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{showAdvanced ? 'Hide' : 'More'} options</span>
            <ChevronRight className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
          </button>

          {/* Advanced Options */}
          {showAdvanced && (
            <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
              {/* Discord */}
              <button
                onClick={() => handleLogin('discord')}
                disabled={isLoading}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-secondary/30 border border-border hover:bg-indigo-500/10 hover:border-indigo-500/30 transition-all"
              >
                <MessageCircle className="w-5 h-5 text-indigo-400" />
                <span className="text-sm font-medium">Discord</span>
                {activeProvider === 'discord' && (
                  <Loader2 className="w-4 h-4 animate-spin ml-auto" />
                )}
              </button>

              {/* Farcaster */}
              <button
                onClick={() => handleLogin('farcaster')}
                disabled={isLoading}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-secondary/30 border border-border hover:bg-purple-500/10 hover:border-purple-500/30 transition-all"
              >
                <div className="w-5 h-5 rounded bg-purple-500 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white">FC</span>
                </div>
                <span className="text-sm font-medium">Farcaster</span>
                {activeProvider === 'farcaster' && (
                  <Loader2 className="w-4 h-4 animate-spin ml-auto" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <p className="text-xs text-center text-muted-foreground">
            By continuing, you agree to Jeju's{' '}
            <a href="/terms" className="text-emerald-400 hover:underline">Terms</a>
            {' '}and{' '}
            <a href="/privacy" className="text-emerald-400 hover:underline">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginModal;

