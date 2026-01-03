import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  FolderKanban,
  Globe,
  Loader2,
  Lock,
  Plus,
  Users,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button } from '../../components/shared/Button'
import { PageHeader } from '../../components/shared/PageHeader'
import { api, extractDataSafe } from '../../lib/client'

type Visibility = 'public' | 'private' | 'internal'

interface ProjectFormData {
  name: string
  description: string
  visibility: Visibility
  tags: string[]
  teamMembers: string[]
}

const VISIBILITY_OPTIONS: Array<{
  value: Visibility
  label: string
  icon: typeof Globe
  description: string
}> = [
  {
    value: 'public',
    label: 'Public',
    icon: Globe,
    description: 'Anyone can see this project',
  },
  {
    value: 'private',
    label: 'Private',
    icon: Lock,
    description: 'Only team members can access',
  },
  {
    value: 'internal',
    label: 'Internal',
    icon: Users,
    description: 'Organization members only',
  },
]

export function ProjectNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isConnected } = useAccount()

  const [formData, setFormData] = useState<ProjectFormData>({
    name: '',
    description: '',
    visibility: 'public',
    tags: [],
    teamMembers: [],
  })

  const [tagInput, setTagInput] = useState('')
  const [memberInput, setMemberInput] = useState('')

  const createMutation = useMutation({
    mutationFn: async (data: ProjectFormData) => {
      const response = await api.api.projects.post({
        name: data.name,
        description: data.description,
        visibility: data.visibility,
      })
      const result = extractDataSafe(response)
      if (!result || (typeof result === 'object' && 'error' in result)) {
        throw new Error(
          typeof result === 'object' && result && 'error' in result
            ? String(
                (result.error as { message?: string })?.message ??
                  'Failed to create project',
              )
            : 'Failed to create project',
        )
      }
      return result
    },
    onSuccess: (result) => {
      toast.success(`Project "${formData.name}" created`)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      const projectId =
        typeof result === 'object' && result && 'id' in result
          ? result.id
          : formData.name
      navigate(`/projects/${projectId}`)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!isConnected) {
      toast.error('Please connect your wallet to create projects')
      return
    }
    createMutation.mutate(formData)
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

  const addMember = () => {
    const member = memberInput.trim()
    if (member && !formData.teamMembers.includes(member)) {
      setFormData((prev) => ({
        ...prev,
        teamMembers: [...prev.teamMembers, member],
      }))
      setMemberInput('')
    }
  }

  const removeMember = (member: string) => {
    setFormData((prev) => ({
      ...prev,
      teamMembers: prev.teamMembers.filter((m) => m !== member),
    }))
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Create Project"
        description="Create a new project to organize your work"
        icon={FolderKanban}
      />

      {!isConnected && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <h4 className="font-medium text-amber-300">Wallet Not Connected</h4>
            <p className="text-sm text-amber-300/70">
              Connect your wallet to create projects. Your wallet address will
              be the project owner.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Project Name */}
        <div>
          <label
            htmlFor="project-name"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Project Name <span className="text-red-400">*</span>
          </label>
          <input
            id="project-name"
            type="text"
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="My Awesome Project"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-500"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="project-description"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Description <span className="text-red-400">*</span>
          </label>
          <textarea
            id="project-description"
            value={formData.description}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder="Describe your project goals, objectives, and what you're building..."
            rows={4}
            minLength={10}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-500 resize-none"
            required
          />
        </div>

        {/* Visibility */}
        <div>
          <span className="block text-sm font-medium text-white/90 mb-3">
            Visibility <span className="text-red-400">*</span>
          </span>
          <fieldset className="grid grid-cols-1 md:grid-cols-3 gap-3 border-0 p-0 m-0">
            {VISIBILITY_OPTIONS.map((option) => {
              const VisibilityIcon = option.icon
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      visibility: option.value,
                    }))
                  }
                  className={`p-4 rounded-lg border transition-all text-left ${
                    formData.visibility === option.value
                      ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500'
                      : 'border-white/10 hover:border-white/30 bg-white/5'
                  }`}
                >
                  <VisibilityIcon
                    className={`w-5 h-5 mb-2 ${
                      formData.visibility === option.value
                        ? 'text-emerald-400'
                        : 'text-white/40'
                    }`}
                  />
                  <div
                    className={`font-medium ${
                      formData.visibility === option.value
                        ? 'text-white'
                        : 'text-white/80'
                    }`}
                  >
                    {option.label}
                  </div>
                  <div className="text-xs text-white/40 mt-1">
                    {option.description}
                  </div>
                </button>
              )
            })}
          </fieldset>
        </div>

        {/* Tags */}
        <div>
          <label
            htmlFor="project-tag-input"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Tags
          </label>
          <div className="flex gap-2">
            <input
              id="project-tag-input"
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag()
                }
              }}
              placeholder="Add a tag (e.g., frontend, blockchain)"
              className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-500"
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
                  className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-sm"
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

        {/* Team Members */}
        <div>
          <label
            htmlFor="project-member-input"
            className="block text-sm font-medium text-white/90 mb-2"
          >
            Team Members
          </label>
          <div className="flex gap-2">
            <input
              id="project-member-input"
              type="text"
              value={memberInput}
              onChange={(e) => setMemberInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addMember()
                }
              }}
              placeholder="Wallet address or JNS name"
              className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-500"
            />
            <Button type="button" variant="secondary" onClick={addMember}>
              Add
            </Button>
          </div>
          {formData.teamMembers.length > 0 && (
            <div className="space-y-2 mt-3">
              {formData.teamMembers.map((member) => (
                <div
                  key={member}
                  className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <Users className="w-4 h-4 text-emerald-400" />
                    </div>
                    <span className="font-mono text-sm text-white/80">
                      {member.length > 20
                        ? `${member.slice(0, 6)}...${member.slice(-4)}`
                        : member}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMember(member)}
                    className="text-white/40 hover:text-red-400 transition-colors"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-white/40">
            Add team members by their wallet address or JNS name. You can also
            add members after creating the project.
          </p>
        </div>

        {/* Submit */}
        <div className="flex gap-4 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/projects')}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={createMutation.isPending || !isConnected}
            icon={createMutation.isPending ? Loader2 : Plus}
            className="flex-1"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Project'}
          </Button>
        </div>
      </form>
    </div>
  )
}
