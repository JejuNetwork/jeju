import { Shield, Key, CreditCard, CheckCircle } from 'lucide-react';
import type { OAuth3Identity, OAuth3Session } from '../hooks/useOAuth3';

interface IdentityCardProps {
  identity: OAuth3Identity;
  session: OAuth3Session;
  onSign: () => Promise<void>;
  onCredential: () => Promise<void>;
  onDeployAccount: () => Promise<void>;
}

export function IdentityCard({ identity, session, onSign, onCredential, onDeployAccount }: IdentityCardProps) {
  const hasSmartAccount = session.smartAccount !== '0x0000000000000000000000000000000000000000';

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <Shield size={20} className="text-blue-400" />
        <h3 className="text-lg font-semibold">Identity Actions</h3>
      </div>

      {/* Identity Info */}
      <div className="bg-gray-700/30 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3 mb-3">
          {identity.providerAvatar ? (
            <img src={identity.providerAvatar} alt="" className="w-10 h-10 rounded-full" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center">
              <Shield size={20} className="text-gray-400" />
            </div>
          )}
          <div>
            <div className="font-medium">{identity.providerHandle}</div>
            <div className="text-sm text-gray-400 flex items-center gap-2">
              <span className="capitalize">{identity.provider}</span>
              {identity.onChain && (
                <span className="flex items-center gap-1 text-green-400">
                  <CheckCircle size={12} />
                  On-chain
                </span>
              )}
            </div>
          </div>
        </div>

        {identity.jnsName && (
          <div className="text-sm">
            <span className="text-gray-400">JNS: </span>
            <span className="text-blue-400">{identity.jnsName}</span>
          </div>
        )}

        {identity.walletAddress && (
          <div className="text-sm mt-1">
            <span className="text-gray-400">Wallet: </span>
            <span className="font-mono text-xs">{identity.walletAddress.slice(0, 10)}...{identity.walletAddress.slice(-8)}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={onSign}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
        >
          <Key size={16} />
          <span>Sign Message</span>
        </button>

        <button
          onClick={onCredential}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
        >
          <Shield size={16} />
          <span>Issue Credential</span>
        </button>

        <button
          onClick={onDeployAccount}
          disabled={hasSmartAccount}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-colors ${
            hasSmartAccount
              ? 'bg-gray-600 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-500'
          }`}
        >
          <CreditCard size={16} />
          <span>{hasSmartAccount ? 'Account Deployed' : 'Deploy Account'}</span>
        </button>
      </div>

      {/* Attestation Info */}
      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="text-xs text-gray-400">
          <span className="font-medium">Attestation: </span>
          <span className={session.attestation.verified ? 'text-green-400' : 'text-yellow-400'}>
            {session.attestation.provider}
          </span>
          <span className="mx-2">•</span>
          <span>Quote: {session.attestation.quote.slice(0, 16)}...</span>
        </div>
      </div>
    </div>
  );
}
