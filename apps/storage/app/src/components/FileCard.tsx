'use client'

import { useState } from 'react'
import { File, Image, FileText, FileCode, Film, Music, Archive, ExternalLink, Copy, Trash2, CheckCircle } from 'lucide-react'
import { type Pin, deletePin } from '@/src/config/api'
import { toast } from 'sonner'

interface FileCardProps {
  pin: Pin
  onDelete?: () => void
}

const FILE_ICONS: Record<string, React.ElementType> = {
  image: Image,
  video: Film,
  audio: Music,
  text: FileText,
  code: FileCode,
  archive: Archive,
  default: File,
}

function getFileType(name: string): keyof typeof FILE_ICONS {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio'
  if (['txt', 'md', 'pdf', 'doc', 'docx'].includes(ext)) return 'text'
  if (['js', 'ts', 'jsx', 'tsx', 'json', 'html', 'css', 'py', 'rs', 'go', 'sol'].includes(ext)) return 'code'
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return 'archive'
  
  return 'default'
}

function formatSize(bytes?: number) {
  if (!bytes) return 'Unknown'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  
  return date.toLocaleDateString()
}

export function FileCard({ pin, onDelete }: FileCardProps) {
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const fileType = getFileType(pin.name)
  const Icon = FILE_ICONS[fileType]
  const gatewayUrl = `https://ipfs.io/ipfs/${pin.cid}`

  const copyCid = async () => {
    await navigator.clipboard.writeText(pin.cid)
    setCopied(true)
    toast.success('CID copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDelete = async () => {
    setDeleting(true)
    await deletePin(pin.requestId)
    toast.success('File unpinned')
    onDelete?.()
    setDeleting(false)
  }

  const statusColors: Record<string, string> = {
    pinned: 'badge-success',
    queued: 'badge-warning',
    unpinned: 'badge-info',
    failed: 'badge-error',
  }

  return (
    <div className="card p-3 sm:p-4 group active:scale-[0.99] transition-transform">
      <div className="flex items-start gap-3 sm:gap-4">
        {/* File Icon */}
        <div className="file-icon w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 flex-shrink-0">
          <Icon size={20} className="text-storage-primary sm:w-6 sm:h-6" />
        </div>

        {/* File Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-medium text-sm sm:text-base truncate" title={pin.name}>
              {pin.name}
            </h3>
            <span className={`${statusColors[pin.status]} flex-shrink-0`}>{pin.status}</span>
          </div>
          
          <p className="text-[10px] sm:text-xs font-mono truncate mb-1.5 sm:mb-2" style={{ color: 'var(--text-tertiary)' }} title={pin.cid}>
            {pin.cid}
          </p>
          
          <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>{formatSize(pin.info?.sizeBytes)}</span>
            <span>•</span>
            <span>{formatDate(pin.created)}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2 mt-3 sm:mt-4 pt-2.5 sm:pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={copyCid}
          className="btn-ghost flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2 text-xs sm:text-sm active:scale-95"
        >
          {copied ? <CheckCircle size={14} className="text-storage-success sm:w-4 sm:h-4" /> : <Copy size={14} className="sm:w-4 sm:h-4" />}
          <span className="hidden xs:inline">{copied ? 'Copied' : 'Copy'}</span>
          <span className="xs:hidden">{copied ? '✓' : 'CID'}</span>
        </button>
        
        <a
          href={gatewayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2 text-xs sm:text-sm active:scale-95"
        >
          <ExternalLink size={14} className="sm:w-4 sm:h-4" />
          View
        </a>
        
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="btn-ghost flex items-center justify-center p-2 text-storage-error hover:bg-storage-error/10 active:scale-95"
          aria-label="Delete file"
        >
          <Trash2 size={14} className="sm:w-4 sm:h-4" />
        </button>
      </div>
    </div>
  )
}

