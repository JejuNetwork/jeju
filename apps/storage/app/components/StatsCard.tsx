'use client'

import { HardDrive, FileText, Server, Zap } from 'lucide-react'

interface StatsCardProps {
  icon: 'storage' | 'files' | 'backends' | 'speed'
  label: string
  value: string | number
  subValue?: string
  trend?: { value: number; positive: boolean }
}

const ICONS = {
  storage: HardDrive,
  files: FileText,
  backends: Server,
  speed: Zap,
}

const ICON_COLORS = {
  storage: 'from-storage-primary to-storage-accent',
  files: 'from-storage-accent to-storage-hot',
  backends: 'from-storage-success to-storage-primary',
  speed: 'from-storage-warning to-storage-hot',
}

export function StatsCard({ icon, label, value, subValue, trend }: StatsCardProps) {
  const Icon = ICONS[icon]

  return (
    <div className="stat-card group">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${ICON_COLORS[icon]} transition-transform group-hover:scale-110`}>
          <Icon size={22} className="text-dark-bg" />
        </div>
        
        {trend && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${trend.positive ? 'bg-storage-success/10 text-storage-success' : 'bg-storage-error/10 text-storage-error'}`}>
            {trend.positive ? '+' : ''}{trend.value}%
          </span>
        )}
      </div>
      
      <div className="mt-4">
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
        {subValue && (
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{subValue}</p>
        )}
      </div>
    </div>
  )
}


