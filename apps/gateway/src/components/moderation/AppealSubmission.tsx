/**
 * Appeal Submission Component  
 * Appeal an unjust ban with new evidence
 */

'use client';

import { useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract } from 'wagmi';
import { parseEther } from 'viem';
import { Scale, Upload, AlertCircle } from 'lucide-react';
import { MODERATION_CONTRACTS } from '../../config/moderation';

interface AppealSubmissionProps {
  agentId: bigint;
  proposalId: `0x${string}`;
  onSuccess?: () => void;
}

// REAL IPFS upload
import { uploadToIPFS } from '../../../lib/ipfs';

const useIPFSUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File): Promise<string> => {
    setUploading(true);
    setError(null);

    try {
      const hash = await uploadToIPFS(file);
      return hash;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      throw err;
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading, error };
};

const GOVERNANCE_ABI = [
  {
    name: 'submitAppeal',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'proposalId', type: 'bytes32' },
      { name: 'evidence', type: 'string' },
    ],
    outputs: [{ name: 'appealId', type: 'bytes32' }],
  },
  {
    name: 'getProposal',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'bytes32' }],
    outputs: [
      { name: 'proposalType', type: 'uint8' },
      { name: 'targetAgentId', type: 'uint256' },
      { name: 'proposer', type: 'address' },
      { name: 'status', type: 'uint8' },
      { name: 'approvalCount', type: 'uint256' },
      { name: 'votingEnds', type: 'uint256' },
      { name: 'executeAfter', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
  },
] as const;

const APPEAL_BOND = '0.05'; // 0.05 ETH

export default function AppealSubmission({ agentId: _agentId, proposalId, onSuccess }: AppealSubmissionProps) {
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceHash, setEvidenceHash] = useState('');
  const [explanation, setExplanation] = useState('');

  useAccount(); // Track account for connection state
  const { upload: uploadToIPFS, uploading } = useIPFSUpload();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Query proposal details
  const { data: proposal } = useReadContract({
    address: MODERATION_CONTRACTS.RegistryGovernance as `0x${string}`,
    abi: GOVERNANCE_ABI,
    functionName: 'getProposal',
    args: [proposalId],
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setEvidenceFile(file);

    try {
      const hash = await uploadToIPFS(file);
      setEvidenceHash(hash);
    } catch (error) {
      console.error('Evidence upload failed:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!evidenceHash) {
      alert('Please upload evidence first');
      return;
    }

    if (!explanation.trim()) {
      alert('Please provide an explanation');
      return;
    }

    // Submit appeal with evidence hash as string (IPFS CID)
    writeContract({
      address: MODERATION_CONTRACTS.RegistryGovernance as `0x${string}`,
      abi: GOVERNANCE_ABI,
      functionName: 'submitAppeal',
      args: [proposalId, evidenceHash],
      value: parseEther(APPEAL_BOND),
    });
  };

  if (isSuccess) {
    setTimeout(() => onSuccess?.(), 2000);
  }

  // Check if appeal window is still open (7 days after execution)
  // proposal is a tuple: [proposalType, targetAgentId, proposer, status, approvalCount, votingEnds, executeAfter, reason]
  const proposalData = proposal as readonly [number, bigint, `0x${string}`, number, bigint, bigint, bigint, string] | undefined;
  const appealDeadline = proposalData ? Number(proposalData[6]) + 7 * 24 * 3600 : 0;
  const canAppeal = appealDeadline > Math.floor(Date.now() / 1000);

  if (!canAppeal && proposalData) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertCircle className="mx-auto text-red-500 mb-2" size={32} />
        <div className="font-semibold text-red-900 mb-1">Appeal Period Expired</div>
        <div className="text-sm text-red-700">
          Appeals must be submitted within 7 days of ban execution
        </div>
      </div>
    );
  }

  if (!proposalData) {
    return <div className="animate-pulse">Loading proposal...</div>;
  }

  // Destructure proposal tuple: [proposalType, targetAgentId, proposer, status, approvalCount, votingEnds, executeAfter, reason]
  const [, targetAgentId, , status, , , , reason] = proposalData;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <Scale className="text-blue-500 mt-0.5" size={20} />
          <div>
            <div className="font-semibold text-blue-900">Appeal Process</div>
            <div className="text-sm text-blue-700 mt-1">
              Your appeal will be reviewed by Guardians within 48-72 hours. Requires 2/3 guardian approval to overturn
              the ban. Appeal bond: {APPEAL_BOND} ETH (refunded if approved).
            </div>
          </div>
        </div>
      </div>

      {/* Proposal Details */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2">Appealing Proposal #{proposalId}</h3>
        <div className="text-sm text-gray-700 space-y-1">
          <div>
            <span className="text-gray-600">Reason:</span> {reason}
          </div>
          <div>
            <span className="text-gray-600">Status:</span>{' '}
            {['PENDING', 'PASSED', 'EXECUTED', 'REJECTED', 'VETOED', 'APPEALED'][status]}
          </div>
          <div>
            <span className="text-gray-600">Target:</span> Agent #{targetAgentId.toString()}
          </div>
        </div>
      </div>

      {/* New Evidence Upload */}
      <div>
        <label className="block text-sm font-medium mb-2">New Evidence * (IPFS Upload)</label>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
          {!evidenceFile ? (
            <>
              <Upload className="mx-auto text-gray-400 mb-2" size={32} />
              <p className="text-sm text-gray-600 mb-2">Upload evidence proving the ban was unjust</p>
              <input
                type="file"
                onChange={handleFileUpload}
                accept="image/*,video/*,.pdf,.txt"
                className="hidden"
                id="appeal-evidence-upload"
              />
              <label
                htmlFor="appeal-evidence-upload"
                className="inline-block px-4 py-2 bg-blue-500 text-white rounded-lg cursor-pointer hover:bg-blue-600"
              >
                Choose File
              </label>
            </>
          ) : (
            <div className="text-center">
              <div className="font-medium">{evidenceFile.name}</div>
              <div className="text-sm text-gray-600">
                {uploading ? 'Uploading to IPFS...' : `Hash: ${evidenceHash.substring(0, 16)}...`}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Explanation */}
      <div>
        <label className="block text-sm font-medium mb-2">Explanation *</label>
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          placeholder="Explain why the ban was unjust and what new evidence you're providing..."
          rows={5}
          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      {/* Appeal Bond Info */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="font-semibold text-yellow-900 mb-1">Appeal Bond: {APPEAL_BOND} ETH</div>
        <div className="text-sm text-yellow-700">
          This bond will be refunded if your appeal is approved. If rejected, the bond is forfeited.
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isPending || isConfirming || uploading || !evidenceHash}
        className="w-full py-3 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {uploading
          ? 'Uploading Evidence...'
          : isPending
          ? 'Submitting Appeal...'
          : isConfirming
          ? 'Confirming...'
          : isSuccess
          ? '✓ Appeal Submitted!'
          : `Submit Appeal (${APPEAL_BOND} ETH)`}
      </button>

      {isSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <div className="text-green-900 font-semibold">Appeal submitted successfully!</div>
          <div className="text-sm text-green-700 mt-1">
            Guardians will review your appeal within 48-72 hours. You'll be notified of their decision.
          </div>
        </div>
      )}
    </form>
  );
}

