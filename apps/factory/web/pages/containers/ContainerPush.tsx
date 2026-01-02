import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Box, Loader2, Terminal, Upload } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button } from '../../components/shared/Button'
import { PageHeader } from '../../components/shared/PageHeader'
import { api, extractDataSafe } from '../../lib/client'

interface ContainerFormData {
  name: string
  tag: string
  digest: string
  platform: string
  labels: Record<string, string>
}

const PLATFORMS = [
  'linux/amd64',
  'linux/arm64',
  'linux/arm/v7',
  'linux/386',
  'darwin/amd64',
  'darwin/arm64',
]

export function ContainerPushPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isConnected } = useAccount()

  const [formData, setFormData] = useState<ContainerFormData>({
    name: '',
    tag: 'latest',
    digest: '',
    platform: 'linux/amd64',
    labels: {},
  })

  const [labelKey, setLabelKey] = useState('')
  const [labelValue, setLabelValue] = useState('')

  const pushMutation = useMutation({
    mutationFn: async (data: ContainerFormData) => {
      const response = await api.api.containers.post({
        name: data.name,
        tag: data.tag,
        digest: data.digest || `sha256:${Date.now().toString(16)}`,
        size: 0, // Would be determined by the actual image
        platform: data.platform,
        labels: data.labels,
      })
      const result = extractDataSafe(response)
      if (!result || (typeof result === 'object' && 'error' in result)) {
        throw new Error(
          typeof result === 'object' && result && 'error' in result
            ? String(
                (result.error as { message?: string })?.message ??
                  'Failed to push container',
              )
            : 'Failed to push container',
        )
      }
      return result
    },
    onSuccess: () => {
      toast.success(`Container ${formData.name}:${formData.tag} pushed`)
      queryClient.invalidateQueries({ queryKey: ['containers'] })
      navigate(`/containers/${formData.name}/${formData.tag}`)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!isConnected) {
      toast.error('Please connect your wallet to push containers')
      return
    }
    pushMutation.mutate(formData)
  }

  const addLabel = () => {
    const key = labelKey.trim()
    const value = labelValue.trim()
    if (key && value) {
      setFormData((prev) => ({
        ...prev,
        labels: { ...prev.labels, [key]: value },
      }))
      setLabelKey('')
      setLabelValue('')
    }
  }

  const removeLabel = (key: string) => {
    setFormData((prev) => {
      const newLabels = { ...prev.labels }
      delete newLabels[key]
      return { ...prev, labels: newLabels }
    })
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Push Container"
        description="Push a container image to the DWS Container Registry"
        icon={Box}
      />

      {!isConnected && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <h4 className="font-medium text-amber-300">Wallet Not Connected</h4>
            <p className="text-sm text-amber-300/70">
              Connect your wallet to push container images. Your wallet address
              will be the image owner.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Image Name */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-2">
            Image Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="my-org/my-app"
            pattern="^[a-z0-9-_]+(/[a-z0-9-_]+)*$"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-500"
            required
          />
          <p className="mt-1 text-xs text-white/40">
            Lowercase letters, numbers, hyphens, underscores, and slashes
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Tag */}
          <div>
            <label className="block text-sm font-medium text-white/90 mb-2">
              Tag <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.tag}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, tag: e.target.value }))
              }
              placeholder="latest"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          {/* Platform */}
          <div>
            <label className="block text-sm font-medium text-white/90 mb-2">
              Platform
            </label>
            <select
              value={formData.platform}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, platform: e.target.value }))
              }
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500"
            >
              {PLATFORMS.map((platform) => (
                <option key={platform} value={platform} className="bg-gray-900">
                  {platform}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Digest */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-2">
            Image Digest
          </label>
          <input
            type="text"
            value={formData.digest}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, digest: e.target.value }))
            }
            placeholder="sha256:..."
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-500 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-white/40">
            Optional. Will be computed from image content if not provided.
          </p>
        </div>

        {/* Labels */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-2">
            Labels
          </label>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={labelKey}
              onChange={(e) => setLabelKey(e.target.value)}
              placeholder="Key"
              className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-500"
            />
            <input
              type="text"
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              placeholder="Value"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addLabel()
                }
              }}
              className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-500"
            />
            <Button type="button" variant="secondary" onClick={addLabel}>
              Add
            </Button>
          </div>
          {Object.keys(formData.labels).length > 0 && (
            <div className="space-y-2">
              {Object.entries(formData.labels).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
                >
                  <div className="font-mono text-sm">
                    <span className="text-cyan-400">{key}</span>
                    <span className="text-white/40"> = </span>
                    <span className="text-white/80">{value}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLabel(key)}
                    className="text-white/40 hover:text-red-400 transition-colors"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CLI Instructions */}
        <div className="p-4 bg-white/5 rounded-lg space-y-4">
          <h4 className="font-medium text-white/90 flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            Push via CLI
          </h4>
          <p className="text-sm text-white/60">
            The easiest way to push container images is using the DWS CLI:
          </p>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-white/40 mb-1">
                Login to the registry:
              </p>
              <code className="block p-3 bg-black/30 rounded text-sm text-green-400 font-mono">
                dws auth login registry.dws.jejunetwork.org
              </code>
            </div>
            <div>
              <p className="text-xs text-white/40 mb-1">Tag your image:</p>
              <code className="block p-3 bg-black/30 rounded text-sm text-green-400 font-mono">
                docker tag my-app
                registry.dws.jejunetwork.org/my-org/my-app:latest
              </code>
            </div>
            <div>
              <p className="text-xs text-white/40 mb-1">Push to DWS:</p>
              <code className="block p-3 bg-black/30 rounded text-sm text-green-400 font-mono">
                docker push registry.dws.jejunetwork.org/my-org/my-app:latest
              </code>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-4 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/containers')}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={pushMutation.isPending || !isConnected}
            icon={pushMutation.isPending ? Loader2 : Upload}
            className="flex-1"
          >
            {pushMutation.isPending ? 'Pushing...' : 'Push Container'}
          </Button>
        </div>
      </form>
    </div>
  )
}
