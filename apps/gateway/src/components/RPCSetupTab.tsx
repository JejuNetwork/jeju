import { useState, useEffect } from 'react';
import { formatEther, parseEther } from 'viem';
import { Server, Key, Zap, Clock, AlertCircle, CheckCircle, Copy, Trash2, RefreshCw, ExternalLink, Shield, Award } from 'lucide-react';
import { useRPCStaking } from '../hooks/useRPCStaking';
import { RPC_GATEWAY_URL } from '../config';

const UNBONDING_DAYS = 7;
const formatUsd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const formatNum = (v: number) => v.toLocaleString('en-US');

const CHAINS = [
  { name: 'Jeju', chainId: 420691 }, { name: 'Jeju Testnet', chainId: 420690, testnet: true },
  { name: 'Ethereum', chainId: 1 }, { name: 'Base', chainId: 8453 }, { name: 'Arbitrum', chainId: 42161 }, { name: 'Optimism', chainId: 10 },
];

export default function RPCSetupTab() {
  const { isConnected, isContractConfigured, loading, error, position, tier, rateLimit, reputationDiscount, jejuBalance, allowance, jejuPrice, stakeUsdValue, tierRequirements, apiKeys, approve, stake, startUnbonding, completeUnstaking, fetchApiKeys, createApiKey, revokeApiKey, refetchPosition } = useRPCStaking();
  const [stakeAmt, setStakeAmt] = useState('');
  const [unstakeAmt, setUnstakeAmt] = useState('');
  const [keyName, setKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (isConnected) fetchApiKeys(); }, [isConnected, fetchApiKeys]);

  const staked = position?.stakedAmount ? formatEther(position.stakedAmount) : '0';
  const unbonding = position?.unbondingAmount ? formatEther(position.unbondingAmount) : '0';
  const unbondEnd = position?.unbondingStartTime ? new Date((Number(position.unbondingStartTime) + UNBONDING_DAYS * 86400) * 1000) : null;
  const canWithdraw = unbondEnd && unbondEnd <= new Date();
  const needsApproval = stakeAmt && parseEther(stakeAmt) > allowance;

  const handleCopy = () => { if (newKey) { navigator.clipboard.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 2000); } };
  const handleCreateKey = async () => { const k = await createApiKey(keyName || 'API Key'); if (k) { setNewKey(k); setKeyName(''); } };
  const handleStake = async () => { if (stakeAmt) { await stake(stakeAmt); setStakeAmt(''); } };
  const handleUnbond = async () => { if (unstakeAmt) { await startUnbonding(unstakeAmt); setUnstakeAmt(''); } };

  if (!isConnected) return (
    <div className="p-6 text-center">
      <Server className="mx-auto h-12 w-12 text-gray-400 mb-4" />
      <h3 className="text-lg font-medium text-gray-900">Connect Wallet</h3>
      <p className="text-gray-500 mt-2">Connect your wallet to manage RPC access</p>
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-semibold">RPC Access</h2><p className="text-sm text-gray-500">Stake JEJU tokens to increase your rate limits</p></div>
        <button onClick={() => { refetchPosition(); fetchApiKeys(); }} className="p-2 rounded-lg hover:bg-gray-100">
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-start gap-3"><AlertCircle className="h-5 w-5 text-red-500" /><p className="text-sm text-red-700">{error}</p></div>}
      {!isContractConfigured && <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 flex items-start gap-3"><AlertCircle className="h-5 w-5 text-yellow-500" /><div><p className="text-sm font-medium text-yellow-800">Staking Contract Not Deployed</p><p className="text-sm text-yellow-700 mt-1">RPC staking not available. Free tier API keys still work.</p></div></div>}

      {/* Current Tier */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="p-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-3"><Zap className="h-8 w-8" /><div><div className="text-sm opacity-80">Current Tier</div><div className="text-2xl font-bold">{tier}</div></div></div>
          <div className="text-right"><div className="text-sm opacity-80">Rate Limit</div><div className="text-2xl font-bold">{rateLimit === 0 ? 'Unlimited' : `${rateLimit}/min`}</div></div>
        </div>
        <div className="p-4 grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-gray-500">Staked:</span><span className="ml-2 font-medium">{staked} JEJU</span></div>
          <div><span className="text-gray-500">USD Value:</span><span className="ml-2 font-medium">{formatUsd(stakeUsdValue)}</span></div>
          <div><span className="text-gray-500">Balance:</span><span className="ml-2 font-medium">{jejuBalance} JEJU</span></div>
          <div><span className="text-gray-500">JEJU Price:</span><span className="ml-2 font-medium">{formatUsd(jejuPrice)}</span></div>
          {reputationDiscount > 0 && <div className="col-span-2 flex items-center gap-2 text-green-600"><Award className="h-4 w-4" /><span>Reputation bonus: {reputationDiscount / 100}% stake multiplier</span></div>}
        </div>
      </div>

      {/* Staking */}
      {isContractConfigured && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
          <h3 className="font-medium flex items-center gap-2"><Shield className="h-5 w-5" />Stake JEJU</h3>
          <div className="grid grid-cols-4 gap-4">
            {Object.entries(tierRequirements).map(([t, c]) => (
              <button key={t} onClick={() => t !== 'FREE' && setStakeAmt(String(c.jejuNeeded))} disabled={t === 'FREE'}
                className={`p-3 rounded-lg border text-center transition-colors ${tier === t ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300 disabled:opacity-50'}`}>
                <div className="font-medium">{t}</div>
                <div className="text-xs text-gray-500">{formatUsd(c.minUsd)}</div>
                <div className="text-xs text-gray-400">{c.jejuNeeded ? `~${formatNum(c.jejuNeeded)} JEJU` : 'Free'}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input type="text" value={stakeAmt} onChange={e => setStakeAmt(e.target.value)} placeholder="Amount" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg" />
            <button onClick={() => needsApproval ? approve(stakeAmt) : handleStake()} disabled={loading || !stakeAmt} className={`px-4 py-2 text-white rounded-lg disabled:opacity-50 ${needsApproval ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {needsApproval ? 'Approve' : 'Stake'}
            </button>
          </div>
          {Number(staked) > 0 && (
            <div className="border-t pt-4 mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Clock className="h-4 w-4" />Unbonding ({UNBONDING_DAYS} day wait)</h4>
              {Number(unbonding) > 0 ? (
                <div className="p-3 bg-yellow-50 rounded-lg">
                  <div className="text-sm"><span className="font-medium">{unbonding} JEJU</span> unbonding</div>
                  {unbondEnd && <div className="text-xs text-gray-500 mt-1">{canWithdraw ? <span className="text-green-600">Ready to withdraw</span> : <>Available: {unbondEnd.toLocaleDateString()}</>}</div>}
                  {canWithdraw && <button onClick={completeUnstaking} disabled={loading} className="mt-2 px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50">Withdraw</button>}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input type="text" value={unstakeAmt} onChange={e => setUnstakeAmt(e.target.value)} placeholder="Amount" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <button onClick={handleUnbond} disabled={loading || !unstakeAmt} className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm">Start Unbonding</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* API Keys */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
        <h3 className="font-medium flex items-center gap-2"><Key className="h-5 w-5" />API Keys</h3>
        {newKey && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div className="flex-1">
              <p className="font-medium text-green-800">API Key Created</p>
              <p className="text-sm text-green-700 mt-1">Copy now - won't be shown again</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="px-2 py-1 bg-green-100 rounded text-sm font-mono flex-1 break-all">{newKey}</code>
                <button onClick={handleCopy} className="p-2 hover:bg-green-200 rounded">{copied ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</button>
              </div>
              <button onClick={() => setNewKey(null)} className="mt-2 text-sm text-green-600 hover:underline">Done</button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <input type="text" value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="Key name (optional)" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <button onClick={handleCreateKey} disabled={loading} className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 text-sm">Generate Key</button>
        </div>
        {apiKeys.length > 0 ? (
          <div className="space-y-2">
            {apiKeys.map(k => (
              <div key={k.id} className={`p-3 border rounded-lg flex items-center justify-between ${k.isActive ? 'border-gray-200' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${k.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{k.isActive ? 'Active' : 'Revoked'}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">{k.tier}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{k.requestCount.toLocaleString()} requests • Created {new Date(k.createdAt).toLocaleDateString()}</div>
                </div>
                {k.isActive && <button onClick={() => confirm('Revoke this key?') && revokeApiKey(k.id)} className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 className="h-4 w-4" /></button>}
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-gray-500 text-center py-4">No API keys yet</p>}
      </div>

      {/* RPC Endpoints */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
        <h3 className="font-medium flex items-center gap-2"><Server className="h-5 w-5" />RPC Endpoints</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          {CHAINS.map(c => (
            <div key={c.chainId} className="p-3 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.name}</span>
                {c.testnet && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">Testnet</span>}
              </div>
              <code className="text-xs text-gray-500 mt-1 block">/v1/rpc/{c.chainId}</code>
            </div>
          ))}
        </div>
        <a href={`${RPC_GATEWAY_URL}/v1/chains`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
          View all chains <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
