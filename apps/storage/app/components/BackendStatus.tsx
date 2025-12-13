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
      <div className="card-static p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="animate-spin" size={20} />
          <span>Loading backends...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {backends.map((backend) => {
        const Icon = BACKEND_ICONS[backend.name] || Server
        const isHealthy = health[backend.name]
        
        return (
          <div
            key={backend.name}
            className="flex items-center gap-4 p-4 rounded-xl transition-all"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderLeft: `3px solid ${isHealthy ? 'var(--color-success)' : 'var(--color-error)'}`,
            }}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            >
              <Icon size={20} className={isHealthy ? 'text-storage-primary' : 'text-storage-error'} />
            </div>
            
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{BACKEND_LABELS[backend.name] || backend.name}</span>
                {backend.priority === 0 && (
                  <span className="badge-primary text-xs">Primary</span>
                )}
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Priority: {backend.priority + 1}
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              {isHealthy ? (
                <>
                  <CheckCircle size={18} className="text-storage-success" />
                  <span className="text-sm font-medium text-storage-success">Online</span>
                </>
              ) : (
                <>
                  <XCircle size={18} className="text-storage-error" />
                  <span className="text-sm font-medium text-storage-error">Offline</span>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}






