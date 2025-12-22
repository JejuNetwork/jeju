
import {
  AlertTriangle,
  FileText,
  Image,
  type LucideProps,
  Upload,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { parseEther } from 'viem'
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import {
  MODERATION_CONFIG,
  MODERATION_CONTRACTS,
} from '../../config/moderation'

const UploadIcon = Upload as ComponentType<LucideProps>
const AlertTriangleIcon = AlertTriangle as ComponentType<LucideProps>
const FileTextIcon = FileText as ComponentType<LucideProps>
const ImageIcon = Image as ComponentType<LucideProps>

import { uploadToIPFS } from '../../lib/ipfs'

const useIPFSUpload = () => {
  const [uploading, setUploading] = useState(false)

  const upload = async (file: File): Promise<string> => {
    setUploading(true)
    const hash = await uploadToIPFS(file)
    setUploading(false)
    return hash
  }

  return { upload, uploading }
}

interface ReportSubmissionFormProps {
  targetAgentId?: bigint
  sourceAppId?: string
  onSuccess?: () => void
}

type ReportType = 0 | 1 | 2 | 3 // NETWORK_BAN, APP_BAN, LABEL_HACKER, LABEL_SCAMMER
type ReportSeverity = 0 | 1 | 2 | 3 // LOW, MEDIUM, HIGH, CRITICAL

const REPORT_TYPES = [
  { value: 0, label: 'Network Ban', description: 'Ban from entire network' },
  { value: 1, label: 'App Ban', description: 'Ban from specific app only' },
  {
    value: 2,
    label: 'Hacker Label',
    description: 'Apply HACKER label (auto network ban)',
  },
  {
    value: 3,
    label: 'Scammer Label',
    description: 'Apply SCAMMER warning label',
  },
] as const

const SEVERITY_LEVELS = [
  { value: 0, label: 'Low', days: 7, bond: '0.001 ETH', warning: undefined },
  { value: 1, label: 'Medium', days: 3, bond: '0.01 ETH', warning: undefined },
  { value: 2, label: 'High', days: 1, bond: '0.05 ETH', warning: undefined },
  {
    value: 3,
    label: 'Critical',
    days: 1,
    bond: '0.1 ETH',
    warning: 'Immediate temp ban',
  },
] as const

const APP_IDS = [
  { value: 'hyperscape', label: 'Hyperscape' },
  { value: 'bazaar', label: 'Bazaar' },
  { value: 'predimarket', label: 'Predimarket' },
  { value: 'gateway', label: 'Gateway' },
] as const

export default function ReportSubmissionForm({
  targetAgentId,
  sourceAppId = 'gateway',
  onSuccess,
}: ReportSubmissionFormProps) {
  const [formData, setFormData] = useState({
    targetAgentId: targetAgentId?.toString() || '',
    reportType: 0 as ReportType,
    severity: 1 as ReportSeverity,
    sourceAppId: sourceAppId,
    details: '',
  })

  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [evidenceHash, setEvidenceHash] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const { upload: uploadToIPFS, uploading: uploadingEvidence } = useIPFSUpload()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setEvidenceFile(file)
    const hash = await uploadToIPFS(file)
    setEvidenceHash(hash)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.targetAgentId) {
      setError('Target Agent ID is required')
      return
    }

    if (!evidenceHash) {
      setError('Please upload evidence first')
      return
    }

    // Get bond amount based on severity
    const bondAmount = Object.values(MODERATION_CONFIG.reportBonds)[
      formData.severity
    ]

    // Convert app ID to bytes32 (keccak256)
    const appIdBytes32 =
      `0x${Buffer.from(formData.sourceAppId).toString('hex').padStart(64, '0')}` as `0x${string}`

    // Convert evidence hash to bytes32
    const evidenceBytes32 =
      `0x${evidenceHash.padStart(64, '0')}` as `0x${string}`

    writeContract({
      address: MODERATION_CONTRACTS.ReportingSystem as `0x${string}`,
      abi: [
        {
          name: 'submitReport',
          type: 'function',
          stateMutability: 'payable',
          inputs: [
            { name: 'targetAgentId', type: 'uint256' },
            { name: 'reportType', type: 'uint8' },
            { name: 'severity', type: 'uint8' },
            { name: 'sourceAppId', type: 'bytes32' },
            { name: 'evidenceHash', type: 'bytes32' },
            { name: 'details', type: 'string' },
          ],
          outputs: [
            { name: 'reportId', type: 'uint256' },
            { name: 'marketId', type: 'bytes32' },
          ],
        },
      ],
      functionName: 'submitReport',
      args: [
        BigInt(formData.targetAgentId),
        formData.reportType,
        formData.severity,
        appIdBytes32,
        evidenceBytes32,
        formData.details,
      ],
      value: parseEther(bondAmount),
    })
  }

  if (isSuccess) {
    setTimeout(() => onSuccess?.(), 2000)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Target Agent ID */}
      <div>
        <label
          htmlFor="target-agent-id"
          className="block text-sm font-medium mb-2"
        >
          Target Agent ID *
        </label>
        <input
          id="target-agent-id"
          type="number"
          value={formData.targetAgentId}
          onChange={(e) =>
            setFormData({ ...formData, targetAgentId: e.target.value })
          }
          placeholder="Enter agent ID to report"
          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      {/* Report Type */}
      <div>
        <span className="block text-sm font-medium mb-2">Report Type *</span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {REPORT_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() =>
                setFormData({ ...formData, reportType: type.value })
              }
              className={`p-4 border-2 rounded-lg text-left transition-all ${
                formData.reportType === type.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="font-semibold">{type.label}</div>
              <div className="text-sm text-gray-600 mt-1">
                {type.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* App ID (for APP_BAN type) */}
      {formData.reportType === 1 && (
        <div>
          <label
            htmlFor="source-app"
            className="block text-sm font-medium mb-2"
          >
            Source App *
          </label>
          <select
            id="source-app"
            value={formData.sourceAppId}
            onChange={(e) =>
              setFormData({ ...formData, sourceAppId: e.target.value })
            }
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            {APP_IDS.map((app) => (
              <option key={app.value} value={app.value}>
                {app.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Severity */}
      <div>
        <span className="block text-sm font-medium mb-2">Severity *</span>
        <div className="space-y-2">
          {SEVERITY_LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              onClick={() =>
                setFormData({ ...formData, severity: level.value })
              }
              className={`w-full p-3 border-2 rounded-lg text-left transition-all flex items-center justify-between ${
                formData.severity === level.value
                  ? 'border-red-500 bg-red-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div>
                <div className="font-semibold">{level.label}</div>
                <div className="text-sm text-gray-600">
                  {level.days} day vote • Bond: {level.bond}
                  {level.warning && ` • ${level.warning}`}
                </div>
              </div>
              {level.value === 3 && (
                <AlertTriangleIcon className="text-red-500" size={20} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Evidence Upload */}
      <div>
        <span className="block text-sm font-medium mb-2">
          Evidence * (IPFS Upload)
        </span>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
          {!evidenceFile ? (
            <>
              <UploadIcon className="mx-auto text-gray-400 mb-2" size={32} />
              <p className="text-sm text-gray-600 mb-2">
                Upload screenshots, videos, or documents
              </p>
              <input
                type="file"
                onChange={handleFileUpload}
                accept="image/*,video/*,.pdf,.txt"
                className="hidden"
                id="evidence-upload"
              />
              <label
                htmlFor="evidence-upload"
                className="inline-block px-4 py-2 bg-blue-500 text-white rounded-lg cursor-pointer hover:bg-blue-600"
              >
                Choose File
              </label>
            </>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <ImageIcon className="text-green-500" size={24} />
              <div className="text-left">
                <div className="font-medium">{evidenceFile.name}</div>
                <div className="text-sm text-gray-600">
                  {uploadingEvidence
                    ? 'Uploading to IPFS...'
                    : `Hash: ${evidenceHash.substring(0, 16)}...`}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Details */}
      <div>
        <label
          htmlFor="report-details"
          className="block text-sm font-medium mb-2"
        >
          Additional Details *
        </label>
        <textarea
          id="report-details"
          value={formData.details}
          onChange={(e) =>
            setFormData({ ...formData, details: e.target.value })
          }
          placeholder="Describe the violation in detail..."
          rows={4}
          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      {/* Bond Display */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <FileTextIcon className="text-blue-500 mt-0.5" size={20} />
          <div className="flex-1">
            <div className="font-semibold text-blue-900">
              Report Bond Required
            </div>
            <div className="text-sm text-blue-700 mt-1">
              You will need to stake{' '}
              <span className="font-bold">
                {
                  Object.values(MODERATION_CONFIG.reportBonds)[
                    formData.severity
                  ]
                }{' '}
                ETH
              </span>{' '}
              to submit this report. If the report is approved, you'll receive
              your stake back plus a 10% bonus. If rejected, you may be slashed
              for false reporting.
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={
          isPending || isConfirming || uploadingEvidence || !evidenceHash
        }
        className="w-full py-3 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {uploadingEvidence
          ? 'Uploading Evidence...'
          : isPending
            ? 'Submitting Report...'
            : isConfirming
              ? 'Confirming...'
              : isSuccess
                ? '✓ Report Submitted!'
                : 'Submit Report'}
      </button>

      {isSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <div className="text-green-900 font-semibold">
            Report submitted successfully!
          </div>
          <div className="text-sm text-green-700 mt-1">
            A futarchy market has been created. The community will vote on your
            report.
          </div>
        </div>
      )}
    </form>
  )
}
