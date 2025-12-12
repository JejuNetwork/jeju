import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { Github, Shield, CheckCircle, AlertCircle, RefreshCw, ExternalLink, Award } from 'lucide-react';
import { useGitHubReputation, useAgentReputation } from '../hooks/useGitHubReputation';

interface GitHubReputationPanelProps {
  agentId?: bigint;
  registryAddress?: string;
  onReputationUpdate?: () => void;
  /** GitHub OAuth token for authenticated API calls */
  githubToken?: string;
}

export default function GitHubReputationPanel({
  agentId,
  registryAddress,
  onReputationUpdate,
  githubToken,
}: GitHubReputationPanelProps) {
  const { address, isConnected } = useAccount();
  const [username, setUsername] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);

  const {
    loading,
    error,
    leaderboardData,
    onChainReputation,
    txReceipt,
    fetchLeaderboardReputation,
    verifyWallet,
    requestAttestation,
    submitAttestationOnChain,
    linkAgentToGitHub,
  } = useGitHubReputation();

  const { reputation: agentReputationData, isConfigured: isContractConfigured } = useAgentReputation(agentId);

  // Fetch reputation on mount
  useEffect(() => {
    if (isConnected && address) {
      fetchLeaderboardReputation();
    }
  }, [isConnected, address, fetchLeaderboardReputation]);

  // Notify parent when tx completes
  useEffect(() => {
    if (txReceipt && onReputationUpdate) {
      onReputationUpdate();
    }
  }, [txReceipt, onReputationUpdate]);

  const handleVerifyWallet = async () => {
    if (!username.trim() || !githubToken) return;
    const success = await verifyWallet(username, githubToken);
    if (success) {
      await fetchLeaderboardReputation();
      setShowLinkForm(false);
    }
  };

  const handleRequestAttestation = async () => {
    if (!leaderboardData?.username || !githubToken) return;
    await requestAttestation(leaderboardData.username, githubToken, agentId ? Number(agentId) : undefined);
  };

  const handleSubmitOnChain = async () => {
    if (!leaderboardData?.attestation || !agentId || !githubToken) return;

    const rep = leaderboardData.reputation;
    const attestation = leaderboardData.attestation;

    if (!attestation.signature) {
      return; // Button should be disabled anyway
    }

    await submitAttestationOnChain(
      agentId,
      attestation.normalizedScore,
      Math.floor(rep.totalScore),
      rep.mergedPrCount,
      rep.totalCommits,
      Math.floor(new Date(attestation.calculatedAt).getTime() / 1000),
      attestation.signature,
      attestation.hash,
      githubToken
    );
  };

  const handleLinkAgent = async () => {
    if (!leaderboardData?.username || !agentId || !registryAddress || !githubToken) return;
    const success = await linkAgentToGitHub(
      leaderboardData.username,
      Number(agentId),
      registryAddress,
      githubToken
    );
    if (success) {
      await fetchLeaderboardReputation();
    }
  };

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center gap-2 text-gray-500">
          <Github size={20} />
          <span>Connect wallet to view GitHub reputation</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Github size={24} className="text-gray-700" />
          <h3 className="text-lg font-semibold">GitHub Reputation</h3>
        </div>
        <button
          onClick={() => fetchLeaderboardReputation()}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
          <AlertCircle size={18} className="text-red-500 mt-0.5" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}

      {/* Not linked state */}
      {!leaderboardData && !loading && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
          <p className="text-gray-600">
            Link your GitHub account to receive reputation benefits:
          </p>
          <ul className="text-sm text-gray-500 space-y-1 ml-4">
            <li>• Reduced staking requirements for moderation</li>
            <li>• Reputation boost for your ERC-8004 agent</li>
            <li>• Verified developer badge</li>
          </ul>

          {showLinkForm ? (
            <div className="space-y-3">
              <input
                type="text"
                placeholder="GitHub username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleVerifyWallet}
                  disabled={loading || !username.trim() || !githubToken}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Shield size={16} />
                  )}
                  Verify & Link
                </button>
                <button
                  onClick={() => setShowLinkForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-gray-500">
                You'll need to sign a message to verify wallet ownership
              </p>
            </div>
          ) : (
            <button
              onClick={() => setShowLinkForm(true)}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 flex items-center gap-2"
            >
              <Github size={18} />
              Link GitHub Account
            </button>
          )}
        </div>
      )}

      {/* Linked profile */}
      {leaderboardData && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          {/* Profile header */}
          <div className="p-4 bg-gradient-to-r from-gray-900 to-gray-700 text-white">
            <div className="flex items-center gap-3">
              {leaderboardData.avatarUrl && (
                <img
                  src={leaderboardData.avatarUrl}
                  alt={leaderboardData.username}
                  className="w-12 h-12 rounded-full border-2 border-white"
                />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{leaderboardData.username}</span>
                  {leaderboardData.wallet?.isVerified && (
                    <CheckCircle size={16} className="text-green-400" />
                  )}
                </div>
                <a
                  href={`https://github.com/${leaderboardData.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gray-300 hover:text-white flex items-center gap-1"
                >
                  View on GitHub <ExternalLink size={12} />
                </a>
              </div>
            </div>
          </div>

          {/* Reputation scores */}
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {leaderboardData.reputation.normalizedScore}
                </div>
                <div className="text-xs text-gray-500">Score (0-100)</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {leaderboardData.reputation.mergedPrCount}
                </div>
                <div className="text-xs text-gray-500">Merged PRs</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">
                  {leaderboardData.reputation.totalCommits}
                </div>
                <div className="text-xs text-gray-500">Commits</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">
                  {Math.round(leaderboardData.reputation.totalScore)}
                </div>
                <div className="text-xs text-gray-500">Total XP</div>
              </div>
            </div>

            {/* On-chain status */}
            {Boolean(isContractConfigured && onChainReputation) && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">On-Chain Status</h4>
                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Award size={18} className="text-green-600" />
                    <span className="text-sm">
                      {onChainReputation?.hasBoost
                        ? `Reputation Boost Active (${onChainReputation?.stakeDiscount ?? 0}% stake discount)`
                        : 'No active boost'}
                    </span>
                  </div>
                  <span className="text-lg font-bold text-green-600">
                    {onChainReputation?.score ?? 0}/100
                  </span>
                </div>
              </div>
            )}

            {/* Contract not configured warning */}
            {Boolean(!isContractConfigured && agentId) && (
              <div className="border-t pt-4">
                <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                  <div className="flex items-center gap-2 text-yellow-700 text-sm">
                    <AlertCircle size={16} />
                    <span>On-chain reputation not available (contract not deployed)</span>
                  </div>
                </div>
              </div>
            )}

            {/* Agent-specific reputation */}
            {Boolean(agentId && isContractConfigured && agentReputationData) && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  Agent #{agentId?.toString() ?? '?'} Reputation
                </h4>
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <span className="text-sm">
                    {agentReputationData?.isValid ? 'Verified' : 'Not verified'}
                  </span>
                  <span className="text-lg font-bold text-blue-600">
                    {agentReputationData?.score ?? 0}/100
                  </span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="border-t pt-4 space-y-2">
              {!leaderboardData.attestation && (
                <button
                  onClick={handleRequestAttestation}
                  disabled={loading || !githubToken}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Shield size={16} />
                  )}
                  Request Attestation
                </button>
              )}

              {leaderboardData.attestation && !leaderboardData.attestation.txHash && agentId && isContractConfigured && (
                <button
                  onClick={handleSubmitOnChain}
                  disabled={loading || !leaderboardData.attestation.signature || !githubToken}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <CheckCircle size={16} />
                  )}
                  Submit On-Chain
                </button>
              )}

              {agentId && registryAddress && !leaderboardData.attestation?.agentId && (
                <button
                  onClick={handleLinkAgent}
                  disabled={loading}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2"
                >
                  Link to Agent #{agentId.toString()}
                </button>
              )}
            </div>

            {/* Attestation details */}
            {leaderboardData.attestation && (
              <div className="border-t pt-4 text-xs text-gray-500 space-y-1">
                <div className="flex justify-between">
                  <span>Attestation Hash:</span>
                  <span className="font-mono">
                    {leaderboardData.attestation.hash.slice(0, 10)}...
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Calculated:</span>
                  <span>
                    {new Date(leaderboardData.attestation.calculatedAt).toLocaleDateString()}
                  </span>
                </div>
                {leaderboardData.attestation.txHash && (
                  <div className="flex justify-between">
                    <span>TX:</span>
                    <a
                      href={`https://basescan.org/tx/${leaderboardData.attestation.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline"
                    >
                      {leaderboardData.attestation.txHash.slice(0, 10)}...
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !leaderboardData && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 flex items-center justify-center">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
        </div>
      )}
    </div>
  );
}
