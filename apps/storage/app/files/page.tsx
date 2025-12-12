'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search, Filter, Grid, List, Upload, Loader2 } from 'lucide-react'
import { FileCard } from '@/components/FileCard'
import { fetchPins, type Pin } from '@/config/api'

type ViewMode = 'grid' | 'list'
type StatusFilter = 'all' | 'pinned' | 'queued' | 'unpinned'

export default function FilesPage() {
  const [pins, setPins] = useState<Pin[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const limit = 12

  const loadPins = async () => {
    setLoading(true)
    const params: { status?: string; limit: number; offset: number; cid?: string } = {
      limit,
      offset: page * limit,
    }
    
    if (statusFilter !== 'all') {
      params.status = statusFilter
    }
    
    if (searchQuery) {
      params.cid = searchQuery
    }
    
    const data = await fetchPins(params).catch(() => ({ count: 0, results: [] }))
    setPins(data.results)
    setTotalCount(data.count)
    setLoading(false)
  }

  useEffect(() => {
    loadPins()
  }, [page, statusFilter, searchQuery])

  const handleDelete = () => {
    loadPins()
  }

  const totalPages = Math.ceil(totalCount / limit)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link 
            href="/" 
            className="inline-flex items-center gap-2 text-sm font-medium mb-2 hover:underline"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ArrowLeft size={16} />
            Back
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold">Files</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {totalCount} file{totalCount !== 1 ? 's' : ''} stored
          </p>
        </div>
        
        <Link href="/upload" className="btn-primary flex items-center gap-2 w-full sm:w-auto justify-center">
          <Upload size={18} />
          Upload
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            placeholder="Search by CID..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setPage(0)
            }}
            className="input pl-10"
          />
        </div>
        
        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <Filter size={18} style={{ color: 'var(--text-tertiary)' }} />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter)
              setPage(0)
            }}
            className="input w-auto min-w-[140px]"
          >
            <option value="all">All Status</option>
            <option value="pinned">Pinned</option>
            <option value="queued">Queued</option>
            <option value="unpinned">Unpinned</option>
          </select>
        </div>
        
        {/* View Toggle */}
        <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-3 transition-colors ${viewMode === 'grid' ? 'bg-storage-primary/10' : ''}`}
            style={{ backgroundColor: viewMode === 'grid' ? 'rgba(0, 229, 255, 0.1)' : 'var(--surface)' }}
          >
            <Grid size={18} className={viewMode === 'grid' ? 'text-storage-primary' : ''} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-3 transition-colors border-l`}
            style={{ 
              backgroundColor: viewMode === 'list' ? 'rgba(0, 229, 255, 0.1)' : 'var(--surface)',
              borderColor: 'var(--border)',
            }}
          >
            <List size={18} className={viewMode === 'list' ? 'text-storage-primary' : ''} />
          </button>
        </div>
      </div>

      {/* Files Grid/List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-storage-primary" />
        </div>
      ) : pins.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📂</div>
          <h3 className="text-xl font-bold mb-2">No files found</h3>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            {searchQuery || statusFilter !== 'all' 
              ? 'Try adjusting your filters'
              : 'Upload your first file to get started'
            }
          </p>
          <Link href="/upload" className="btn-primary inline-flex items-center gap-2">
            <Upload size={18} />
            Upload Files
          </Link>
        </div>
      ) : (
        <div className={viewMode === 'grid' 
          ? 'grid sm:grid-cols-2 lg:grid-cols-3 gap-4' 
          : 'space-y-3'
        }>
          {pins.map((pin) => (
            <FileCard key={pin.requestId} pin={pin} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn-ghost px-4 py-2 disabled:opacity-50"
          >
            Previous
          </button>
          
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number
              if (totalPages <= 5) {
                pageNum = i
              } else if (page < 3) {
                pageNum = i
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 5 + i
              } else {
                pageNum = page - 2 + i
              }
              
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-10 h-10 rounded-lg font-medium transition-colors ${
                    page === pageNum ? 'bg-storage-primary text-dark-bg' : 'hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  {pageNum + 1}
                </button>
              )
            })}
          </div>
          
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="btn-ghost px-4 py-2 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}




