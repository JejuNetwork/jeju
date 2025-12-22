'use client'

import { clsx } from 'clsx'
import {
  ArrowLeft,
  Check,
  Copy,
  Database,
  FileUp,
  Globe,
  HardDrive,
  Info,
  Loader2,
  Lock,
  Shield,
  Terminal,
  Upload,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { useAccount } from 'wagmi'

type DatasetType =
  | 'text'
  | 'code'
  | 'image'
  | 'audio'
  | 'multimodal'
  | 'tabular'
type UploadMethod = 'cli' | 'upload'

const datasetTypes: {
  value: DatasetType
  label: string
  description: string
}[] = [
  {
    value: 'text',
    label: 'Text',
    description: 'Text documents, Q&A pairs, conversations',
  },
  {
    value: 'code',
    label: 'Code',
    description: 'Source code, smart contracts, scripts',
  },
  {
    value: 'image',
    label: 'Image',
    description: 'Images with labels or captions',
  },
  {
    value: 'audio',
    label: 'Audio',
    description: 'Audio files with transcriptions',
  },
  {
    value: 'multimodal',
    label: 'Multimodal',
    description: 'Mixed content types',
  },
  { value: 'tabular', label: 'Tabular', description: 'Structured data tables' },
]

const licenses = [
  { value: 'Apache-2.0', label: 'Apache 2.0' },
  { value: 'MIT', label: 'MIT' },
  { value: 'CC-BY-4.0', label: 'CC BY 4.0' },
  { value: 'CC-BY-SA-4.0', label: 'CC BY-SA 4.0' },
  { value: 'CC-BY-NC-4.0', label: 'CC BY-NC 4.0' },
  { value: 'CC0-1.0', label: 'CC0 (Public Domain)' },
  { value: 'other', label: 'Other' },
]

export default function UploadDatasetPage() {
  const { isConnected } = useAccount()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [method, setMethod] = useState<UploadMethod>('cli')
  const [name, setName] = useState('')
  const [organization, setOrganization] = useState('')
  const [description, setDescription] = useState('')
  const [datasetType, setDatasetType] = useState<DatasetType>('text')
  const [license, setLicense] = useState('Apache-2.0')
  const [isPrivate, setIsPrivate] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()])
      setTagInput('')
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || [])
    setFiles((prev) => [...prev, ...newFiles])
  }

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !organization.trim() || files.length === 0) return

    setIsSubmitting(true)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    router.push('/models/datasets')
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/models/datasets"
            className="text-factory-400 hover:text-factory-300 text-sm mb-4 inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Datasets
          </Link>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Database className="w-7 h-7 text-cyan-400" />
            Upload Dataset
          </h1>
          <p className="text-factory-400 mt-1">
            Share training data with the Jeju community
          </p>
        </div>

        {/* Method Toggle */}
        <div className="card p-4 mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setMethod('cli')}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg transition-colors',
                method === 'cli'
                  ? 'bg-accent-600 text-white'
                  : 'bg-factory-800 text-factory-400 hover:text-factory-100',
              )}
            >
              <Terminal className="w-5 h-5" />
              CLI (Recommended)
            </button>
            <button
              onClick={() => setMethod('upload')}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg transition-colors',
                method === 'upload'
                  ? 'bg-accent-600 text-white'
                  : 'bg-factory-800 text-factory-400 hover:text-factory-100',
              )}
            >
              <Upload className="w-5 h-5" />
              Web Upload
            </button>
          </div>
        </div>

        {method === 'cli' ? (
          <div className="space-y-6">
            {/* Install CLI */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Terminal className="w-5 h-5 text-accent-400" />
                1. Install Jeju Hub CLI
              </h2>
              <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm mb-3">
                <pre className="text-factory-300">pip install jeju-hub</pre>
              </div>
              <button
                onClick={() =>
                  copyToClipboard('pip install jeju-hub', 'install')
                }
                className="btn btn-secondary text-sm"
              >
                {copied === 'install' ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                Copy
              </button>
            </div>

            {/* Login */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-accent-400" />
                2. Authenticate
              </h2>
              <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm mb-3">
                <pre className="text-factory-300">jeju-hub login --wallet</pre>
              </div>
              <p className="text-factory-500 text-sm">
                This will prompt you to sign a message with your wallet to
                authenticate.
              </p>
            </div>

            {/* Upload */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-accent-400" />
                3. Upload Dataset
              </h2>
              <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm mb-3">
                <pre className="text-factory-300">{`# Create a new dataset repository
jeju-hub dataset create your-org/dataset-name

# Upload your files
jeju-hub dataset upload your-org/dataset-name ./data/

# Or push from a local directory
cd my-dataset/
jeju-hub dataset push your-org/dataset-name`}</pre>
              </div>
              <button
                onClick={() =>
                  copyToClipboard(
                    'jeju-hub dataset create your-org/dataset-name',
                    'upload',
                  )
                }
                className="btn btn-secondary text-sm"
              >
                {copied === 'upload' ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                Copy
              </button>
            </div>

            {/* Dataset Card */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Info className="w-5 h-5 text-accent-400" />
                4. Add Dataset Card
              </h2>
              <p className="text-factory-400 text-sm mb-4">
                Create a <code className="text-accent-400">README.md</code> in
                your dataset folder with metadata:
              </p>
              <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm">
                <pre className="text-factory-300">{`---
license: apache-2.0
task_categories:
  - text-generation
language:
  - en
size_categories:
  - 10K<n<100K
---

# My Dataset

Description of your dataset...`}</pre>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4">
                Dataset Information
              </h2>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-factory-300 mb-2">
                      Organization
                    </label>
                    <input
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder="your-org"
                      className="input"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-factory-300 mb-2">
                      Dataset Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="my-dataset"
                      className="input"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe your dataset..."
                    rows={3}
                    className="input resize-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">
                    Type
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {datasetTypes.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setDatasetType(type.value)}
                        className={clsx(
                          'p-3 rounded-lg border text-left transition-colors',
                          datasetType === type.value
                            ? 'border-accent-500 bg-accent-500/10'
                            : 'border-factory-700 hover:border-factory-600',
                        )}
                      >
                        <p className="font-medium text-factory-200 text-sm">
                          {type.label}
                        </p>
                        <p className="text-xs text-factory-500">
                          {type.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-factory-300 mb-2">
                      License
                    </label>
                    <select
                      value={license}
                      onChange={(e) => setLicense(e.target.value)}
                      className="input"
                    >
                      {licenses.map((lic) => (
                        <option key={lic.value} value={lic.value}>
                          {lic.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-factory-300 mb-2">
                      Visibility
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPrivate(false)}
                        className={clsx(
                          'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border transition-colors',
                          !isPrivate
                            ? 'border-accent-500 bg-accent-500/10 text-accent-400'
                            : 'border-factory-700 text-factory-400 hover:border-factory-600',
                        )}
                      >
                        <Globe className="w-4 h-4" />
                        Public
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsPrivate(true)}
                        className={clsx(
                          'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border transition-colors',
                          isPrivate
                            ? 'border-accent-500 bg-accent-500/10 text-accent-400'
                            : 'border-factory-700 text-factory-400 hover:border-factory-600',
                        )}
                      >
                        <Lock className="w-4 h-4" />
                        Private
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">
                    Tags
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="badge badge-info flex items-center gap-1"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => setTags(tags.filter((t) => t !== tag))}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTag()
                        }
                      }}
                      placeholder="Add tag..."
                      className="input flex-1"
                    />
                    <button
                      type="button"
                      onClick={addTag}
                      className="btn btn-secondary"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* File Upload */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4">
                Upload Files
              </h2>

              <div
                className={clsx(
                  'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
                  files.length > 0
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-factory-700 hover:border-factory-600',
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  multiple
                  accept=".csv,.jsonl,.parquet,.txt,.json,.tar.gz,.zip"
                  className="hidden"
                />
                <FileUp className="w-12 h-12 mx-auto mb-4 text-factory-500" />
                <p className="text-factory-300 mb-2">
                  Click to upload or drag and drop
                </p>
                <p className="text-factory-500 text-sm">
                  Supports CSV, JSONL, Parquet, and more
                </p>
              </div>

              {files.length > 0 && (
                <div className="mt-4 space-y-2">
                  {files.map((file, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 bg-factory-800/50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <HardDrive className="w-4 h-4 text-factory-400" />
                        <span className="text-factory-200 text-sm">
                          {file.name}
                        </span>
                        <span className="text-factory-500 text-xs">
                          {formatSize(file.size)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="text-factory-400 hover:text-red-400"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm text-factory-400 pt-2">
                    <span>{files.length} file(s)</span>
                    <span>Total: {formatSize(totalSize)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-4">
              <Link href="/models/datasets" className="btn btn-secondary">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={
                  !name.trim() ||
                  !organization.trim() ||
                  files.length === 0 ||
                  isSubmitting ||
                  !isConnected
                }
                className="btn btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload Dataset
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
