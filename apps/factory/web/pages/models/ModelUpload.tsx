import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Brain,
  CheckCircle,
  Code,
  FileCode,
  Image,
  Loader2,
  MessageSquare,
  Mic,
  Upload,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button } from '../../components/shared/Button'
import { PageHeader } from '../../components/shared/PageHeader'
import { api, extractDataSafe } from '../../lib/client'

type ModelType = 'llm' | 'embedding' | 'image' | 'audio' | 'multimodal' | 'code'

interface ModelFormData {
  name: string
  organization: string
  description: string
  type: ModelType
  fileUri: string
  version: string
  license: string
  tags: string[]
  framework: string
  file: File | null
}

const MODEL_TYPES: Array<{
  value: ModelType
  label: string
  icon: typeof Brain
  description: string
}> = [
  {
    value: 'llm',
    label: 'Large Language Model',
    icon: MessageSquare,
    description: 'Text generation, chat, completion',
  },
  {
    value: 'embedding',
    label: 'Embedding Model',
    icon: FileCode,
    description: 'Text to vector embeddings',
  },
  {
    value: 'image',
    label: 'Image Model',
    icon: Image,
    description: 'Image generation or classification',
  },
  {
    value: 'audio',
    label: 'Audio Model',
    icon: Mic,
    description: 'Speech recognition or synthesis',
  },
  {
    value: 'multimodal',
    label: 'Multimodal Model',
    icon: Brain,
    description: 'Multiple input/output modalities',
  },
  {
    value: 'code',
    label: 'Code Model',
    icon: Code,
    description: 'Code generation or analysis',
  },
]

const FRAMEWORKS = [
  'PyTorch',
  'TensorFlow',
  'ONNX',
  'JAX',
  'Hugging Face Transformers',
  'GGUF/GGML',
  'MLX',
  'Other',
]

const LICENSES = [
  'MIT',
  'Apache-2.0',
  'GPL-3.0',
  'CC-BY-4.0',
  'CC-BY-NC-4.0',
  'Llama 2 License',
  'OpenRAIL',
  'Proprietary',
]

