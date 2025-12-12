'use client'

import { Users, Shield, Code, Coins, Heart } from 'lucide-react'
import type { CouncilStatus as CouncilStatusType } from '@/config/api'

const ROLE_ICONS: Record<string, typeof Shield> = {
  Treasury: Coins,
  Code: Code,
  Community: Heart,
  Security: Shield,
}

interface CouncilStatusProps {
  status: CouncilStatusType | null
  loading?: boolean
}

export function CouncilStatus({ status, loading }: CouncilStatusProps) {
  if (loading) {
    return (
      <div className="card-static p-3 sm:p-4 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
        <div className="space-y-1.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-7 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="card-static p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          <Users size={16} style={{ color: 'var(--color-accent)' }} />
          <span className="font-medium text-sm">Council</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Not available
        </p>
      </div>
    )
  }

  return (
    <div className="card-static p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 sm:mb-3">
        <Users size={16} style={{ color: 'var(--color-accent)' }} />
        <span className="font-medium text-sm">Council</span>
      </div>

      {/* On mobile: 2 column grid, on larger: vertical list */}
      <div className="grid grid-cols-2 sm:grid-cols-1 gap-1.5 sm:space-y-1.5 sm:gap-0">
        {status.agents.map((agent) => {
          const Icon = ROLE_ICONS[agent.role] || Shield
          return (
            <div 
              key={agent.role}
              className="flex items-center gap-1.5 sm:gap-2 p-1.5 sm:p-2 rounded text-xs sm:text-sm"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <Icon size={12} className="sm:w-3.5 sm:h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
              <span className="truncate">{agent.role}</span>
            </div>
          )
        })}
      </div>

      <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t text-xs" style={{ borderColor: 'var(--border)' }}>
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-tertiary)' }}>Voting</span>
          <span>{status.votingPeriod}</span>
        </div>
        <div className="flex justify-between mt-0.5 sm:mt-1">
          <span style={{ color: 'var(--text-tertiary)' }}>Grace</span>
          <span>{status.gracePeriod}</span>
        </div>
      </div>
    </div>
  )
}
