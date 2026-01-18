import { clsx } from 'clsx'
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  File,
  Folder,
  GitBranch,
  GitCommit,
  GitFork,
  GitPullRequest,
  History,
  Lock,
  Star,
  Tag,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button, EmptyState, LoadingState } from '../../components/shared'
import {
  type GitCommit as GitCommitType,
  type GitFile,
  useForkRepo,
  useRepo,
  useRepoBranches,
  useRepoCommits,
  useRepoFiles,
  useStarRepo,
} from '../../hooks/useGit'
import { formatFileSize, formatRelativeTime } from '../../lib/format'

type TabType = 'code' | 'commits' | 'branches' | 'pulls'

export function RepoDetailPage() {
  const { owner, name } = useParams<{ owner: string; name: string }>()
  const navigate = useNavigate()
  const { isConnected } = useAccount()

  const [activeTab, setActiveTab] = useState<TabType>('code')
  const [currentPath, setCurrentPath] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('main')

  const { repo, isLoading, error } = useRepo(owner ?? '', name ?? '')
  const { files, isLoading: filesLoading } = useRepoFiles(
    owner ?? '',
    name ?? '',
    currentPath,
    selectedBranch,
  )
  const { commits, isLoading: commitsLoading } = useRepoCommits(
    owner ?? '',
    name ?? '',
    { branch: selectedBranch },
  )
  const { branches, isLoading: branchesLoading } = useRepoBranches(
    owner ?? '',
    name ?? '',
  )

  const starMutation = useStarRepo()
  const forkMutation = useForkRepo()

  const handleStar = async () => {
    if (!isConnected) {
      toast.error('Connect your wallet to star repositories')
      return
    }
    try {
      await starMutation.mutateAsync({ owner: owner ?? '', name: name ?? '' })
      toast.success('Repository starred')
    } catch {
      toast.error('Failed to star repository')
    }
  }

  const handleFork = async () => {
    if (!isConnected) {
      toast.error('Connect your wallet to fork repositories')
      return
    }
    try {
      const forked = await forkMutation.mutateAsync({
        owner: owner ?? '',
        name: name ?? '',
      })
      if (forked) {
        toast.success('Repository forked successfully')
        navigate(`/git/${forked.owner}/${forked.name}`)
      }
    } catch {
      toast.error('Failed to fork repository')
    }
  }

  const handleCopyCloneUrl = () => {
    const cloneUrl = `https://git.jeju.network/${owner}/${name}.git`
    navigator.clipboard.writeText(cloneUrl)
    toast.success('Clone URL copied to clipboard')
  }

  const navigateToPath = (path: string) => {
    setCurrentPath(path)
    setActiveTab('code')
  }

  const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : []

  if (isLoading) {
    return (
      <div className="page-container">
        <LoadingState text="Loading repository..." />
      </div>
    )
  }

  if (error || !repo) {
    return (
      <div className="page-container">
        <Link
          to="/git"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Repositories
        </Link>
        <EmptyState
          icon={GitBranch}
          title="Repository not found"
          description="The repository you're looking for doesn't exist or you don't have access."
          actionLabel="Browse Repositories"
          actionHref="/git"
        />
      </div>
    )
  }

  const tabs = [
    { id: 'code' as const, label: 'Code', icon: File },
    {
      id: 'commits' as const,
      label: 'Commits',
      icon: GitCommit,
      count: commits.length,
    },
    {
      id: 'branches' as const,
      label: 'Branches',
      icon: GitBranch,
      count: branches.length,
    },
    { id: 'pulls' as const, label: 'Pull Requests', icon: GitPullRequest },
  ]

  return (
    <div className="page-container">
      {/* Back link */}
      <Link
        to="/git"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Repositories
      </Link>

      {/* Header */}
      <div className="card p-6 mb-6 animate-in">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-surface-100 font-display">
                {repo.owner}/{repo.name}
              </h1>
              {repo.isPrivate && (
                <span className="badge badge-neutral">
                  <Lock className="w-3 h-3 mr-1" />
                  Private
                </span>
              )}
            </div>
            <p className="text-surface-400 mb-4">
              {repo.description || 'No description provided'}
            </p>

            {/* Stats */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-surface-500">
              <span className="flex items-center gap-1.5">
                <Star className="w-4 h-4" />
                {repo.stars} stars
              </span>
              <span className="flex items-center gap-1.5">
                <GitFork className="w-4 h-4" />
                {repo.forks} forks
              </span>
              <span className="flex items-center gap-1.5">
                <Tag className="w-4 h-4" />
                {repo.tags} tags
              </span>
              <span className="flex items-center gap-1.5">
                <GitBranch className="w-4 h-4" />
                {repo.branches.length} branches
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              size="sm"
              icon={Star}
              onClick={handleStar}
              loading={starMutation.isPending}
            >
              Star
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={GitFork}
              onClick={handleFork}
              loading={forkMutation.isPending}
            >
              Fork
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Copy}
              onClick={handleCopyCloneUrl}
            >
              Clone
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-surface-800/50 mb-6">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'text-factory-400 border-factory-400'
                : 'text-surface-400 border-transparent hover:text-surface-100 hover:border-surface-600',
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.count !== undefined && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-surface-800 text-surface-400">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'code' && (
        <CodeTab
          files={files}
          isLoading={filesLoading}
          currentPath={currentPath}
          breadcrumbs={breadcrumbs}
          selectedBranch={selectedBranch}
          branches={repo.branches}
          onBranchChange={setSelectedBranch}
          onNavigate={navigateToPath}
          readme={repo.readme}
        />
      )}

      {activeTab === 'commits' && (
        <CommitsTab
          commits={commits}
          isLoading={commitsLoading}
          selectedBranch={selectedBranch}
          branches={repo.branches}
          onBranchChange={setSelectedBranch}
        />
      )}

      {activeTab === 'branches' && (
        <BranchesTab
          branches={branches}
          isLoading={branchesLoading}
          defaultBranch={repo.branches[0]}
        />
      )}

      {activeTab === 'pulls' && <PullRequestsTab />}
    </div>
  )
}