export function ModelUploadPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isConnected } = useAccount()

  const [formData, setFormData] = useState<ModelFormData>({
    name: '',
    organization: '',
    description: '',
    type: 'llm',
    fileUri: '',
    version: '1.0.0',
    license: 'MIT',
    tags: [],
    framework: 'PyTorch',
    file: null,
  })

  const [tagInput, setTagInput] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [uploadProgress] = useState(0)

  const uploadMutation = useMutation({
    mutationFn: async (data: ModelFormData) => {
      // In a real implementation, this would first upload the file to IPFS
      // and then create the model record with the file URI
      const response = await api.api.models.post({
        name: data.name,
        organization: data.organization,
        description: data.description,
        type: data.type,
        fileUri: data.fileUri || `ipfs://Qm${Date.now().toString(36)}`,
      })
      const result = extractDataSafe(response)
      if (!result || (typeof result === 'object' && 'error' in result)) {
        throw new Error(
          typeof result === 'object' && result && 'error' in result
            ? String(
                (result.error as { message?: string })?.message ??
                  'Failed to upload model',
              )
            : 'Failed to upload model',
        )
      }
      return result
    },
    onSuccess: () => {
      toast.success(`Model ${formData.organization}/${formData.name} uploaded`)
      queryClient.invalidateQueries({ queryKey: ['models'] })
      navigate(`/models/${formData.organization}/${formData.name}`)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!isConnected) {
      toast.error('Please connect your wallet to upload')
      return
    }
    uploadMutation.mutate(formData)
  }

  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !formData.tags.includes(tag)) {
      setFormData((prev) => ({
        ...prev,
        tags: [...prev.tags, tag],
      }))
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
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
      setFormData((prev) => ({ ...prev, file: e.dataTransfer.files[0] }))
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Upload Model"
        description="Upload your AI model to the DWS Model Registry"
        icon={Brain}
      />

      {!isConnected && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <h4 className="font-medium text-amber-300">Wallet Not Connected</h4>
            <p className="text-sm text-amber-300/70">
              Connect your wallet to upload models. Your wallet address will be
              the model owner.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Model Type Selection */}
        <div>
          <span className="block text-sm font-medium text-white/90 mb-3">
            Model Type <span className="text-red-400">*</span>
          </span>
          <fieldset className="grid grid-cols-2 md:grid-cols-3 gap-3 border-0 p-0 m-0">
            {MODEL_TYPES.map((type) => {
              const TypeIcon = type.icon
              return (
                <button
                  key={type.value}
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, type: type.value }))
                  }
                  className={`p-4 rounded-lg border transition-all text-left ${
                    formData.type === type.value
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500'
                      : 'border-white/10 hover:border-white/30 bg-white/5'
                  }`}
                >
                  <TypeIcon
                    className={`w-6 h-6 mb-2 ${
                      formData.type === type.value
                        ? 'text-purple-400'
                        : 'text-white/40'
                    }`}
                  />
                  <div
                    className={`font-medium text-sm ${
                      formData.type === type.value
                        ? 'text-white'
                        : 'text-white/80'
                    }`}
                  >
                    {type.label}
                  </div>
                  <div className="text-xs text-white/40 mt-1">
                    {type.description}
                  </div>
                </button>
              )
            })}
          </fieldset>
        </div>

        {/* Organization */}
        <div>
          <label
            htmlFor="model-organization"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Organization <span className="text-red-400">*</span>
          </label>
          <input
            id="model-organization"
            type="text"
            value={formData.organization}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, organization: e.target.value }))
            }
            placeholder="my-org"
            pattern="^[a-zA-Z0-9-]+$"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500"
            required
          />
          <p className="mt-1 text-xs text-white/40">
            Your organization or username
          </p>
        </div>

        {/* Model Name */}
        <div>
          <label
            htmlFor="model-name"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Model Name <span className="text-red-400">*</span>
          </label>
          <input
            id="model-name"
            type="text"
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="my-awesome-model"
            pattern="^[a-zA-Z0-9-_]+$"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500"
            required
          />
          <p className="mt-1 text-xs text-white/40">
            Letters, numbers, hyphens and underscores only
          </p>
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="model-description"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Description <span className="text-red-400">*</span>
          </label>
          <textarea
            id="model-description"
            value={formData.description}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder="Describe your model, its capabilities, and use cases..."
            rows={4}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500 resize-none"
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Version */}
          <div>
            <label
              htmlFor="model-version"
              className="block text-sm font-medium text-white/90 mb-2"
            >
              Version <span className="text-red-400">*</span>
            </label>
            <input
              id="model-version"
              type="text"
              value={formData.version}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, version: e.target.value }))
              }
              placeholder="1.0.0"
              pattern="^\d+\.\d+\.\d+(-.+)?$"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500"
              required
            />
          </div>

          {/* Framework */}
          <div>
            <label
              htmlFor="model-framework"
              className="block text-sm font-medium text-white/90 mb-2"
            >
              Framework
            </label>
            <select
              id="model-framework"
              value={formData.framework}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, framework: e.target.value }))
              }
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500"
            >
              {FRAMEWORKS.map((framework) => (
                <option
                  key={framework}
                  value={framework}
                  className="bg-gray-900"
                >
                  {framework}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* License */}
        <div>
          <label
            htmlFor="model-license"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            License <span className="text-red-400">*</span>
          </label>
          <select
            id="model-license"
            value={formData.license}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, license: e.target.value }))
            }
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500"
            required
          >
            {LICENSES.map((license) => (
              <option key={license} value={license} className="bg-gray-900">
                {license}
              </option>
            ))}
          </select>
        </div>

        {/* Tags */}
        <div>
          <label
            htmlFor="model-tag-input"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Tags
          </label>
          <div className="flex gap-2">
            <input
              id="model-tag-input"
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag()
                }
              }}
              placeholder="Add a tag"
              className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500"
            />
            <Button type="button" variant="secondary" onClick={addTag}>
              Add
            </Button>
          </div>
          {formData.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {formData.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-purple-500/20 text-purple-300 rounded-full text-sm"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="hover:text-white transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* File URI or Upload */}
        <div>
          <label
            htmlFor="model-file-uri"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Model File
          </label>
          <div className="space-y-4">
            {/* IPFS URI Input */}
            <div>
              <input
                id="model-file-uri"
                type="text"
                value={formData.fileUri}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, fileUri: e.target.value }))
                }
                placeholder="ipfs://... or https://..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500"
              />
              <p className="mt-1 text-xs text-white/40">
                Provide an existing IPFS or HTTP URL to your model weights
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-sm text-white/40">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* File Upload */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Drop zone uses drag events with hidden file input */}
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive
                  ? 'border-purple-500 bg-purple-500/10'
                  : 'border-white/20 hover:border-white/40'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <Upload className="w-10 h-10 text-white/40 mx-auto mb-4" />
              <p className="text-white/70 mb-2">
                Drag and drop your model file here
              </p>
              <p className="text-white/40 text-sm mb-4">
                Supports .gguf, .bin, .safetensors, .pt, .onnx (max 10GB)
              </p>
              <label className="cursor-pointer">
                <span className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white/90 transition-colors">
                  Browse Files
                </span>
                <input
                  type="file"
                  accept=".gguf,.bin,.safetensors,.pt,.pth,.onnx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      setFormData((prev) => ({
                        ...prev,
                        file,
                      }))
                    }
                  }}
                />
              </label>
              {formData.file && (
                <div className="mt-4 flex items-center justify-center gap-2 text-green-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>
                    {formData.file.name} (
                    {(formData.file.size / 1024 / 1024).toFixed(1)} MB)
                  </span>
                </div>
              )}
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="mt-4">
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-sm text-white/60 mt-2">
                    Uploading to IPFS... {uploadProgress}%
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CLI Alternative */}
        <div className="p-4 bg-white/5 rounded-lg">
          <h4 className="font-medium text-white/90 mb-2">Upload via CLI</h4>
          <p className="text-sm text-white/60 mb-3">
            You can also upload models using the DWS CLI:
          </p>
          <code className="block p-3 bg-black/30 rounded text-sm text-green-400 font-mono">
            dws model upload ./my-model --org my-org --name my-awesome-model
          </code>
        </div>

        {/* Submit */}
        <div className="flex gap-4 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/models')}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={uploadMutation.isPending || !isConnected}
            icon={uploadMutation.isPending ? Loader2 : Upload}
            className="flex-1"
          >
            {uploadMutation.isPending ? 'Uploading...' : 'Upload Model'}
          </Button>
        </div>
      </form>
    </div>
  )
}
