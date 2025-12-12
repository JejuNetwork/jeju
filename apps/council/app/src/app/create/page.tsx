'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Sparkles, Check, AlertCircle } from 'lucide-react'
import { assessProposal, type QualityAssessment } from '@/config/api'

const PROPOSAL_TYPES = [
  { value: 'PARAMETER_CHANGE', label: 'Parameter Change' },
  { value: 'TREASURY_ALLOCATION', label: 'Treasury Allocation' },
  { value: 'CODE_UPGRADE', label: 'Code Upgrade' },
  { value: 'BOUNTY', label: 'Bounty' },
  { value: 'GRANT', label: 'Grant' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'POLICY', label: 'Policy' },
]

export default function CreateProposalPage() {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [proposalType, setProposalType] = useState('PARAMETER_CHANGE')
  const [assessment, setAssessment] = useState<QualityAssessment | null>(null)
  const [assessing, setAssessing] = useState(false)
  const [error, setError] = useState('')

  const handleAssess = async () => {
    if (!title || !summary || !description) {
      setError('Fill in all fields')
      return
    }
    setError('')
    setAssessing(true)
    
    const result = await assessProposal({ title, summary, description, proposalType })
      .catch(() => null)
    
    setAssessment(result)
    setAssessing(false)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Link 
          href="/" 
          className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft size={18} className="sm:w-5 sm:h-5" />
        </Link>
        <h1 className="text-lg sm:text-xl font-semibold">Create Proposal</h1>
      </div>

      {/* Form and Assessment - stack on mobile, side by side on desktop */}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">
        {/* Form */}
        <div className="flex-1 card-static p-3 sm:p-4 space-y-3 sm:space-y-4">
          <div>
            <label className="block text-xs sm:text-sm font-medium mb-1">Type</label>
            <select
              value={proposalType}
              onChange={(e) => setProposalType(e.target.value)}
              className="input text-sm"
            >
              {PROPOSAL_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs sm:text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="10-100 characters"
              className="input text-sm"
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-xs sm:text-sm font-medium mb-1">Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="50-500 characters"
              className="textarea text-sm"
              rows={2}
              maxLength={500}
            />
          </div>

          <div>
            <label className="block text-xs sm:text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Problem, solution, timeline, cost, benefit, risk..."
              className="textarea text-sm"
              rows={6}
            />
          </div>

          {error && (
            <p className="text-xs sm:text-sm" style={{ color: 'var(--color-error)' }}>{error}</p>
          )}

          {/* Buttons - stack on very small screens */}
          <div className="flex flex-col xs:flex-row gap-2 sm:gap-3">
            <button
              onClick={handleAssess}
              disabled={assessing}
              className="btn-accent flex items-center justify-center gap-2 flex-1 text-sm"
            >
              <Sparkles size={16} />
              {assessing ? 'Assessing...' : 'Assess'}
            </button>
            <button
              disabled={!assessment?.readyToSubmit}
              className="btn-primary flex items-center justify-center gap-2 flex-1 text-sm disabled:opacity-50"
            >
              <Check size={16} />
              Submit
            </button>
          </div>
        </div>

        {/* Assessment Panel */}
        <div className="lg:w-64 shrink-0">
          <div className="card-static p-3 sm:p-4 lg:sticky lg:top-20">
            {assessment ? (
              <div className="space-y-3 sm:space-y-4">
                <div className="text-center">
                  <div 
                    className="text-3xl sm:text-4xl font-bold"
                    style={{ 
                      color: assessment.overallScore >= 90 
                        ? 'var(--color-success)' 
                        : assessment.overallScore >= 70 
                        ? 'var(--color-warning)' 
                        : 'var(--color-error)'
                    }}
                  >
                    {assessment.overallScore}%
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    90% required
                  </div>
                </div>

                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${assessment.overallScore}%` }} />
                </div>

                {assessment.readyToSubmit ? (
                  <div className="badge-success text-center p-2 rounded text-xs sm:text-sm w-full justify-center">
                    <Check size={14} className="mr-1" /> Ready
                  </div>
                ) : (
                  <div className="badge-warning text-center p-2 rounded text-xs sm:text-sm w-full justify-center">
                    <AlertCircle size={14} className="mr-1" /> Improve
                  </div>
                )}

                {assessment.blockers.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-error)' }}>
                      Must fix:
                    </div>
                    {assessment.blockers.map((b, i) => (
                      <p key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        • {b}
                      </p>
                    ))}
                  </div>
                )}

                {assessment.suggestions.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-warning)' }}>
                      Suggestions:
                    </div>
                    {assessment.suggestions.map((s, i) => (
                      <p key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        • {s}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <Sparkles size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Click Assess for feedback
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