interface CodeTabProps {
  files: GitFile[]
  isLoading: boolean
  currentPath: string
  breadcrumbs: string[]
  selectedBranch: string
  branches: string[]
  onBranchChange: (branch: string) => void
  onNavigate: (path: string) => void
  readme?: string
}

function CodeTab({
  files,
  isLoading,
  currentPath,
  breadcrumbs,
  selectedBranch,
  branches,
  onBranchChange,
  onNavigate,
  readme,
}: CodeTabProps) {
  // Sort files: directories first, then files
  const sortedFiles = [...files].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1
    if (a.type !== 'dir' && b.type === 'dir') return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="space-y-6">
      {/* Branch selector and breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="relative">
          <select
            value={selectedBranch}
            onChange={(e) => onBranchChange(e.target.value)}
            className="input pl-10 pr-8 py-2 text-sm appearance-none cursor-pointer"
          >
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
          <GitBranch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none" />
        </div>

        {/* Breadcrumb navigation */}
        {breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 text-sm overflow-x-auto">
            <button
              type="button"
              onClick={() => onNavigate('')}
              className="text-factory-400 hover:text-factory-300 font-medium whitespace-nowrap"
            >
              root
            </button>
            {breadcrumbs.map((crumb, idx) => {
              const path = breadcrumbs.slice(0, idx + 1).join('/')
              const isLast = idx === breadcrumbs.length - 1
              return (
                <span key={path} className="flex items-center gap-1">
                  <ChevronRight className="w-4 h-4 text-surface-600" />
                  {isLast ? (
                    <span className="text-surface-200 font-medium whitespace-nowrap">
                      {crumb}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onNavigate(path)}
                      className="text-factory-400 hover:text-factory-300 whitespace-nowrap"
                    >
                      {crumb}
                    </button>
                  )}
                </span>
              )
            })}
          </nav>
        )}
      </div>

      {/* File browser */}
      <div className="card overflow-hidden animate-in">
        {isLoading ? (
          <div className="p-8">
            <LoadingState text="Loading files..." />
          </div>
        ) : sortedFiles.length === 0 ? (
          <div className="p-8 text-center text-surface-500">
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No files in this directory</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-800/50">
            {/* Go up button if in a subdirectory */}
            {currentPath && (
              <button
                type="button"
                onClick={() => {
                  const parentPath = breadcrumbs.slice(0, -1).join('/')
                  onNavigate(parentPath)
                }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-800/30 transition-colors text-left"
              >
                <Folder className="w-4 h-4 text-factory-400" />
                <span className="text-surface-300">..</span>
              </button>
            )}

            {sortedFiles.map((file) => (
              <FileRow key={file.path} file={file} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>

      {/* README display */}
      {readme && currentPath === '' && (
        <div className="card p-6 animate-in" style={{ animationDelay: '50ms' }}>
          <h3 className="text-lg font-semibold text-surface-100 mb-4 flex items-center gap-2">
            <File className="w-5 h-5 text-surface-400" />
            README.md
          </h3>
          <div className="prose prose-invert max-w-none prose-sm">
            <pre className="whitespace-pre-wrap text-surface-300 bg-surface-800/50 p-4 rounded-lg text-sm">
              {readme}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

interface FileRowProps {
  file: GitFile
  onNavigate: (path: string) => void
}

function FileRow({ file, onNavigate }: FileRowProps) {
  const isDir = file.type === 'dir'

  return (
    <button
      type="button"
      onClick={() => isDir && onNavigate(file.path)}
      disabled={!isDir}
      className={clsx(
        'w-full flex items-center gap-3 px-4 py-3 transition-colors text-left',
        isDir ? 'hover:bg-surface-800/30 cursor-pointer' : 'cursor-default',
      )}
    >
      {isDir ? (
        <Folder className="w-4 h-4 text-factory-400 flex-shrink-0" />
      ) : (
        <File className="w-4 h-4 text-surface-500 flex-shrink-0" />
      )}
      <span
        className={clsx(
          'flex-1 truncate',
          isDir ? 'text-factory-400' : 'text-surface-300',
        )}
      >
        {file.name}
      </span>
      {file.lastCommitMessage && (
        <span className="hidden sm:block text-sm text-surface-600 truncate max-w-xs">
          {file.lastCommitMessage}
        </span>
      )}
      {file.size !== undefined && !isDir && (
        <span className="text-sm text-surface-600 whitespace-nowrap">
          {formatFileSize(file.size)}
        </span>
      )}
    </button>
  )
}

interface CommitsTabProps {
  commits: GitCommitType[]
  isLoading: boolean
  selectedBranch: string
  branches: string[]
  onBranchChange: (branch: string) => void
}

function CommitsTab({
  commits,
  isLoading,
  selectedBranch,
  branches,
  onBranchChange,
}: CommitsTabProps) {
  return (
    <div className="space-y-6">
      {/* Branch selector */}
      <div className="relative w-fit">
        <select
          value={selectedBranch}
          onChange={(e) => onBranchChange(e.target.value)}
          className="input pl-10 pr-8 py-2 text-sm appearance-none cursor-pointer"
        >
          {branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>
        <GitBranch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none" />
      </div>

      {/* Commits list */}
      <div className="card overflow-hidden animate-in">
        {isLoading ? (
          <div className="p-8">
            <LoadingState text="Loading commits..." />
          </div>
        ) : commits.length === 0 ? (
          <div className="p-8 text-center text-surface-500">
            <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No commits found</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-800/50">
            {commits.map((commit, idx) => (
              <CommitRow key={commit.sha} commit={commit} index={idx} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface CommitRowProps {
  commit: GitCommitType
  index: number
}

function CommitRow({ commit, index }: CommitRowProps) {
  const shortSha = commit.sha.slice(0, 7)

  const handleCopySha = () => {
    navigator.clipboard.writeText(commit.sha)
    toast.success('Commit SHA copied')
  }

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-4 animate-slide-up"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-surface-200 font-medium truncate mb-1">
          {commit.message}
        </p>
        <p className="text-sm text-surface-500">
          {commit.author} committed {formatRelativeTime(commit.date)}
        </p>
      </div>
      <button
        type="button"
        onClick={handleCopySha}
        className="flex items-center gap-2 px-3 py-1.5 bg-surface-800/50 hover:bg-surface-700/50 rounded-lg text-sm font-mono text-surface-400 transition-colors self-start sm:self-auto"
        title="Copy full SHA"
      >
        <GitCommit className="w-4 h-4" />
        {shortSha}
      </button>
    </div>
  )
}

interface BranchesTabProps {
  branches: {
    name: string
    sha: string
    isDefault: boolean
    isProtected: boolean
  }[]
  isLoading: boolean
  defaultBranch: string
}

function BranchesTab({ branches, isLoading, defaultBranch }: BranchesTabProps) {
  return (
    <div className="card overflow-hidden animate-in">
      {isLoading ? (
        <div className="p-8">
          <LoadingState text="Loading branches..." />
        </div>
      ) : branches.length === 0 ? (
        <div className="p-8 text-center text-surface-500">
          <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No branches found</p>
        </div>
      ) : (
        <div className="divide-y divide-surface-800/50">
          {branches.map((branch, idx) => (
            <div
              key={branch.name}
              className="flex items-center gap-3 px-4 py-4 animate-slide-up"
              style={{ animationDelay: `${idx * 30}ms` }}
            >
              <GitBranch
                className={clsx(
                  'w-4 h-4 flex-shrink-0',
                  branch.name === defaultBranch
                    ? 'text-success-400'
                    : 'text-surface-500',
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-surface-200 font-medium">
                    {branch.name}
                  </span>
                  {branch.isDefault && (
                    <span className="badge badge-success text-xs">default</span>
                  )}
                  {branch.isProtected && (
                    <span className="badge badge-warning text-xs">
                      <Lock className="w-3 h-3 mr-1" />
                      protected
                    </span>
                  )}
                </div>
              </div>
              <span className="text-sm text-surface-600 font-mono">
                {branch.sha.slice(0, 7)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PullRequestsTab() {
  return (
    <div className="card p-8 animate-in">
      <div className="text-center">
        <GitPullRequest className="w-12 h-12 mx-auto mb-3 text-surface-600" />
        <h3 className="text-lg font-semibold text-surface-200 mb-2">
          Pull Requests Coming Soon
        </h3>
        <p className="text-surface-500 max-w-md mx-auto">
          Pull request management will be available in a future update. Create
          and review code changes with on-chain verification.
        </p>
      </div>
    </div>
  )
}
