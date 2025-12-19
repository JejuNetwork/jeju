'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useRouter } from 'next/navigation';
import { 
  GitBranch, 
  Lock, 
  Globe, 
  Info,
  Loader2,
  Terminal,
  Copy,
  Check,
  FileCode
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { dwsClient } from '@/lib/services/dws';

export default function NewRepoPage() {
  const { isConnected, address } = useAccount();
  const router = useRouter();
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [addReadme, setAddReadme] = useState(true);
  const [license, setLicense] = useState('MIT');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdRepo, setCreatedRepo] = useState<{ name: string; owner: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const ownerName = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'your-username';
  const repoUrl = `https://git.jeju.network/${ownerName}/${name || 'my-repo'}.git`;
  const sshUrl = `git@git.jeju.network:${ownerName}/${name || 'my-repo'}.git`;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !isConnected) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const repo = await dwsClient.createRepository({
        name: name.trim(),
        description: description.trim() || undefined,
        isPrivate,
      });

      setCreatedRepo({ name: repo.name, owner: repo.owner });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create repository');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValidName = /^[a-zA-Z0-9_-]+$/.test(name);

  if (createdRepo) {
    const fullName = `${createdRepo.owner}/${createdRepo.name}`;
    const httpsUrl = `https://git.jeju.network/${fullName}.git`;
    const sshCloneUrl = `git@git.jeju.network:${fullName}.git`;

    return (
      <div className="min-h-screen p-8">
        <div className="max-w-2xl mx-auto">
          <div className="card p-8 text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-500/20 rounded-full flex items-center justify-center">
              <Check className="w-8 h-8 text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-factory-100 mb-2">Repository Created</h1>
            <p className="text-factory-400">
              Your new repository <span className="text-accent-400 font-mono">{fullName}</span> is ready.
            </p>
          </div>

          <div className="card p-6 mb-6">
            <h2 className="text-lg font-semibold text-factory-100 mb-4 flex items-center gap-2">
              <Terminal className="w-5 h-5 text-accent-400" />
              Quick Setup
            </h2>

            <div className="space-y-6">
              {/* Create new repo */}
              <div>
                <h3 className="text-sm font-medium text-factory-300 mb-3">Create a new repository on the command line</h3>
                <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm">
                  <pre className="text-factory-300 whitespace-pre-wrap">{`echo "# ${createdRepo.name}" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin ${httpsUrl}
git push -u origin main`}</pre>
                </div>
                <button 
                  onClick={() => copyToClipboard(`echo "# ${createdRepo.name}" >> README.md && git init && git add README.md && git commit -m "first commit" && git branch -M main && git remote add origin ${httpsUrl} && git push -u origin main`, 'new')}
                  className="btn btn-secondary text-sm mt-2"
                >
                  {copied === 'new' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  Copy
                </button>
              </div>

              {/* Push existing repo */}
              <div>
                <h3 className="text-sm font-medium text-factory-300 mb-3">Push an existing repository from the command line</h3>
                <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm">
                  <pre className="text-factory-300 whitespace-pre-wrap">{`git remote add origin ${httpsUrl}
git branch -M main
git push -u origin main`}</pre>
                </div>
                <button 
                  onClick={() => copyToClipboard(`git remote add origin ${httpsUrl} && git branch -M main && git push -u origin main`, 'existing')}
                  className="btn btn-secondary text-sm mt-2"
                >
                  {copied === 'existing' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  Copy
                </button>
              </div>

              {/* Clone URLs */}
              <div className="border-t border-factory-800 pt-6">
                <h3 className="text-sm font-medium text-factory-300 mb-3">Clone URLs</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-factory-500 text-sm w-12">HTTPS</span>
                    <code className="flex-1 bg-factory-900 px-3 py-2 rounded text-sm text-factory-300 font-mono">
                      {httpsUrl}
                    </code>
                    <button onClick={() => copyToClipboard(httpsUrl, 'https')} className="p-2 hover:bg-factory-800 rounded">
                      {copied === 'https' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-factory-400" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-factory-500 text-sm w-12">SSH</span>
                    <code className="flex-1 bg-factory-900 px-3 py-2 rounded text-sm text-factory-300 font-mono">
                      {sshCloneUrl}
                    </code>
                    <button onClick={() => copyToClipboard(sshCloneUrl, 'ssh')} className="p-2 hover:bg-factory-800 rounded">
                      {copied === 'ssh' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-factory-400" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <Link href={`/git/${fullName}`} className="btn btn-primary flex-1">
              Go to Repository
            </Link>
            <Link href="/git/new" className="btn btn-secondary" onClick={() => {
              setCreatedRepo(null);
              setName('');
              setDescription('');
            }}>
              Create Another
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link href="/git" className="text-factory-400 hover:text-factory-300 text-sm mb-4 inline-block">
            ← Back to Repositories
          </Link>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <GitBranch className="w-7 h-7 text-purple-400" />
            Create a New Repository
          </h1>
          <p className="text-factory-400 mt-1">
            A repository contains all project files, including the revision history.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="card p-6">
            {/* Repository Name */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-factory-300 mb-2">
                Repository name *
              </label>
              <div className="flex items-center gap-2">
                <span className="text-factory-400">{ownerName} /</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                  placeholder="my-awesome-project"
                  className="input flex-1"
                  required
                />
              </div>
              {name && !isValidName && (
                <p className="text-red-400 text-sm mt-1">
                  Only letters, numbers, hyphens, and underscores allowed
                </p>
              )}
              <p className="text-factory-500 text-sm mt-2">
                Great repository names are short and memorable.
              </p>
            </div>

            {/* Description */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-factory-300 mb-2">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short description of your project"
                className="input"
              />
            </div>

            {/* Visibility */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-factory-300 mb-3">
                Visibility
              </label>
              <div className="space-y-3">
                <label className={clsx(
                  'flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors',
                  !isPrivate
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-factory-700 hover:border-factory-600'
                )}>
                  <input
                    type="radio"
                    checked={!isPrivate}
                    onChange={() => setIsPrivate(false)}
                    className="mt-1"
                  />
                  <Globe className="w-5 h-5 text-factory-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-factory-200">Public</p>
                    <p className="text-factory-500 text-sm">
                      Anyone on the internet can see this repository.
                    </p>
                  </div>
                </label>
                <label className={clsx(
                  'flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors',
                  isPrivate
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-factory-700 hover:border-factory-600'
                )}>
                  <input
                    type="radio"
                    checked={isPrivate}
                    onChange={() => setIsPrivate(true)}
                    className="mt-1"
                  />
                  <Lock className="w-5 h-5 text-factory-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-factory-200">Private</p>
                    <p className="text-factory-500 text-sm">
                      You choose who can see and commit to this repository.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Initialize */}
            <div className="border-t border-factory-800 pt-6">
              <h3 className="text-sm font-medium text-factory-300 mb-4">Initialize this repository with:</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addReadme}
                    onChange={(e) => setAddReadme(e.target.checked)}
                    className="rounded border-factory-600 bg-factory-800 text-accent-500 focus:ring-accent-500"
                  />
                  <FileCode className="w-5 h-5 text-factory-400" />
                  <span className="text-factory-300">Add a README file</span>
                </label>
                
                <div className="flex items-center gap-3">
                  <label className="text-factory-300">License:</label>
                  <select
                    value={license}
                    onChange={(e) => setLicense(e.target.value)}
                    className="input w-auto"
                  >
                    <option value="">None</option>
                    <option value="MIT">MIT License</option>
                    <option value="Apache-2.0">Apache 2.0</option>
                    <option value="GPL-3.0">GPL v3</option>
                    <option value="BSD-3-Clause">BSD 3-Clause</option>
                    <option value="CC0-1.0">CC0 1.0 Universal</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Git Remote Setup Info */}
          <div className="card p-6">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-factory-200 mb-2">Git Remote Configuration</h3>
                <p className="text-factory-500 text-sm mb-4">
                  After creating your repository, configure git to push to Factory:
                </p>
                <div className="bg-factory-900 rounded-lg p-3 font-mono text-xs">
                  <pre className="text-factory-400"># Add Factory as a remote
git remote add factory {repoUrl}

# Push to Factory
git push factory main</pre>
                </div>
                <p className="text-factory-500 text-sm mt-3">
                  You can use either HTTPS or SSH to authenticate. SSH keys can be added in your profile settings.
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-4">
            <Link href="/git" className="btn btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={!name.trim() || !isValidName || isSubmitting || !isConnected}
              className="btn btn-primary"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create repository'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}



