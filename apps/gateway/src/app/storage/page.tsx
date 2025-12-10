'use client';

import { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Upload, Folder, DollarSign, Clock, HardDrive } from 'lucide-react';
import { IPFS_API_URL, CONTRACTS } from '../../config';

// Client-side config from centralized config
const FILE_STORAGE_MANAGER_ADDRESS = CONTRACTS.fileStorageManager || '0x0B306BF915C4d645ff596e518fAf3F9669b97016' as const;
const JEJU_IPFS_API = IPFS_API_URL;

const FILE_STORAGE_ABI = [
  {
    name: 'getOwnerFiles',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'files',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'cid', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'cid', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'sizeBytes', type: 'uint256' },
          { name: 'paidAmount', type: 'uint256' },
          { name: 'paymentToken', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'isPinned', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'pinFile',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'cid', type: 'bytes32' },
      { name: 'sizeBytes', type: 'uint256' },
      { name: 'durationMonths', type: 'uint256' },
      { name: 'paymentToken', type: 'address' },
    ],
    outputs: [],
  },
] as const;

export default function StorageManagerPage() {
  const [activeTab, setActiveTab] = useState<'upload' | 'files' | 'funding'>('upload');
  const { address } = useAccount();

  // Query user's files
  const { data: fileCIDs } = useReadContract({
    address: FILE_STORAGE_MANAGER_ADDRESS,
    abi: FILE_STORAGE_ABI,
    functionName: 'getOwnerFiles',
    args: [address!],
    query: { enabled: !!address },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-purple-500 text-white">
        <div className="max-w-7xl mx-auto px-8 py-12">
          <div className="flex items-center gap-3 mb-4">
            <HardDrive size={40} />
            <h1 className="text-4xl font-bold">File Storage Manager</h1>
          </div>
          <p className="text-lg opacity-90">
            Decentralized file storage on Jeju IPFS • Pay with any token • Zero external dependencies
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-8">
          <div className="flex gap-6">
            {[
              { id: 'upload', label: 'Upload Files', icon: Upload },
              { id: 'files', label: 'My Files', icon: Folder, count: fileCIDs?.length },
              { id: 'funding', label: 'Funding & Payments', icon: DollarSign },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as 'upload' | 'files' | 'funding')}
                  className={`py-4 px-2 border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={18} />
                    {tab.label}
                    {tab.count !== undefined && (
                      <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-xs">
                        {tab.count}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {activeTab === 'upload' && <UploadSection />}
        {activeTab === 'files' && <FilesSection fileCIDs={fileCIDs || []} />}
        {activeTab === 'funding' && <FundingSection />}
      </div>
    </div>
  );
}

function UploadSection() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cid, setCID] = useState<string>('');
  const [duration, setDuration] = useState(1);

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${JEJU_IPFS_API}/upload`, {
      method: 'POST',
      headers: {
        'X-Duration-Months': duration.toString(),
      },
      body: formData,
    });

    if (!response.ok) {
      setUploading(false);
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    setCID(result.cid);
    setUploading(false);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm p-8">
        <h2 className="text-2xl font-bold mb-6">Upload to Jeju IPFS</h2>

        {/* File Selection */}
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center mb-6">
          {!file ? (
            <>
              <Upload className="mx-auto text-gray-400 mb-4" size={48} />
              <p className="text-gray-600 mb-4">
                Drag and drop or click to select file
              </p>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="inline-block px-6 py-3 bg-blue-500 text-white rounded-lg cursor-pointer hover:bg-blue-600"
              >
                Choose File
              </label>
            </>
          ) : (
            <div>
              <div className="font-medium text-lg">{file.name}</div>
              <div className="text-sm text-gray-600">
                {(file.size / (1024 ** 2)).toFixed(2)} MB
              </div>
              <button
                onClick={() => setFile(null)}
                className="mt-2 text-sm text-red-500 hover:underline"
              >
                Remove
              </button>
            </div>
          )}
        </div>

        {/* Duration Selection */}
        {file && (
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Storage Duration</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { months: 1, label: '1 Month' },
                { months: 6, label: '6 Months' },
                { months: 12, label: '1 Year' },
              ].map((option) => (
                <button
                  key={option.months}
                  onClick={() => setDuration(option.months)}
                  className={`p-3 border-2 rounded-lg ${
                    duration === option.months
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold">{option.label}</div>
                  <div className="text-sm text-gray-600">
                    ${(file.size / (1024 ** 3) * 0.10 * option.months).toFixed(4)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Upload Button */}
        {file && (
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="w-full py-3 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 disabled:bg-gray-300"
          >
            {uploading ? 'Uploading to Jeju IPFS...' : 'Upload File'}
          </button>
        )}

        {/* Success */}
        {cid && (
          <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="font-semibold text-green-900 mb-2">✓ Uploaded Successfully!</div>
            <div className="text-sm text-green-700 mb-2">CID: {cid}</div>
            <a
              href={`${JEJU_IPFS_API}/ipfs/${cid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline text-sm"
            >
              View File →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function FilesSection({ fileCIDs }: { fileCIDs: readonly `0x${string}`[] }) {
  if (fileCIDs.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg">
        <Folder className="mx-auto text-gray-300 mb-4" size={48} />
        <p className="text-gray-600">No files uploaded yet</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {fileCIDs.map((cidBytes) => (
        <FileCard key={cidBytes} cidBytes={cidBytes} />
      ))}
    </div>
  );
}

function FileCard({ cidBytes }: { cidBytes: `0x${string}` }) {
  const { data: fileData } = useReadContract({
    address: FILE_STORAGE_MANAGER_ADDRESS,
    abi: FILE_STORAGE_ABI,
    functionName: 'files',
    args: [cidBytes],
  });

  if (!fileData) return null;

  const cid = cidBytes; // Convert bytes32 to string for display
  const expiresIn = Number(fileData.expiresAt) * 1000 - Date.now();
  const daysLeft = Math.floor(expiresIn / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="font-mono text-sm text-gray-600 mb-2">{cid.substring(0, 20)}...</div>
          <div className="text-sm text-gray-600">
            {(Number(fileData.sizeBytes) / (1024 ** 2)).toFixed(2)} MB
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1 text-sm">
            <Clock size={14} />
            <span>{daysLeft > 0 ? `${daysLeft} days left` : 'Expired'}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <a
          href={`${JEJU_IPFS_API}/ipfs/${cid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm"
        >
          View File
        </a>
        <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">
          Renew
        </button>
      </div>
    </div>
  );
}

function FundingSection() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-8">
        <h2 className="text-2xl font-bold mb-6">Storage Funding</h2>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
          <div className="text-sm text-blue-700 mb-2">Current Balance</div>
          <div className="text-3xl font-bold text-blue-900">0.00 USDC</div>
          <div className="text-sm text-blue-600 mt-1">≈ 0 GB-months</div>
        </div>

        <div className="space-y-4">
          <button className="w-full py-3 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600">
            Deposit USDC
          </button>
          <button className="w-full py-3 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200">
            Deposit elizaOS
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-8">
        <h3 className="text-lg font-semibold mb-4">Pricing</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Per GB per Month:</span>
            <span className="font-semibold">$0.10 USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Minimum Fee:</span>
            <span className="font-semibold">$0.001 USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Retrieval:</span>
            <span className="font-semibold">Free</span>
          </div>
        </div>
      </div>
    </div>
  );
}

