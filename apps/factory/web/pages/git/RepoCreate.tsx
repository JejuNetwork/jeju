import { ArrowLeft, GitBranch, Lock, Unlock } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button, PageHeader } from '../../components/shared'
import { api, extractData } from '../../lib/client'

export function RepoCreatePage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [addReadme, setAddReadme] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isValidName = /^[a-zA-Z0-9_-]+$/.test(name)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }

    if (!isValidName) {
      toast.error(
        'Repository name can only contain letters, numbers, hyphens, and underscores',
      )
      return
    }

    setIsSubmitting(true)

    const response = await api.api.git.post({
      name,
      description,
      isPrivate,
      defaultBranch,
      owner: address as string,
    })

    setIsSubmitting(false)

    const data = extractData(response)
    if (data) {
      toast.success('Repository created successfully')
      navigate(`/git/${address}/${name}`)
    }
  }

  return (
    <div className="page-container">
      <Link
        to="/git"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Repositories
      </Link>

      <PageHeader
        title="New Repository"
        icon={GitBranch}
        iconColor="text-info-400"
      />

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="card p-6 space-y-4 animate-in">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-surface-300 mb-2"
            >
              Repository Name *
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-project"
              className="input w-full"
              required
            />
            {name && !isValidName && (
              <p className="text-error-400 text-sm mt-1">
                Only letters, numbers, hyphens, and underscores allowed
              </p>
            )}
            {name && isValidName && (
              <p className="text-surface-500 text-sm mt-1">
                Your repository will be available at{' '}
                <code className="text-surface-300">
                  git.jejunetwork.org/{address?.slice(0, 8)}.../{name}
                </code>
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-surface-300 mb-2"
            >
              Description (optional)
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of your repository"
              className="input w-full min-h-[80px] resize-y"
            />
          </div>

          <fieldset>
            <legend className="block text-sm font-medium text-surface-300 mb-3">
              Visibility
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsPrivate(false)}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  !isPrivate
                    ? 'border-factory-500 bg-factory-500/10'
                    : 'border-surface-700 hover:border-surface-600'
                }`}
              >
                <Unlock className="w-6 h-6 mb-2 text-success-400" />
                <p className="font-medium text-surface-200">Public</p>
                <p className="text-sm text-surface-500">
                  Anyone can see this repository
                </p>
              </button>
              <button
                type="button"
                onClick={() => setIsPrivate(true)}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  isPrivate
                    ? 'border-factory-500 bg-factory-500/10'
                    : 'border-surface-700 hover:border-surface-600'
                }`}
              >
                <Lock className="w-6 h-6 mb-2 text-warning-400" />
                <p className="font-medium text-surface-200">Private</p>
                <p className="text-sm text-surface-500">
                  Only you can see this repository
                </p>
              </button>
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="defaultBranch"
              className="block text-sm font-medium text-surface-300 mb-2"
            >
              Default Branch
            </label>
            <select
              id="defaultBranch"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              className="input w-full"
            >
              <option value="main">main</option>
              <option value="master">master</option>
              <option value="develop">develop</option>
            </select>
          </div>

          <label className="flex items-start gap-3 p-4 bg-surface-800/50 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={addReadme}
              onChange={(e) => setAddReadme(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-surface-600 bg-surface-800 text-factory-500 focus:ring-factory-500"
            />
            <div>
              <p className="font-medium text-surface-200">
                Initialize with README
              </p>
              <p className="text-sm text-surface-500">
                Creates a README.md file with your repository name and
                description
              </p>
            </div>
          </label>
        </div>

        <div className="flex items-center justify-end gap-4">
          <Link
            to="/git"
            className="btn bg-surface-800 text-surface-300 hover:bg-surface-700"
          >
            Cancel
          </Link>
          <Button
            type="submit"
            variant="primary"
            loading={isSubmitting}
            disabled={!isConnected || !name || !isValidName}
          >
            {!isConnected ? 'Connect Wallet' : 'Create Repository'}
          </Button>
        </div>
      </form>
    </div>
  )
}
