'use client'

import { useState } from 'react'
import { File, Image, FileText, FileCode, Film, Music, Archive, ExternalLink, Copy, Trash2, CheckCircle } from 'lucide-react'
import { type Pin, deletePin } from '@/config/api'
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
    <div className="card p-4 group">
      <div className="flex items-start gap-4">
        {/* File Icon */}
        <div className="file-icon flex-shrink-0">
          <Icon size={24} className="text-storage-primary" />
        </div>

        {/* File Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-medium truncate" title={pin.name}>
              {pin.name}
            </h3>
            <span className={statusColors[pin.status]}>{pin.status}</span>
          </div>
          
          <p className="text-xs font-mono truncate mb-2" style={{ color: 'var(--text-tertiary)' }} title={pin.cid}>
            {pin.cid}
          </p>
          
          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>{formatSize(pin.info?.sizeBytes)}</span>
            <span>•</span>
            <span>{formatDate(pin.created)}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={copyCid}
          className="btn-ghost flex-1 flex items-center justify-center gap-2 py-2 text-sm"
        >
          {copied ? <CheckCircle size={16} className="text-storage-success" /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy CID'}
        </button>
        
        <a
          href={gatewayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost flex-1 flex items-center justify-center gap-2 py-2 text-sm"
        >
          <ExternalLink size={16} />
          View
        </a>
        
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="btn-ghost flex items-center justify-center p-2 text-storage-error hover:bg-storage-error/10"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}


