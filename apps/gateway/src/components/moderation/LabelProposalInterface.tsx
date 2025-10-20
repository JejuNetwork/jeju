/**
 * Label Proposal Interface
 * Propose reputation labels (HACKER/SCAMMER/TRUSTED) via futarchy
 */

'use client';

import { useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { Tag, Upload, Award, AlertTriangle, Shield, Zap } from 'lucide-react';
import { MODERATION_CONTRACTS } from '../../config/moderation';

interface LabelProposalInterfaceProps {
  targetAgentId?: bigint;
  onSuccess?: () => void;
}

type LabelType = 0 | 1 | 2 | 3 | 4; // NONE, HACKER, SCAMMER, SPAM_BOT, TRUSTED

const LABEL_TYPES = [
  {
    value: 1,
    name: 'HACKER',
    stake: '0.1',
    description: 'Proven exploit/hack - auto-triggers network ban',
    icon: Zap,
    color: 'red',
    severity: 'CRITICAL',
  },
  {
    value: 2,
    name: 'SCAMMER',
    stake: '0.05',
    description: 'Fraudulent behavior - warning label only',
    icon: AlertTriangle,
    color: 'orange',
    severity: 'HIGH',
  },
  {
    value: 3,
    name: 'SPAM_BOT',
    stake: '0.01',
    description: 'Automated spam - eligible for app-level bans',
    icon: Tag,
    color: 'yellow',
    severity: 'MEDIUM',
  },
  {
    value: 4,
    name: 'TRUSTED',
    stake: '0.5',
    description: 'Vouching for good standing - positive reputation',
    icon: Award,
    color: 'green',
    severity: 'POSITIVE',
  },
] as const;

// REAL IPFS upload
import { uploadToIPFS } from '../../../lib/ipfs';

const useIPFSUpload = () => {
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File): Promise<string> => {
    setUploading(true);
    try {
      const hash = await uploadToIPFS(file);
      return hash;
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading };
};

const LABEL_MANAGER_ABI = [
  {
    name: 'proposeLabel',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'targetAgentId', type: 'uint256' },
      { name: 'label', type: 'uint8' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'proposalId', type: 'bytes32' }],
  },
] as const;

export default function LabelProposalInterface({ targetAgentId, onSuccess }: LabelProposalInterfaceProps) {
  const [formData, setFormData] = useState({
    targetAgentId: targetAgentId?.toString() || '',
    selectedLabel: null as LabelType | null,
  });
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceHash, setEvidenceHash] = useState('');

  const { upload: uploadToIPFS, uploading } = useIPFSUpload();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setEvidenceFile(file);
    try {
      const hash = await uploadToIPFS(file);
      setEvidenceHash(hash);
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.targetAgentId || !formData.selectedLabel) {
      alert('Please fill all fields');
      return;
    }

    if (!evidenceHash) {
      alert('Please upload evidence');
      return;
    }

    const selectedLabelInfo = LABEL_TYPES.find((l) => l.value === formData.selectedLabel);
    if (!selectedLabelInfo) return;

    // Convert evidence hash to bytes32
    const evidenceBytes32 = `0x${evidenceHash.padStart(64, '0')}` as `0x${string}`;

    writeContract({
      address: MODERATION_CONTRACTS.ReputationLabelManager as `0x${string}`,
      abi: LABEL_MANAGER_ABI,
      functionName: 'proposeLabel',
      args: [BigInt(formData.targetAgentId), formData.selectedLabel, evidenceBytes32],
      value: parseEther(selectedLabelInfo.stake),
    });
  };

  if (isSuccess) {
    setTimeout(() => onSuccess?.(), 2000);
  }

  const selectedLabelInfo = LABEL_TYPES.find((l) => l.value === formData.selectedLabel);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Target Agent */}
      <div>
        <label className="block text-sm font-medium mb-2">Target Agent ID *</label>
        <input
          type="number"
          value={formData.targetAgentId}
          onChange={(e) => setFormData({ ...formData, targetAgentId: e.target.value })}
          placeholder="Enter agent ID"
          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      {/* Label Selection */}
      <div>
        <label className="block text-sm font-medium mb-2">Reputation Label *</label>
        <div className="grid gap-3">
          {LABEL_TYPES.map((label) => {
            const Icon = label.icon;
            const isSelected = formData.selectedLabel === label.value;

            return (
              <button
                key={label.value}
                type="button"
                onClick={() => setFormData({ ...formData, selectedLabel: label.value })}
                className={`p-4 border-2 rounded-lg text-left transition-all ${
                  isSelected
                    ? `border-${label.color}-500 bg-${label.color}-50`
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon size={20} className={`text-${label.color}-500`} />
                    <span className="font-semibold">{label.name}</span>
                  </div>
                  <span className={`px-2 py-1 bg-${label.color}-100 text-${label.color}-700 rounded text-xs font-semibold`}>
                    {label.severity}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-2">{label.description}</p>
                <div className="text-lg font-bold text-gray-900">Stake: {label.stake} ETH</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Evidence Upload */}
      <div>
        <label className="block text-sm font-medium mb-2">Evidence * (IPFS Upload)</label>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
          {!evidenceFile ? (
            <>
              <Upload className="mx-auto text-gray-400 mb-2" size={32} />
              <p className="text-sm text-gray-600 mb-2">
                Upload proof supporting this label
              </p>
              <input
                type="file"
                onChange={handleFileUpload}
                accept="image/*,video/*,.pdf"
                className="hidden"
                id="label-evidence-upload"
              />
              <label
                htmlFor="label-evidence-upload"
                className="inline-block px-4 py-2 bg-blue-500 text-white rounded-lg cursor-pointer hover:bg-blue-600"
              >
                Choose File
              </label>
            </>
          ) : (
            <div className="text-center">
              <div className="font-medium">{evidenceFile.name}</div>
              <div className="text-sm text-gray-600">
                {uploading ? 'Uploading...' : `Hash: ${evidenceHash.substring(0, 16)}...`}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stake Info */}
      {selectedLabelInfo && (
        <div className={`bg-${selectedLabelInfo.color}-50 border border-${selectedLabelInfo.color}-200 rounded-lg p-4`}>
          <div className="flex items-start gap-2">
            <Shield className={`text-${selectedLabelInfo.color}-500 mt-0.5`} size={20} />
            <div className="flex-1">
              <div className={`font-semibold text-${selectedLabelInfo.color}-900 mb-1`}>
                Stake Required: {selectedLabelInfo.stake} ETH
              </div>
              <div className={`text-sm text-${selectedLabelInfo.color}-700`}>
                {selectedLabelInfo.value === 1 && '⚠️ HACKER label auto-triggers network ban if approved'}
                {selectedLabelInfo.value === 4 && '✓ TRUSTED label boosts reputation if approved'}
                {(selectedLabelInfo.value === 2 || selectedLabelInfo.value === 3) &&
                  'If approved: get stake back + 10% bonus. If rejected: stake slashed.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending || isConfirming || uploading || !evidenceHash || !formData.selectedLabel}
        className="w-full py-3 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {uploading
          ? 'Uploading Evidence...'
          : isPending
          ? 'Proposing Label...'
          : isConfirming
          ? 'Confirming...'
          : isSuccess
          ? '✓ Proposal Submitted!'
          : 'Propose Label'}
      </button>

      {isSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <div className="text-green-900 font-semibold">Label proposal submitted!</div>
          <div className="text-sm text-green-700 mt-1">
            A futarchy market has been created. The community will vote on your proposal.
          </div>
        </div>
      )}
    </form>
  );
}

