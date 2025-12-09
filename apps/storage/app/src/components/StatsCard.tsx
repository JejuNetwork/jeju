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
    <div className="stat-card group active:scale-[0.98] transition-all duration-300">
      <div className="flex items-start justify-between gap-2">
        <div className={`w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-lg sm:rounded-xl flex items-center justify-center bg-gradient-to-br ${ICON_COLORS[icon]} transition-transform duration-300 flex-shrink-0`}>
          <Icon size={18} className="sm:w-5 sm:h-5 md:w-[22px] md:h-[22px]" style={{ color: 'var(--text-on-primary)' }} />
        </div>
        
        {trend && (
          <span className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg ${trend.positive ? 'bg-storage-success/15 text-storage-success' : 'bg-storage-error/15 text-storage-error'}`}>
            {trend.positive ? '+' : ''}{trend.value}%
          </span>
        )}
      </div>
      
      <div className="mt-3 sm:mt-4 md:mt-5">
        <p className="stat-label text-xs sm:text-sm">{label}</p>
        <p className="stat-value text-lg sm:text-xl md:text-2xl lg:text-3xl">{value}</p>
        {subValue && (
          <p className="text-[10px] sm:text-xs mt-1 sm:mt-1.5 truncate" style={{ color: 'var(--text-tertiary)' }}>{subValue}</p>
        )}
      </div>
    </div>
  )
}

