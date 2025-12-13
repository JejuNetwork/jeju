'use client'

import { useState, useCallback } from 'react'
import { 
  ArrowLeft, ArrowRight, Sparkles, Check, AlertCircle, 
  Search, FileText, Send, Lightbulb, RefreshCw, AlertTriangle
} from 'lucide-react'
import {
  assessProposalFull,
  checkDuplicates,
  improveProposal,
  generateProposal,
  quickScore,
  type ProposalDraft,
  type FullQualityAssessment,
  type SimilarProposal,
  type QuickScoreResult,
} from '@/config/api'

const PROPOSAL_TYPES = [
  { value: 0, label: 'Parameter Change', icon: '⚙️', desc: 'Adjust DAO parameters' },
  { value: 1, label: 'Treasury Allocation', icon: '💰', desc: 'Fund projects or expenses' },
  { value: 2, label: 'Code Upgrade', icon: '🔧', desc: 'Smart contract changes' },
  { value: 3, label: 'Hire Contractor', icon: '👤', desc: 'Bring on contributors' },
  { value: 4, label: 'Fire Contractor', icon: '🚪', desc: 'End a contributor role' },
  { value: 5, label: 'Bounty', icon: '🎯', desc: 'Reward for specific work' },
  { value: 6, label: 'Grant', icon: '🎁', desc: 'Fund external projects' },
  { value: 7, label: 'Partnership', icon: '🤝', desc: 'Establish partnerships' },
  { value: 8, label: 'Policy', icon: '📜', desc: 'Change governance rules' },
]

type WizardStep = 'draft' | 'quality' | 'duplicates' | 'submit'

interface WizardProps {
  onComplete?: (draft: ProposalDraft, assessment: FullQualityAssessment) => void
  onCancel?: () => void
}

