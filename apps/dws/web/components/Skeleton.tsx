/**
 * Skeleton Loading Components
 */

import type { CSSProperties, ReactNode } from 'react'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  variant?: 'text' | 'rectangular' | 'circular'
  style?: CSSProperties
  className?: string
}

export function Skeleton({
  width = '100%',
  height = '1em',
  variant = 'rectangular',
  style,
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius:
          variant === 'circular'
            ? '50%'
            : variant === 'text'
              ? '4px'
              : 'var(--radius-sm)',
        ...style,
      }}
    />
  )
}

export function SkeletonText({
  lines = 3,
  gap = '0.5rem',
}: {
  lines?: number
  gap?: string
}) {
  return (
    <div style={{ display: 'grid', gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={`skeleton-text-line-${i}`}
          variant="text"
          width={i === lines - 1 ? '80%' : '100%'}
          height="1rem"
        />
      ))}
    </div>
  )
}

export function SkeletonCard({
  children,
  loading,
}: {
  children: ReactNode
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="card">
        <div className="card-header">
          <Skeleton width={150} height={24} />
        </div>
        <SkeletonText lines={4} />
      </div>
    )
  }
  return <>{children}</>
}

export function SkeletonTable({
  rows = 5,
  cols = 4,
}: {
  rows?: number
  cols?: number
}) {
  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={`skeleton-th-${i}`}>
                <Skeleton width={80} height={16} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, ri) => (
            <tr key={`skeleton-row-${ri}`}>
              {Array.from({ length: cols }).map((_, ci) => (
                <td key={`skeleton-cell-${ri}-${ci}`}>
                  <Skeleton width={ci === 0 ? 120 : 80} height={16} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SkeletonStatCard() {
  return (
    <div className="stat-card">
      <Skeleton
        width={52}
        height={52}
        style={{ borderRadius: 'var(--radius-md)' }}
      />
      <div className="stat-content">
        <Skeleton width={60} height={12} style={{ marginBottom: '0.5rem' }} />
        <Skeleton width={80} height={32} style={{ marginBottom: '0.25rem' }} />
        <Skeleton width={50} height={12} />
      </div>
    </div>
  )
}

export function SkeletonDashboard() {
  return (
    <div>
      <div className="page-header">
        <Skeleton width={200} height={32} />
      </div>
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <div className="card">
          <div className="card-header">
            <Skeleton width={150} height={20} />
          </div>
          <SkeletonText lines={6} />
        </div>
        <div className="card">
          <div className="card-header">
            <Skeleton width={150} height={20} />
          </div>
          <SkeletonText lines={6} />
        </div>
      </div>
    </div>
  )
}
