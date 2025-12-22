'use client'

import { clsx } from 'clsx'
import {
  AlertCircle,
  Check,
  Copy,
  FileText,
  FileUp,
  Info,
  Loader2,
  Package,
  Terminal,
  Upload,
} from 'lucide-react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { dwsClient } from '@/lib/services/dws'

type PublishMethod = 'cli' | 'upload'

export default function PublishPackagePage() {
  const { isConnected } = useAccount()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [method, setMethod] = useState<PublishMethod>('cli')
  const [tarballFile, setTarballFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setTarballFile(file)
      // Try to parse package name from filename
      const match = file.name.match(/^(.+)-(\d+\.\d+\.\d+.*?)\.tgz$/)
      if (match) {
        setName(match[1])
        setVersion(match[2])
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tarballFile || !name || !version || !isConnected) return

    setIsSubmitting(true)
    setError(null)

    try {
      await dwsClient.publishPackage(tarballFile, {
        name,
        version,
        description: description || undefined,
      })

      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish package')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen p-8">
        <div className="max-w-2xl mx-auto">
          <div className="card p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-500/20 rounded-full flex items-center justify-center">
              <Check className="w-8 h-8 text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-factory-100 mb-2">
              Package Published
            </h1>
            <p className="text-factory-400 mb-6">
              <span className="text-accent-400 font-mono">
                {name}@{version}
              </span>{' '}
              is now available in the registry.
            </p>
            <div className="flex gap-4 justify-center">
              <Link href={`/packages/${name}`} className="btn btn-primary">
                View Package
              </Link>
              <Link href="/packages" className="btn btn-secondary">
                Browse Packages
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link
            href="/packages"
            className="text-factory-400 hover:text-factory-300 text-sm mb-4 inline-block"
          >
            ← Back to Packages
          </Link>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Package className="w-7 h-7 text-orange-400" />
            Publish Package
          </h1>
          <p className="text-factory-400 mt-1">
            Publish your package to the Jeju decentralized registry
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
              Upload Tarball
            </button>
          </div>
        </div>

        {method === 'cli' ? (
          <div className="space-y-6">
            {/* Registry Setup */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Terminal className="w-5 h-5 text-accent-400" />
                1. Configure Registry
              </h2>
              <p className="text-factory-400 text-sm mb-4">
                Add the Jeju registry to your project. Create or edit{' '}
                <code className="text-accent-400">.npmrc</code>:
              </p>
              <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm mb-3">
                <pre className="text-factory-300">
                  # For scoped packages (@jeju/*)
                  @jeju:registry=https://pkg.jejunetwork.org # Or for all
                  packages registry=https://pkg.jejunetwork.org
                </pre>
              </div>
              <button
                onClick={() =>
                  copyToClipboard(
                    '@jeju:registry=https://pkg.jejunetwork.org',
                    'npmrc',
                  )
                }
                className="btn btn-secondary text-sm"
              >
                {copied === 'npmrc' ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                Copy Config
              </button>
            </div>

            {/* Authentication */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-accent-400" />
                2. Authenticate
              </h2>
              <p className="text-factory-400 text-sm mb-4">
                Login with your wallet to publish packages:
              </p>
              <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm mb-3">
                <pre className="text-factory-300">
                  # Using Jeju CLI bun jeju login # Or using npm with wallet
                  auth npm login --registry=https://pkg.jejunetwork.org
                </pre>
              </div>
              <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-factory-300">
                    Authentication is based on wallet signatures. Your publish
                    permissions are tied to your connected address.
                  </p>
                </div>
              </div>
            </div>

            {/* Publish */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-accent-400" />
                3. Publish
              </h2>
              <p className="text-factory-400 text-sm mb-4">
                From your package directory, run:
              </p>
              <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm mb-3">
                <pre className="text-factory-300">
                  # Using bun bun publish # Using npm npm publish
                  --registry=https://pkg.jejunetwork.org # Using Jeju CLI (with
                  signing) bun jeju publish
                </pre>
              </div>
              <button
                onClick={() => copyToClipboard('bun jeju publish', 'publish')}
                className="btn btn-secondary text-sm"
              >
                {copied === 'publish' ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                Copy Command
              </button>
            </div>

            {/* Package.json Requirements */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-accent-400" />
                Package Requirements
              </h2>
              <p className="text-factory-400 text-sm mb-4">
                Your <code className="text-accent-400">package.json</code>{' '}
                should include:
              </p>
              <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm">
                <pre className="text-factory-300">{`{
  "name": "@jeju/my-package",
  "version": "1.0.0",
  "description": "My awesome package",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "license": "MIT",
  "author": "your-name.eth",
  "repository": {
    "type": "git",
    "url": "https://git.jejunetwork.org/username/my-package"
  }
}`}</pre>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Upload Area */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4">
                Upload Tarball
              </h2>
              <div
                className={clsx(
                  'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
                  tarballFile
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-factory-700 hover:border-factory-600',
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept=".tgz,.tar.gz"
                  className="hidden"
                />
                {tarballFile ? (
                  <>
                    <Check className="w-12 h-12 mx-auto mb-4 text-green-400" />
                    <p className="text-factory-200 font-medium">
                      {tarballFile.name}
                    </p>
                    <p className="text-factory-500 text-sm mt-1">
                      {(tarballFile.size / 1024).toFixed(1)} KB
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setTarballFile(null)
                        setName('')
                        setVersion('')
                      }}
                      className="mt-4 text-sm text-factory-400 hover:text-factory-200"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <FileUp className="w-12 h-12 mx-auto mb-4 text-factory-500" />
                    <p className="text-factory-300 mb-2">
                      Click or drag to upload your package tarball
                    </p>
                    <p className="text-factory-500 text-sm">
                      Supports .tgz files created with{' '}
                      <code className="text-accent-400">npm pack</code>
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Package Info */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-factory-100 mb-4">
                Package Information
              </h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-factory-300 mb-2">
                      Package Name *
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="@jeju/my-package"
                      className="input"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-factory-300 mb-2">
                      Version *
                    </label>
                    <input
                      type="text"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="1.0.0"
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
                    placeholder="A short description of your package"
                    rows={3}
                    className="input resize-none"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-400">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-4">
              <Link href="/packages" className="btn btn-secondary">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={
                  !tarballFile ||
                  !name ||
                  !version ||
                  isSubmitting ||
                  !isConnected
                }
                className="btn btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Publish Package
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
