import { Wallet, Rocket, CheckCircle, Loader2, ExternalLink } from 'lucide-react';
import type { Address } from 'viem';

interface SmartAccountCardProps {
  smartAccount: Address | null;
  onDeployAccount: () => Promise<void>;
  isLoading: boolean;
}

export function SmartAccountCard({ smartAccount, onDeployAccount, isLoading }: SmartAccountCardProps) {
  const hasSmartAccount = smartAccount && smartAccount !== '0x0000000000000000000000000000000000000000';

  if (!hasSmartAccount) {
    return (
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
        <div className="flex items-center gap-2 mb-4">
          <Wallet size={20} className="text-blue-400" />
          <h3 className="text-lg font-semibold">Smart Account</h3>
        </div>
        <p className="text-gray-400 mb-4 text-sm">
          Deploy an ERC-4337 smart account for gasless transactions, 
          session keys, and social recovery.
        </p>
        
        <div className="bg-gray-700/30 rounded-lg p-4 mb-4">
          <div className="text-sm font-medium mb-2">Features</div>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>✓ Gasless transactions via paymaster</li>
            <li>✓ Session keys for dApps</li>
            <li>✓ Social recovery support</li>
            <li>✓ Batch transactions</li>
          </ul>
        </div>

        <button 
          onClick={onDeployAccount}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Deploying...
            </>
          ) : (
            <>
              <Rocket size={16} />
              Deploy Smart Account
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <Wallet size={20} className="text-blue-400" />
        <h3 className="text-lg font-semibold">Smart Account</h3>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <CheckCircle size={16} className="text-green-400" />
        <span className="text-green-400 text-sm font-medium">Account Deployed</span>
      </div>

      <div className="bg-gray-700/30 rounded-lg p-4 mb-4">
        <div className="text-xs text-gray-400 mb-1">Contract Address</div>
        <div className="flex items-center gap-2 font-mono text-sm break-all">
          {smartAccount}
          <a 
            href={`https://sepolia.basescan.org/address/${smartAccount}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-700/30 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-400">Type</div>
          <div className="text-sm font-medium">ERC-4337</div>
        </div>
        <div className="bg-gray-700/30 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-400">Status</div>
          <div className="text-sm font-medium text-green-400">Active</div>
        </div>
      </div>
    </div>
  );
}
