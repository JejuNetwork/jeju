'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Info, Zap, Shield, Clock } from 'lucide-react'
import { UploadZone } from '@/src/components/UploadZone'
import { type UploadResult } from '@/src/config/api'

export default function UploadPage() {
  const [uploads, setUploads] = useState<UploadResult[]>([])

  const handleUploadComplete = (result: UploadResult) => {
    setUploads(prev => [result, ...prev])
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5 sm:space-y-6 md:space-y-8 lg:space-y-10">
      {/* Header */}
      <div>
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm font-semibold mb-4 sm:mb-5 transition-colors active:scale-[0.98] hover:text-storage-primary"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={16} />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight">
          Upload Files
        </h1>
        <p className="mt-2 sm:mt-3 text-sm sm:text-base md:text-lg" style={{ color: 'var(--text-secondary)' }}>
          Drag and drop files to store them on the decentralized web
        </p>
      </div>

      {/* Upload Zone */}
      <UploadZone onUploadComplete={handleUploadComplete} />

      {/* Upload Tips */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
        <div className="card-static p-4 sm:p-5 md:p-6 flex items-start gap-3 sm:gap-4 active:scale-[0.98] transition-all duration-300">
          <div className="p-2.5 rounded-xl bg-storage-warning/15 flex-shrink-0">
            <Zap size={20} className="text-storage-warning" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm sm:text-base">Fast Uploads</h3>
            <p className="text-xs sm:text-sm mt-1 sm:mt-1.5 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Files are uploaded to the fastest available backend automatically
            </p>
          </div>
        </div>
        
        <div className="card-static p-4 sm:p-5 md:p-6 flex items-start gap-3 sm:gap-4 active:scale-[0.98] transition-all duration-300">
          <div className="p-2.5 rounded-xl bg-storage-success/15 flex-shrink-0">
            <Shield size={20} className="text-storage-success" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm sm:text-base">Content Addressed</h3>
            <p className="text-xs sm:text-sm mt-1 sm:mt-1.5 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Files are identified by their content hash (CID) for integrity
            </p>
          </div>
        </div>
        
        <div className="card-static p-4 sm:p-5 md:p-6 flex items-start gap-3 sm:gap-4 active:scale-[0.98] transition-all duration-300">
          <div className="p-2.5 rounded-xl bg-storage-accent/15 flex-shrink-0">
            <Clock size={20} className="text-storage-accent" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm sm:text-base">Persistent</h3>
            <p className="text-xs sm:text-sm mt-1 sm:mt-1.5 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Files remain available as long as they are pinned
            </p>
          </div>
        </div>
      </div>

      {/* Recent Uploads Section */}
      {uploads.length > 0 && (
        <section>
          <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4">
            Session Uploads ({uploads.length})
          </h2>
          <div className="space-y-2 sm:space-y-3">
            {uploads.map((upload) => (
              <div 
                key={upload.requestId}
                className="card-static p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm sm:text-base truncate">{upload.name}</p>
                  <p className="text-xs font-mono mt-1 truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {upload.cid}
                  </p>
                </div>
                
                <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                  <span className="badge-primary">{upload.backend}</span>
                  <a
                    href={upload.gatewayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost text-sm py-2 px-3 sm:px-4"
                  >
                    View
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
        <Info size={18} className="text-storage-primary flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-semibold text-sm mb-1">About Storage Providers</h4>
          <p className="text-xs sm:text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Your files are automatically routed to the best available storage provider. 
            IPFS provides decentralized content addressing, while cloud providers offer 
            fast CDN-backed access. Configure your preferences in Settings.
          </p>
        </div>
      </div>
    </div>
  )
}

