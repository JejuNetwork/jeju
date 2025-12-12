'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileUp, Loader2, CheckCircle, XCircle, File } from 'lucide-react'
import { uploadFile, type UploadResult } from '@/config/api'
import { toast } from 'sonner'

interface UploadedFile {
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  result?: UploadResult
  error?: string
}

interface UploadZoneProps {
  onUploadComplete?: (result: UploadResult) => void
  compact?: boolean
}

export function UploadZone({ onUploadComplete, compact = false }: UploadZoneProps) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const processFile = async (file: File, index: number) => {
    setFiles(prev => prev.map((f, i) => 
      i === index ? { ...f, status: 'uploading' } : f
    ))

    const result = await uploadFile(file)
    
    setFiles(prev => prev.map((f, i) => 
      i === index ? { ...f, status: 'success', result } : f
    ))
    
    toast.success(`Uploaded ${file.name}`, {
      description: `CID: ${result.cid.slice(0, 12)}...`,
    })
    
    onUploadComplete?.(result)
    return result
  }

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newFiles: UploadedFile[] = acceptedFiles.map(file => ({
      file,
      status: 'pending' as const,
    }))

    setFiles(prev => [...prev, ...newFiles])
    setIsUploading(true)

    const startIndex = files.length

    for (let i = 0; i < acceptedFiles.length; i++) {
      await processFile(acceptedFiles[i], startIndex + i)
    }

    setIsUploading(false)
  }, [files.length, onUploadComplete])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: isUploading,
  })

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const clearCompleted = () => {
    setFiles(prev => prev.filter(f => f.status !== 'success'))
  }

  if (compact) {
    return (
      <div
        {...getRootProps()}
        className={`upload-zone p-4 ${isDragActive ? 'active' : ''} ${isUploading ? 'opacity-70 cursor-wait' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="flex items-center gap-3">
          {isUploading ? (
            <Loader2 size={24} className="animate-spin text-storage-primary" />
          ) : (
            <Upload size={24} className="text-storage-primary" />
          )}
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {isDragActive ? 'Drop files here' : 'Drag files or click to upload'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Main Upload Zone */}
      <div
        {...getRootProps()}
        className={`upload-zone ${isDragActive ? 'active' : ''} ${isUploading ? 'opacity-70 cursor-wait' : ''}`}
      >
        <input {...getInputProps()} />
        
        <div className="relative">
          {/* Animated rings */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-32 h-32 rounded-full border-2 border-storage-primary/20 animate-ping" style={{ animationDuration: '2s' }} />
          </div>
          
          <div className={`relative z-10 w-24 h-24 md:w-28 md:h-28 rounded-2xl flex items-center justify-center mx-auto mb-6 transition-transform ${isDragActive ? 'scale-110' : ''}`}
            style={{ background: 'linear-gradient(135deg, rgba(0, 229, 255, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%)' }}
          >
            {isUploading ? (
              <Loader2 size={48} className="animate-spin text-storage-primary" />
            ) : (
              <FileUp size={48} className="text-storage-primary" />
            )}
          </div>
        </div>

        <h3 className="text-xl md:text-2xl font-bold mb-2">
          {isDragActive ? 'Drop your files here' : 'Upload Files'}
        </h3>
        <p className="text-sm md:text-base mb-4" style={{ color: 'var(--text-secondary)' }}>
          Drag and drop files, or click to browse
        </p>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Files are stored on IPFS • Permanent • Decentralized
        </p>
      </div>

      {/* Uploaded Files List */}
      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Uploads ({files.length})</h4>
            {files.some(f => f.status === 'success') && (
              <button
                onClick={clearCompleted}
                className="text-sm font-medium hover:underline"
                style={{ color: 'var(--text-secondary)' }}
              >
                Clear completed
              </button>
            )}
          </div>
          
          <div className="space-y-2">
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-xl border transition-colors"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  borderColor: f.status === 'success' ? 'var(--color-success)' : 
                               f.status === 'error' ? 'var(--color-error)' : 'var(--border)',
                }}
              >
                <div className="file-icon w-10 h-10 text-lg">
                  <File size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{f.file.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {formatSize(f.file.size)}
                    {f.result && (
                      <span> • <span className="font-mono">{f.result.cid.slice(0, 16)}...</span></span>
                    )}
                  </p>
                </div>
                <div className="flex-shrink-0">
                  {f.status === 'pending' && (
                    <span className="badge-info">Waiting</span>
                  )}
                  {f.status === 'uploading' && (
                    <Loader2 size={20} className="animate-spin text-storage-primary" />
                  )}
                  {f.status === 'success' && (
                    <CheckCircle size={20} className="text-storage-success" />
                  )}
                  {f.status === 'error' && (
                    <XCircle size={20} className="text-storage-error" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}