export function ProposalWizard({ onComplete, onCancel }: WizardProps) {
  const [step, setStep] = useState<WizardStep>('draft')
  const [draft, setDraft] = useState<ProposalDraft>({
    title: '',
    summary: '',
    description: '',
    proposalType: 0,
    tags: [],
  })
  
  const [quickScoreResult, setQuickScoreResult] = useState<QuickScoreResult | null>(null)
  const [assessment, setAssessment] = useState<FullQualityAssessment | null>(null)
  const [duplicates, setDuplicates] = useState<SimilarProposal[]>([])
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [improving, setImproving] = useState<string | null>(null)

  // Quick score as user types
  const handleQuickScore = useCallback(async () => {
    if (!draft.title || !draft.description) return
    try {
      const result = await quickScore(draft)
      setQuickScoreResult(result)
    } catch {
      // Ignore quick score errors
    }
  }, [draft])

  // Generate proposal from idea
  const handleGenerate = async (idea: string) => {
    setGenerating(true)
    setError('')
    try {
      const generated = await generateProposal(idea, draft.proposalType)
      setDraft({
        ...draft,
        title: generated.title,
        summary: generated.summary,
        description: generated.description,
        tags: generated.tags,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    }
    setGenerating(false)
  }

  // Improve a specific criterion
  const handleImprove = async (criterion: string) => {
    setImproving(criterion)
    try {
      const improved = await improveProposal(draft, criterion)
      setDraft({
        ...draft,
        description: draft.description + '\n\n' + improved,
      })
    } catch {
      // Ignore improvement errors
    }
    setImproving(null)
  }

  // Full quality assessment
  const handleAssess = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await assessProposalFull(draft)
      setAssessment(result)
      if (result.overallScore >= 90 && result.blockers.length === 0) {
        setStep('duplicates')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assessment failed')
    }
    setLoading(false)
  }

  // Check duplicates
  const handleCheckDuplicates = async () => {
    setLoading(true)
    setError('')
    try {
      const dups = await checkDuplicates(draft)
      setDuplicates(dups)
      setStep('submit')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Duplicate check failed')
    }
    setLoading(false)
  }

  // Submit proposal
  const handleSubmit = () => {
    if (assessment && onComplete) {
      onComplete(draft, assessment)
    }
  }

  const canProceed = {
    draft: draft.title.length >= 10 && draft.summary.length >= 50 && draft.description.length >= 200,
    quality: assessment && assessment.overallScore >= 90 && assessment.blockers.length === 0,
    duplicates: duplicates.every(d => d.similarity < 80),
    submit: true,
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Progress Steps */}
      <div className="flex items-center justify-between mb-6 sm:mb-8">
        {(['draft', 'quality', 'duplicates', 'submit'] as WizardStep[]).map((s, i) => (
          <div key={s} className="flex items-center">
            <div 
              className={`
                w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-sm font-medium
                ${step === s ? 'bg-accent text-white' : 
                  canProceed[s] ? 'bg-green-500 text-white' : 
                  'bg-gray-200 dark:bg-gray-700'}
              `}
            >
              {canProceed[s] && step !== s ? <Check size={16} /> : i + 1}
            </div>
            {i < 3 && (
              <div className={`hidden sm:block w-16 h-0.5 mx-2 ${
                canProceed[['draft', 'quality', 'duplicates'][i] as WizardStep] ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* Step Labels */}
      <div className="hidden sm:flex justify-between mb-6 text-xs text-gray-500">
        <span className="w-20 text-center">Draft</span>
        <span className="w-20 text-center">Quality</span>
        <span className="w-20 text-center">Duplicates</span>
        <span className="w-20 text-center">Submit</span>
      </div>

      {/* Step Content */}
      <div className="card-static p-4 sm:p-6">
        {step === 'draft' && (
          <DraftStep
            draft={draft}
            setDraft={setDraft}
            quickScore={quickScoreResult}
            onQuickScore={handleQuickScore}
            onGenerate={handleGenerate}
            generating={generating}
          />
        )}

        {step === 'quality' && (
          <QualityStep
            draft={draft}
            assessment={assessment}
            loading={loading}
            onAssess={handleAssess}
            onImprove={handleImprove}
            improving={improving}
          />
        )}

        {step === 'duplicates' && (
          <DuplicatesStep
            duplicates={duplicates}
            loading={loading}
            onCheck={handleCheckDuplicates}
          />
        )}

        {step === 'submit' && (
          <SubmitStep
            draft={draft}
            assessment={assessment}
            duplicates={duplicates}
            onSubmit={handleSubmit}
          />
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          onClick={() => {
            if (step === 'draft') {
              onCancel?.()
            } else {
              const steps: WizardStep[] = ['draft', 'quality', 'duplicates', 'submit']
              const idx = steps.indexOf(step)
              setStep(steps[idx - 1])
            }
          }}
          className="btn-secondary flex items-center gap-2"
        >
          <ArrowLeft size={16} />
          {step === 'draft' ? 'Cancel' : 'Back'}
        </button>

        <button
          onClick={() => {
            if (step === 'draft' && canProceed.draft) {
              setStep('quality')
            } else if (step === 'quality' && canProceed.quality) {
              handleCheckDuplicates()
            } else if (step === 'duplicates' && canProceed.duplicates) {
              setStep('submit')
            } else if (step === 'submit') {
              handleSubmit()
            }
          }}
          disabled={!canProceed[step] || loading}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          {step === 'submit' ? 'Submit Proposal' : 'Continue'}
          {step === 'submit' ? <Send size={16} /> : <ArrowRight size={16} />}
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Step Components
// ============================================================================

function DraftStep({
  draft,
  setDraft,
  quickScore,
  onQuickScore,
  onGenerate,
  generating,
}: {
  draft: ProposalDraft
  setDraft: (d: ProposalDraft) => void
  quickScore: QuickScoreResult | null
  onQuickScore: () => void
  onGenerate: (idea: string) => void
  generating: boolean
}) {
  const [idea, setIdea] = useState('')
  const [showGenerator, setShowGenerator] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileText size={20} />
          Draft Your Proposal
        </h2>
        <button
          onClick={() => setShowGenerator(!showGenerator)}
          className="text-sm text-accent hover:underline flex items-center gap-1"
        >
          <Lightbulb size={14} />
          AI Assistant
        </button>
      </div>

      {showGenerator && (
        <div className="bg-accent/10 rounded-lg p-4 space-y-3">
          <p className="text-sm">Describe your idea and let AI draft a proposal:</p>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="I want to propose..."
            className="textarea text-sm"
            rows={3}
          />
          <button
            onClick={() => onGenerate(idea)}
            disabled={generating || !idea}
            className="btn-accent text-sm flex items-center gap-2"
          >
            <Sparkles size={14} />
            {generating ? 'Generating...' : 'Generate Draft'}
          </button>
        </div>
      )}

      {/* Proposal Type */}
      <div>
        <label className="block text-sm font-medium mb-2">Proposal Type</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PROPOSAL_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => setDraft({ ...draft, proposalType: type.value })}
              className={`p-3 rounded-lg border text-left transition-colors ${
                draft.proposalType === type.value
                  ? 'border-accent bg-accent/10'
                  : 'border-gray-200 dark:border-gray-700 hover:border-accent'
              }`}
            >
              <span className="text-lg">{type.icon}</span>
              <div className="text-sm font-medium">{type.label}</div>
              <div className="text-xs text-gray-500">{type.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm font-medium mb-1">Title</label>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onBlur={onQuickScore}
          placeholder="Clear, descriptive title (10-100 characters)"
          className="input"
          maxLength={100}
        />
        <div className="text-xs text-gray-500 mt-1">{draft.title.length}/100</div>
      </div>

      {/* Summary */}
      <div>
        <label className="block text-sm font-medium mb-1">Summary</label>
        <textarea
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          onBlur={onQuickScore}
          placeholder="1-2 sentence summary of what this proposal does (50-500 characters)"
          className="textarea"
          rows={2}
          maxLength={500}
        />
        <div className="text-xs text-gray-500 mt-1">{draft.summary.length}/500</div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium mb-1">Full Description</label>
        <textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          onBlur={onQuickScore}
          placeholder={`Include:
• Problem/motivation
• Proposed solution
• Implementation plan
• Timeline & milestones
• Budget/cost
• Expected benefits
• Risk assessment`}
          className="textarea"
          rows={12}
        />
        <div className="text-xs text-gray-500 mt-1">{draft.description.length} characters (min 200)</div>
      </div>

      {/* Quick Score Indicator */}
      {quickScore && (
        <div className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="text-2xl font-bold" style={{
            color: quickScore.score >= 60 ? 'var(--color-success)' : 'var(--color-warning)'
          }}>
            {quickScore.score}%
          </div>
          <div className="text-sm text-gray-500">
            {quickScore.readyForFullAssessment 
              ? 'Ready for AI quality assessment' 
              : 'Add more detail to continue'}
          </div>
        </div>
      )}
    </div>
  )
}

function QualityStep({
  draft,
  assessment,
  loading,
  onAssess,
  onImprove,
  improving,
}: {
  draft: ProposalDraft
  assessment: FullQualityAssessment | null
  loading: boolean
  onAssess: () => void
  onImprove: (criterion: string) => void
  improving: string | null
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles size={20} />
          Quality Assessment
        </h2>
        <button
          onClick={onAssess}
          disabled={loading}
          className="btn-accent text-sm flex items-center gap-2"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Assessing...' : assessment ? 'Re-assess' : 'Run Assessment'}
        </button>
      </div>

      {!assessment ? (
        <div className="text-center py-12">
          <Sparkles size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-gray-500">Click &quot;Run Assessment&quot; to get AI feedback</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Overall Score */}
          <div className="text-center p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div 
              className="text-5xl font-bold"
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
            <div className="text-sm text-gray-500 mt-1">
              {assessment.readyToSubmit ? '✓ Ready for submission' : '90% required to submit'}
            </div>
            <div className="progress-bar mt-4 h-3">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${assessment.overallScore}%` }} 
              />
            </div>
          </div>

          {/* Criteria Breakdown */}
          <div>
            <h3 className="text-sm font-medium mb-3">Quality Criteria</h3>
            <div className="space-y-3">
              {Object.entries(assessment.criteria).map(([key, value]) => (
                <div key={key} className="flex items-center gap-3">
                  <div className="w-32 text-sm capitalize">{key.replace(/([A-Z])/g, ' $1')}</div>
                  <div className="flex-1 progress-bar h-2">
                    <div 
                      className="progress-bar-fill" 
                      style={{ 
                        width: `${value}%`,
                        backgroundColor: value >= 90 ? 'var(--color-success)' : 
                                        value >= 70 ? 'var(--color-warning)' : 
                                        'var(--color-error)'
                      }} 
                    />
                  </div>
                  <div className="w-12 text-sm text-right">{value}%</div>
                  {value < 90 && (
                    <button
                      onClick={() => onImprove(key)}
                      disabled={improving === key}
                      className="text-xs text-accent hover:underline"
                    >
                      {improving === key ? '...' : 'Improve'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Blockers */}
          {assessment.blockers.length > 0 && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <h3 className="text-sm font-medium text-red-600 dark:text-red-400 mb-2 flex items-center gap-2">
                <AlertCircle size={16} />
                Must Fix Before Submission
              </h3>
              <ul className="space-y-1">
                {assessment.blockers.map((b, i) => (
                  <li key={i} className="text-sm text-red-600 dark:text-red-400">• {b}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions */}
          {assessment.suggestions.length > 0 && (
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <h3 className="text-sm font-medium text-yellow-700 dark:text-yellow-400 mb-2">
                Suggestions for Improvement
              </h3>
              <ul className="space-y-1">
                {assessment.suggestions.map((s, i) => (
                  <li key={i} className="text-sm text-yellow-700 dark:text-yellow-400">• {s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Feedback */}
          {assessment.feedback.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Detailed Feedback</h3>
              <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                {assessment.feedback.map((f, i) => (
                  <li key={i}>• {f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DuplicatesStep({
  duplicates,
  loading,
  onCheck,
}: {
  duplicates: SimilarProposal[]
  loading: boolean
  onCheck: () => void
}) {
  const hasDuplicates = duplicates.some(d => d.similarity >= 80)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Search size={20} />
          Duplicate Check
        </h2>
        <button
          onClick={onCheck}
          disabled={loading}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Checking...' : 'Re-check'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <Search size={48} className="mx-auto mb-4 opacity-30 animate-pulse" />
          <p className="text-gray-500">Checking for similar proposals...</p>
        </div>
      ) : duplicates.length === 0 ? (
        <div className="text-center py-12 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <Check size={48} className="mx-auto mb-4 text-green-500" />
          <p className="text-green-600 dark:text-green-400 font-medium">No duplicates found!</p>
          <p className="text-sm text-gray-500 mt-1">Your proposal appears to be unique.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {hasDuplicates && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg flex items-start gap-3">
              <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
              <div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  High similarity detected!
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Your proposal is very similar to existing proposals. Consider modifying it or supporting the existing proposal instead.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {duplicates.map((dup) => (
              <div 
                key={dup.proposalId}
                className={`p-4 rounded-lg border ${
                  dup.similarity >= 80 
                    ? 'border-red-300 bg-red-50 dark:bg-red-900/20' 
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{dup.title}</span>
                  <span className={`text-sm font-bold ${
                    dup.similarity >= 80 ? 'text-red-500' : 
                    dup.similarity >= 50 ? 'text-yellow-500' : 'text-gray-500'
                  }`}>
                    {dup.similarity}% similar
                  </span>
                </div>
                <p className="text-xs text-gray-500">{dup.reason}</p>
                <div className="mt-2 text-xs">
                  <span className="badge-neutral">{dup.status}</span>
                  <span className="ml-2 text-gray-400">{dup.proposalId.slice(0, 10)}...</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SubmitStep({
  draft,
  assessment,
  duplicates,
}: {
  draft: ProposalDraft
  assessment: FullQualityAssessment | null
  duplicates: SimilarProposal[]
  onSubmit: () => void
}) {
  const hasDuplicates = duplicates.some(d => d.similarity >= 80)

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Send size={20} />
        Review & Submit
      </h2>

      {/* Summary Card */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4">
        <div>
          <div className="text-xs text-gray-500">Type</div>
          <div className="font-medium">
            {PROPOSAL_TYPES.find(t => t.value === draft.proposalType)?.label}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Title</div>
          <div className="font-medium">{draft.title}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Summary</div>
          <div className="text-sm">{draft.summary}</div>
        </div>
      </div>

      {/* Status Checks */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 text-sm">
          {assessment && assessment.overallScore >= 90 ? (
            <Check className="text-green-500" size={18} />
          ) : (
            <AlertCircle className="text-red-500" size={18} />
          )}
          <span>Quality Score: {assessment?.overallScore ?? 0}%</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {!hasDuplicates ? (
            <Check className="text-green-500" size={18} />
          ) : (
            <AlertCircle className="text-red-500" size={18} />
          )}
          <span>Duplicate Check: {hasDuplicates ? 'Similar found' : 'Unique'}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {assessment?.blockers.length === 0 ? (
            <Check className="text-green-500" size={18} />
          ) : (
            <AlertCircle className="text-red-500" size={18} />
          )}
          <span>No Blockers: {assessment?.blockers.length ?? 0} issues</span>
        </div>
      </div>

      {/* Important Notice */}
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm">
        <p className="font-medium text-blue-700 dark:text-blue-400">Before Submitting</p>
        <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-400">
          <li>• Submitting requires a bond (returned if not spam)</li>
          <li>• Your proposal will enter Council review</li>
          <li>• The AI CEO will make the final decision</li>
          <li>• Community can veto during grace period</li>
        </ul>
      </div>
    </div>
  )
}

export default ProposalWizard
