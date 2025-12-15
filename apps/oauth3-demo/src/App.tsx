import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useOAuth3 } from './hooks/useOAuth3';
import { ProviderGrid, IdentityCard } from './components';

function ConnectionStatus({ serverHealth, banStatus, networkInfo, onRefreshNetwork }: {
  serverHealth: ReturnType<typeof useOAuth3>['serverHealth'];
  banStatus: ReturnType<typeof useOAuth3>['banStatus'];
  networkInfo: ReturnType<typeof useOAuth3>['networkInfo'];
  onRefreshNetwork: () => void;
}) {
  if (!serverHealth) return null;

  const contracts = serverHealth.contracts;

  return (
    <div className="mb-6 space-y-3">
      {/* Decentralization Status */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-300">Jeju Network Integration</h3>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${serverHealth.mode === 'dstack-tee' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
            {serverHealth.mode === 'dstack-tee' ? '🔒 TEE Active' : '⚠️ Simulated'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className={`p-2 rounded ${contracts.identityRegistry ? 'bg-green-500/10 border-green-500/30' : 'bg-gray-700/50 border-gray-600'} border`}>
            <div className="font-medium">{contracts.identityRegistry ? '✓' : '○'} Identity</div>
            <div className="text-gray-400">On-chain registry</div>
          </div>
          <div className={`p-2 rounded ${contracts.jnsRegistry ? 'bg-green-500/10 border-green-500/30' : 'bg-gray-700/50 border-gray-600'} border`}>
            <div className="font-medium">{contracts.jnsRegistry ? '✓' : '○'} JNS</div>
            <div className="text-gray-400">.jeju names</div>
          </div>
          <div className={`p-2 rounded ${contracts.storageRegistry ? 'bg-green-500/10 border-green-500/30' : 'bg-gray-700/50 border-gray-600'} border`}>
            <div className="font-medium">{contracts.storageRegistry ? '✓' : '○'} Storage</div>
            <div className="text-gray-400">{serverHealth.network.storageProviders} providers</div>
          </div>
          <div className={`p-2 rounded ${contracts.computeRegistry ? 'bg-green-500/10 border-green-500/30' : 'bg-gray-700/50 border-gray-600'} border`}>
            <div className="font-medium">{contracts.computeRegistry ? '✓' : '○'} Compute</div>
            <div className="text-gray-400">{serverHealth.network.computeProviders} providers</div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
          <span>Node: {serverHealth.nodeAddress.slice(0, 10)}... | Chain: {serverHealth.chainId}</span>
          <button onClick={onRefreshNetwork} className="text-blue-400 hover:text-blue-300">Refresh</button>
        </div>
      </div>

      {/* Ban Warning */}
      {banStatus?.banned && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-400">
            <span className="text-lg">🚫</span>
            <div>
              <div className="font-medium">Account Banned</div>
              <div className="text-sm text-red-300">{banStatus.reason || 'This account has been banned by the moderation system.'}</div>
            </div>
          </div>
        </div>
      )}
      {banStatus?.onNotice && !banStatus.banned && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 text-yellow-400">
            <span className="text-lg">⚠️</span>
            <div>
              <div className="font-medium">Account Under Review</div>
              <div className="text-sm text-yellow-300">{banStatus.reason || 'This account is currently under moderation review.'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Network Info */}
      {networkInfo && (networkInfo.storage.length > 0 || networkInfo.compute.length > 0) && (
        <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/50">
          <div className="text-xs font-medium text-gray-400 mb-2">Active Network Providers</div>
          <div className="flex flex-wrap gap-2">
            {networkInfo.storage.map((p, i) => (
              <span key={`storage-${i}`} className="px-2 py-1 rounded bg-blue-500/10 text-blue-400 text-xs">{p.name}</span>
            ))}
            {networkInfo.compute.map((p, i) => (
              <span key={`compute-${i}`} className="px-2 py-1 rounded bg-purple-500/10 text-purple-400 text-xs">{p.name}</span>
            ))}
            {networkInfo.teeNodes > 0 && (
              <span className="px-2 py-1 rounded bg-green-500/10 text-green-400 text-xs">{networkInfo.teeNodes} TEE Nodes</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const {
    session, identity, isLoading, error,
    serverHealth, banStatus, networkInfo, onChainIdentity,
    login, loginWithWallet, logout,
    refreshNetwork,
    signMessage, requestCredential, deploySmartAccount,
  } = useOAuth3();

  const enabledProviders = serverHealth?.enabledProviders || ['wallet'];

  // Handle OAuth provider selection
  const handleProviderSelect = async (provider: string) => {
    if (provider === 'wallet') {
      await loginWithWallet();
    } else {
      await login(provider);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent">
            OAuth3 Demo
          </h1>
          <p className="text-gray-400 mt-2">Fully Decentralized Authentication on Jeju Network</p>
        </div>

        {/* Network Status */}
        <ConnectionStatus 
          serverHealth={serverHealth} 
          banStatus={banStatus} 
          networkInfo={networkInfo}
          onRefreshNetwork={refreshNetwork}
        />

        {/* Error Display */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
            {error}
          </div>
        )}

        {/* Main Content */}
        {!isConnected ? (
          <div className="bg-gray-800/50 rounded-xl p-8 text-center border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4">Connect Your Wallet</h2>
            <p className="text-gray-400 mb-6">Connect your wallet to get started with decentralized authentication.</p>
            <div className="flex flex-wrap gap-3 justify-center">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => connect({ connector })}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
                >
                  {connector.name}
                </button>
              ))}
            </div>
          </div>
        ) : !session ? (
          <div className="space-y-6">
            {/* Wallet Connected State */}
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm text-gray-400">Connected Wallet</div>
                  <div className="font-mono">{address?.slice(0, 10)}...{address?.slice(-8)}</div>
                  {onChainIdentity?.jnsName && (
                    <div className="text-blue-400 text-sm">{onChainIdentity.jnsName}</div>
                  )}
                </div>
                <button
                  onClick={() => disconnect()}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
                >
                  Disconnect
                </button>
              </div>

              {/* On-chain Identity Status */}
              {onChainIdentity?.exists && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-4">
                  <div className="flex items-center gap-2 text-green-400 text-sm">
                    <span>✓</span>
                    <span>On-chain identity found with {onChainIdentity.providers?.length || 0} linked providers</span>
                  </div>
                </div>
              )}
            </div>

            {/* Provider Selection */}
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
              <h3 className="text-xl font-semibold mb-4">Choose Authentication Method</h3>
              <ProviderGrid
                onSelect={handleProviderSelect}
                isLoading={isLoading}
                enabledProviders={enabledProviders}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Authenticated State */}
            <div className="flex items-center justify-between bg-gray-800/50 rounded-xl p-4 border border-gray-700">
              <div className="flex items-center gap-4">
                {identity?.providerAvatar && (
                  <img src={identity.providerAvatar} alt="" className="w-12 h-12 rounded-full" />
                )}
                <div>
                  <div className="font-semibold">{identity?.providerHandle}</div>
                  <div className="text-sm text-gray-400 flex items-center gap-2">
                    <span>via {identity?.provider}</span>
                    {identity?.jnsName && <span className="text-blue-400">• {identity.jnsName}</span>}
                    {identity?.onChain && <span className="text-green-400">• On-chain</span>}
                  </div>
                </div>
              </div>
              <button
                onClick={logout}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm transition-colors"
              >
                Logout
              </button>
            </div>

            {/* Identity Card */}
            {identity && session && (
              <IdentityCard
                identity={identity}
                session={session}
                onSign={async () => {
                  const sig = await signMessage('Hello from OAuth3!');
                  alert(`Signed: ${sig?.slice(0, 20)}...`);
                }}
                onCredential={async () => {
                  const cred = await requestCredential();
                  console.log('Credential:', cred);
                  alert('Credential issued! Check console.');
                }}
                onDeployAccount={async () => {
                  const account = await deploySmartAccount();
                  if (account) alert(`Smart Account: ${account}`);
                  else alert('Deployment pending or not available');
                }}
              />
            )}

            {/* Session Details */}
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-semibold mb-4">Session Details</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Session ID</span>
                  <span className="font-mono text-xs">{session?.sessionId.slice(0, 20)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Identity ID</span>
                  <span className="font-mono text-xs">{session?.identityId.slice(0, 20)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Smart Account</span>
                  <span className="font-mono text-xs">
                    {session?.smartAccount === '0x0000000000000000000000000000000000000000'
                      ? 'Not deployed'
                      : `${session?.smartAccount.slice(0, 10)}...`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Attestation</span>
                  <span className={session?.attestation.verified ? 'text-green-400' : 'text-yellow-400'}>
                    {session?.attestation.provider} ({session?.attestation.verified ? 'verified' : 'simulated'})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Expires</span>
                  <span>{session?.expiresAt ? new Date(session.expiresAt).toLocaleString() : '-'}</span>
                </div>
              </div>
            </div>

            {/* Capabilities */}
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-semibold mb-4">Capabilities</h3>
              <div className="flex flex-wrap gap-2">
                {session?.capabilities.map((cap) => (
                  <span key={cap} className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-gray-500 text-sm">
          <p>Powered by Jeju Network</p>
          <div className="flex justify-center gap-4 mt-2">
            <span>JNS</span>
            <span>•</span>
            <span>Storage</span>
            <span>•</span>
            <span>Compute</span>
            <span>•</span>
            <span>TEE</span>
            <span>•</span>
            <span>Smart Accounts</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
