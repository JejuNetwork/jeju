import { ArrowLeft, GitBranch, Globe, Lock } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button } from '../../components/shared'
import { API_BASE } from '../../lib/api'

export function RepoNewPage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [addReadme, setAddReadme] = useState(true)
  const [gitignoreTemplate, setGitignoreTemplate] = useState('')
  const [license, setLicense] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const gitignoreOptions = [
    { value: '', label: 'None' },
    { value: 'Node', label: 'Node' },
    { value: 'Python', label: 'Python' },
    { value: 'Rust', label: 'Rust' },
    { value: 'Go', label: 'Go' },
    { value: 'Java', label: 'Java' },
  ]

  const licenseOptions = [
    { value: '', label: 'None' },
    { value: 'MIT', label: 'MIT License' },
    { value: 'Apache-2.0', label: 'Apache License 2.0' },
    { value: 'GPL-3.0', label: 'GNU GPLv3' },
    { value: 'BSD-3-Clause', label: 'BSD 3-Clause' },
    { value: 'Unlicense', label: 'The Unlicense' },
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!isConnected) {
      toast.error('Please connect your wallet to create a repository')
      return
    }

    if (!name.trim()) {
      toast.error('Repository name is required')
      return
    }

    // Validate repo name format
    const nameRegex = /^[a-zA-Z0-9_-]+$/
    if (!nameRegex.test(name)) {
      toast.error(
        'Repository name can only contain letters, numbers, hyphens, and underscores',
      )
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch(`${API_BASE}/api/git`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address ?? '',
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          isPrivate,
          addReadme,
          gitignoreTemplate: gitignoreTemplate || undefined,
          license: license || undefined,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(
          errorData.error?.message ?? 'Failed to create repository',
        )
      }

      const repo = await response.json()
      toast.success('Repository created successfully')
      navigate(`/git/${repo.owner ?? address}/${repo.name}`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create repository',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="page-container max-w-2xl">
      <Link
        to="/git"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Repositories
      </Link>

      <div className="card p-6 sm:p-8 animate-in">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-accent-500/15">
            <GitBranch className="w-6 h-6 text-accent-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-100 font-display">
              Create New Repository
            </h1>
            <p className="text-surface-400 text-sm">
              A repository contains all project files, including the revision
              history.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Repository Name */}
          <div>
            <label
              htmlFor="repo-name"
              className="block text-sm font-medium text-surface-200 mb-2"
            >
              Repository name <span className="text-error-400">*</span>
            </label>
            <input
              id="repo-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input w-full"
              placeholder="my-awesome-project"
              required
            />
            <p className="mt-1.5 text-xs text-surface-500">
              Use letters, numbers, hyphens, and underscores only
            </p>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-surface-200 mb-2"
            >
              Description <span className="text-surface-500">(optional)</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input w-full resize-none"
              rows={3}
              placeholder="A brief description of your project..."
            />
          </div>

          {/* Visibility */}
          <fieldset>
            <legend className="block text-sm font-medium text-surface-200 mb-3">
              Visibility
            </legend>
            <div className="space-y-3">
              <label className="flex items-start gap-3 p-3 rounded-lg border border-surface-800/50 bg-surface-800/20 cursor-pointer hover:border-surface-700 transition-colors">
                <input
                  type="radio"
                  name="visibility"
                  checked={!isPrivate}
                  onChange={() => setIsPrivate(false)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-success-400" />
                    <span className="font-medium text-surface-200">Public</span>
                  </div>
                  <p className="text-sm text-surface-500 mt-0.5">
                    Anyone can see this repository. You choose who can commit.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg border border-surface-800/50 bg-surface-800/20 cursor-pointer hover:border-surface-700 transition-colors">
                <input
                  type="radio"
                  name="visibility"
                  checked={isPrivate}
                  onChange={() => setIsPrivate(true)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-warning-400" />
                    <span className="font-medium text-surface-200">
                      Private
                    </span>
                  </div>
                  <p className="text-sm text-surface-500 mt-0.5">
                    You choose who can see and commit to this repository.
                  </p>
                </div>
              </label>
            </div>
          </fieldset>

          {/* Initialize Repository */}
          <fieldset>
            <legend className="block text-sm font-medium text-surface-200 mb-3">
              Initialize this repository with:
            </legend>
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addReadme}
                  onChange={(e) => setAddReadme(e.target.checked)}
                  className="rounded"
                />
                <span className="text-surface-300">Add a README file</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="gitignore"
                    className="block text-sm text-surface-400 mb-1.5"
                  >
                    Add .gitignore
                  </label>
                  <select
                    id="gitignore"
                    value={gitignoreTemplate}
                    onChange={(e) => setGitignoreTemplate(e.target.value)}
                    className="input w-full"
                  >
                    {gitignoreOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="license"
                    className="block text-sm text-surface-400 mb-1.5"
                  >
                    Choose a license
                  </label>
                  <select
                    id="license"
                    value={license}
                    onChange={(e) => setLicense(e.target.value)}
                    className="input w-full"
                  >
                    {licenseOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </fieldset>

          {/* Submit */}
          <div className="pt-4 border-t border-surface-800/50">
            <Button
              type="submit"
              variant="primary"
              className="w-full sm:w-auto"
              disabled={!name.trim() || isSubmitting}
              loading={isSubmitting}
            >
              Create Repository
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
