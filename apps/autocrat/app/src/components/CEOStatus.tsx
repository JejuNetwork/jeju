'use client'

import { Bot } from 'lucide-react'
import type { CEOStatus as CEOStatusType } from '@/config/api'

interface CEOStatusProps {
  status: CEOStatusType | null
  loading?: boolean
}

export function CEOStatus({ status, loading }: CEOStatusProps) {
  if (loading) {
    return (
      <div className="card-static p-3 sm:p-4 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
      </div>
    )
  }

  if (!status) {
    return (
      <div className="card-static p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          <Bot size={16} style={{ color: 'var(--color-primary)' }} />
          <span className="font-medium text-sm">AI CEO</span>
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
        <Bot size={16} style={{ color: 'var(--color-primary)' }} />
        <span className="font-medium text-sm">AI CEO</span>
      </div>

      <div className="mb-2 sm:mb-3">
        <div className="font-medium text-sm">{status.currentModel.name || 'Eliza'}</div>
        <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
          {status.currentModel.modelId}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 text-xs sm:text-sm">
        <div>
          <div style={{ color: 'var(--text-tertiary)' }}>Decisions</div>
          <div className="font-medium">{status.stats.totalDecisions}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-tertiary)' }}>Approval</div>
          <div className="font-medium" style={{ color: 'var(--color-success)' }}>
            {status.stats.approvalRate}
          </div>
        </div>
      </div>
    </div>
  )
}
