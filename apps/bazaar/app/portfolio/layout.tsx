import type { ReactNode } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export default function PortfolioLayout({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>
}
