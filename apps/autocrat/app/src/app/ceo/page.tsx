'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { CEODashboard } from '@/components/CEODashboard'

export default function CEOPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link 
          href="/" 
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-semibold">AI CEO Management</h1>
      </div>

      {/* Dashboard */}
      <CEODashboard />
    </div>
  )
}
