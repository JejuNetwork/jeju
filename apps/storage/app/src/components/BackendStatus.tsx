'use client'

import { Cloud, Server, Database, CheckCircle, XCircle, Loader2 } from 'lucide-react'

interface Backend {
  name: string
  enabled: boolean
  priority: number
}

interface BackendStatusProps {
  backends: Backend[]
  health: Record<string, boolean>
  loading?: boolean
}

const BACKEND_ICONS: Record<string, React.ElementType> = {
  ipfs: Server,
  cloud: Cloud,
  arweave: Database,
}

const BACKEND_LABELS: Record<string, string> = {
  ipfs: 'IPFS Network',
  cloud: 'Cloud Storage',
  arweave: 'Arweave Permanent',
}

export function BackendStatus({ backends, health, loading }: BackendStatusProps) {
  if (loading) {
    return (
      <div className="card-static p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="animate-spin" size={18} />
          <span className="text-sm sm:text-base">Loading backends...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 sm:space-y-3">
      {backends.map((backend) => {
        const Icon = BACKEND_ICONS[backend.name] || Server
        const isHealthy = health[backend.name]
        
        return (
          <div
            key={backend.name}
            className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl transition-all"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderLeft: `3px solid ${isHealthy ? 'var(--color-success)' : 'var(--color-error)'}`,
            }}
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            >
              <Icon size={18} className={`${isHealthy ? 'text-storage-primary' : 'text-storage-error'} sm:w-5 sm:h-5`} />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <span className="font-medium text-sm sm:text-base truncate">{BACKEND_LABELS[backend.name] || backend.name}</span>
                {backend.priority === 0 && (
                  <span className="badge-primary text-[10px] sm:text-xs">Primary</span>
                )}
              </div>
              <p className="text-[10px] sm:text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Priority: {backend.priority + 1}
              </p>
            </div>
            
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              {isHealthy ? (
                <>
                  <CheckCircle size={16} className="text-storage-success sm:w-[18px] sm:h-[18px]" />
                  <span className="text-xs sm:text-sm font-medium text-storage-success hidden xs:inline">Online</span>
                </>
              ) : (
                <>
                  <XCircle size={16} className="text-storage-error sm:w-[18px] sm:h-[18px]" />
                  <span className="text-xs sm:text-sm font-medium text-storage-error hidden xs:inline">Offline</span>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

