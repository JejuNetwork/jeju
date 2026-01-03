import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Package,
  Upload,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button } from '../../components/shared/Button'
import { PageHeader } from '../../components/shared/PageHeader'
import { api, extractDataSafe } from '../../lib/client'

interface PackageFormData {
  name: string
  version: string
  description: string
  license: string
  repository: string
  keywords: string[]
  files: FileList | null
}

export function PackagePublishPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isConnected } = useAccount()

  const [formData, setFormData] = useState<PackageFormData>({
    name: '',
    version: '1.0.0',
    description: '',
    license: 'MIT',
    repository: '',
    keywords: [],
    files: null,
  })

  const [keywordInput, setKeywordInput] = useState('')
  const [dragActive, setDragActive] = useState(false)

  const publishMutation = useMutation({
    mutationFn: async (data: PackageFormData) => {
      const response = await api.api.packages.post({
        name: data.name,
        version: data.version,
        description: data.description,
        license: data.license,
      })
      const result = extractDataSafe(response)
      if (!result || (typeof result === 'object' && 'error' in result)) {
        throw new Error(
          typeof result === 'object' && result && 'error' in result
            ? String(
                (result.error as { message?: string })?.message ??
                  'Failed to publish package',
              )
            : 'Failed to publish package',
        )
      }
      return result
    },
    onSuccess: () => {
      toast.success(`Package ${formData.name}@${formData.version} published`)
      queryClient.invalidateQueries({ queryKey: ['packages'] })
      navigate(`/packages/${formData.name}`)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!isConnected) {
      toast.error('Please connect your wallet to publish')
      return
    }
    publishMutation.mutate(formData)
  }

  const addKeyword = () => {
    const keyword = keywordInput.trim()
    if (keyword && !formData.keywords.includes(keyword)) {
      setFormData((prev) => ({
        ...prev,
        keywords: [...prev.keywords, keyword],
      }))
      setKeywordInput('')
    }
  }

  const removeKeyword = (keyword: string) => {
    setFormData((prev) => ({
      ...prev,
      keywords: prev.keywords.filter((k) => k !== keyword),
    }))
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files?.[0]) {
      setFormData((prev) => ({ ...prev, files: e.dataTransfer.files }))
    }
  }

  const licenses = [
    'MIT',
    'Apache-2.0',
    'GPL-3.0',
    'BSD-3-Clause',
    'ISC',
    'MPL-2.0',
    'LGPL-3.0',
    'Unlicense',
    'CC0-1.0',
    'AGPL-3.0',
  ]

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Publish Package"
        description="Publish your package to the DWS Package Registry"
      />

      {!isConnected && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <h4 className="font-medium text-amber-300">Wallet Not Connected</h4>
            <p className="text-sm text-amber-300/70">
              Connect your wallet to publish packages. Your wallet address will
              be the package author.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Package Name */}
        <div>
          <label
            htmlFor="package-name"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Package Name <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
            <input
              id="package-name"
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="my-package or @org/my-package"
              pattern="^(@[a-z0-9-]+\/)?[a-z0-9-]+$"
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          <p className="mt-1 text-xs text-white/40">
            Lowercase letters, numbers, and hyphens. Scoped packages start with
            @org/
          </p>
        </div>

        {/* Version */}
        <div>
          <label
            htmlFor="package-version"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Version <span className="text-red-400">*</span>
          </label>
          <input
            id="package-version"
            type="text"
            value={formData.version}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, version: e.target.value }))
            }
            placeholder="1.0.0"
            pattern="^\d+\.\d+\.\d+(-.+)?$"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-blue-500"
            required
          />
          <p className="mt-1 text-xs text-white/40">
            Semantic versioning (major.minor.patch)
          </p>
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="package-description"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Description
          </label>
          <textarea
            id="package-description"
            value={formData.description}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder="A brief description of your package"
            rows={3}
            maxLength={500}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-blue-500 resize-none"
          />
          <p className="mt-1 text-xs text-white/40">
            {formData.description.length}/500 characters
          </p>
        </div>

        {/* License */}
        <div>
          <label
            htmlFor="package-license"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            License <span className="text-red-400">*</span>
          </label>
          <select
            id="package-license"
            value={formData.license}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, license: e.target.value }))
            }
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
            required
          >
            {licenses.map((license) => (
              <option key={license} value={license} className="bg-gray-900">
                {license}
              </option>
            ))}
          </select>
        </div>

        {/* Repository */}
        <div>
          <label
            htmlFor="package-repository"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Repository URL
          </label>
          <input
            id="package-repository"
            type="url"
            value={formData.repository}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, repository: e.target.value }))
            }
            placeholder="https://github.com/user/repo"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Keywords */}
        <div>
          <label
            htmlFor="package-keyword-input"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Keywords
          </label>
          <div className="flex gap-2">
            <input
              id="package-keyword-input"
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addKeyword()
                }
              }}
              placeholder="Add a keyword"
              className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-blue-500"
            />
            <Button type="button" variant="secondary" onClick={addKeyword}>
              Add
            </Button>
          </div>
          {formData.keywords.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {formData.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-blue-500/20 text-blue-300 rounded-full text-sm"
                >
                  {keyword}
                  <button
                    type="button"
                    onClick={() => removeKeyword(keyword)}
                    className="hover:text-white transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* File Upload */}
        <div>
          <span className="block text-sm font-medium text-white/90 mb-2">
            Package Files
          </span>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Drop zone uses drag events with hidden file input */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-white/20 hover:border-white/40'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="w-10 h-10 text-white/40 mx-auto mb-4" />
            <p className="text-white/70 mb-2">
              Drag and drop your package tarball here
            </p>
            <p className="text-white/40 text-sm mb-4">or</p>
            <label className="cursor-pointer">
              <span className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white/90 transition-colors">
                Browse Files
              </span>
              <input
                type="file"
                accept=".tgz,.tar.gz"
                className="hidden"
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, files: e.target.files }))
                }
              />
            </label>
            {formData.files?.[0] && (
              <div className="mt-4 flex items-center justify-center gap-2 text-green-400">
                <CheckCircle className="w-5 h-5" />
                <span>{formData.files[0].name}</span>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-white/40">
            Accept .tgz or .tar.gz package archives
          </p>
        </div>

        {/* CLI Alternative */}
        <div className="p-4 bg-white/5 rounded-lg">
          <h4 className="font-medium text-white/90 mb-2">Publish via CLI</h4>
          <p className="text-sm text-white/60 mb-3">
            You can also publish packages using the DWS CLI:
          </p>
          <code className="block p-3 bg-black/30 rounded text-sm text-green-400 font-mono">
            dws package publish ./my-package
          </code>
        </div>

        {/* Submit */}
        <div className="flex gap-4 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/packages')}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={publishMutation.isPending || !isConnected}
            icon={publishMutation.isPending ? Loader2 : Upload}
            className="flex-1"
          >
            {publishMutation.isPending ? 'Publishing...' : 'Publish Package'}
          </Button>
        </div>
      </form>
    </div>
  )
}
