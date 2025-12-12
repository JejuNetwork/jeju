'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Info, Zap, Shield, Clock } from 'lucide-react'
import { UploadZone } from '@/components/UploadZone'
import { type UploadResult } from '@/config/api'

export default function UploadPage() {
  const [uploads, setUploads] = useState<UploadResult[]>([])

  const handleUploadComplete = (result: UploadResult) => {
    setUploads(prev => [result, ...prev])
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm font-medium mb-4 hover:underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={16} />
          Back to Dashboard
        </Link>
        <h1 className="text-3xl md:text-4xl font-bold">Upload Files</h1>
        <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>
          Drag and drop files to store them on the decentralized web
        </p>
      </div>

      {/* Upload Zone */}
      <UploadZone onUploadComplete={handleUploadComplete} />

      {/* Upload Tips */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card-static p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <Zap size={18} className="text-storage-warning" />
          </div>
          <div>
            <h3 className="font-medium text-sm">Fast Uploads</h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Files are uploaded to the fastest available backend automatically
            </p>
          </div>
        </div>
        
        <div className="card-static p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <Shield size={18} className="text-storage-success" />
          </div>
          <div>
            <h3 className="font-medium text-sm">Content Addressed</h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Files are identified by their content hash (CID) for integrity
            </p>
          </div>
        </div>
        
        <div className="card-static p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <Clock size={18} className="text-storage-accent" />
          </div>
          <div>
            <h3 className="font-medium text-sm">Persistent</h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Files remain available as long as they are pinned
            </p>
          </div>
        </div>
      </div>

      {/* Recent Uploads Section */}
      {uploads.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4">Session Uploads ({uploads.length})</h2>
          <div className="space-y-3">
            {uploads.map((upload) => (
              <div 
                key={upload.requestId}
                className="card-static p-4 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{upload.name}</p>
                  <p className="text-xs font-mono mt-1 truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {upload.cid}
                  </p>
                </div>
                
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="badge-primary">{upload.backend}</span>
                  <a
                    href={upload.gatewayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost text-sm py-2 px-4"
                  >
                    View File
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Info Box */}
      <div 
        className="rounded-xl p-4 flex items-start gap-3"
        style={{ backgroundColor: 'rgba(0, 229, 255, 0.1)', border: '1px solid rgba(0, 229, 255, 0.2)' }}
      >
        <Info size={20} className="text-storage-primary flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-medium text-sm mb-1">About Storage Providers</h4>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Your files are automatically routed to the best available storage provider. 
            IPFS provides decentralized content addressing, while cloud providers offer 
            fast CDN-backed access. Configure your preferences in Settings.
          </p>
        </div>
      </div>
    </div>
  )
}




