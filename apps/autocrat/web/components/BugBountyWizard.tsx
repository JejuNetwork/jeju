import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bug,
  Check,
  Clock,
  Code,
  DollarSign,
  Eye,
  Lock,
  Send,
  Shield,
  Zap,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useAccount } from 'wagmi'
import {
  assessBugBounty,
  type BountyAssessment,
  type BountySubmissionDraft,
  submitBugBounty,
} from '../config/api'

interface BountyDraft {
  severity: number
  vulnType: number
  title: string
  summary: string
  description: string
  affectedComponents: string[]
  stepsToReproduce: string[]
  proofOfConcept: string
  suggestedFix: string
  stake: string
}

interface WizardAssessment {
  severityScore: number
  impactScore: number
  exploitabilityScore: number
  isImmediateThreat: boolean
  estimatedReward: string
  validationPriority: 'critical' | 'high' | 'medium' | 'low'
  feedback: string[]
  readyToSubmit: boolean
}

type WizardStep = 'type' | 'details' | 'poc' | 'review' | 'submit'

const SEVERITY_OPTIONS = [
  {
    value: 0,
    label: 'Low',
    color: 'bg-blue-500',
    range: '$500 - $2,500',
    desc: 'Minor bugs, theoretical issues',
  },
  {
    value: 1,
    label: 'Medium',
    color: 'bg-yellow-500',
    range: '$2,500 - $10,000',
    desc: 'DoS, information disclosure',
  },
  {
    value: 2,
    label: 'High',
    color: 'bg-orange-500',
    range: '$10,000 - $25,000',
    desc: '51% attack, MPC exposure, privilege escalation',
  },
  {
    value: 3,
    label: 'Critical',
    color: 'bg-red-500',
    range: '$25,000 - $50,000',
    desc: 'Immediate fund loss, RCE, wallet drain, TEE bypass',
  },
]

const VULN_TYPE_OPTIONS = [
  {
    value: 0,
    label: 'Funds at Risk',
    icon: DollarSign,
    desc: 'Direct loss of user funds',
  },
  {
    value: 1,
    label: 'Wallet Drain',
    icon: Lock,
    desc: 'Unauthorized wallet access',
  },
  {
    value: 2,
    label: 'Remote Code Execution',
    icon: Code,
    desc: 'RCE on infrastructure',
  },
  { value: 3, label: 'TEE Bypass', icon: Shield, desc: 'Enclave manipulation' },
  {
    value: 4,
    label: 'Consensus Attack',
    icon: Zap,
    desc: '51% or consensus issues',
  },
  {
    value: 5,
    label: 'MPC Key Exposure',
    icon: Lock,
    desc: 'Key material leakage',
  },
  {
    value: 6,
    label: 'Privilege Escalation',
    icon: AlertTriangle,
    desc: 'Unauthorized access elevation',
  },
  {
    value: 7,
    label: 'Denial of Service',
    icon: AlertCircle,
    desc: 'Service disruption',
  },
  {
    value: 8,
    label: 'Information Disclosure',
    icon: Eye,
    desc: 'Sensitive data exposure',
  },
  { value: 9, label: 'Other', icon: Bug, desc: 'Other security issues' },
]

const COMPONENT_OPTIONS = [
  'Smart Contracts',
  'Backend API',
  'DWS Compute',
  'MPC KMS',
  'TEE Service',
  'Bridge',
  'Oracle',
  'Governance',
  'Frontend',
  'Other',
]

interface BugBountyWizardProps {
  onComplete?: (submissionId: string) => void
  onCancel?: () => void
}

function draftToSubmission(draft: BountyDraft): BountySubmissionDraft {
  return {
    title: draft.title,
    summary: draft.summary,
    description: draft.description,
    severity: draft.severity,
    vulnType: draft.vulnType,
    affectedComponents: draft.affectedComponents,
    stepsToReproduce: draft.stepsToReproduce.filter((s) => s.trim()),
    proofOfConcept: draft.proofOfConcept || undefined,
    suggestedFix: draft.suggestedFix || undefined,
  }
}

function assessmentToWizard(
  assessment: BountyAssessment,
  draft: BountyDraft,
): WizardAssessment {
  const severityScore = Math.min(
    100,
    assessment.qualityScore + draft.severity * 10,
  )
  const impactScore = draft.severity >= 2 ? 80 : draft.severity >= 1 ? 60 : 40
  const exploitabilityScore = draft.proofOfConcept ? 70 : 30

  return {
    severityScore,
    impactScore,
    exploitabilityScore,
    isImmediateThreat: draft.severity === 3 && draft.vulnType <= 2,
    estimatedReward: `$${assessment.estimatedReward.min.toLocaleString()} - $${assessment.estimatedReward.max.toLocaleString()}`,
    validationPriority:
      draft.severity >= 3
        ? 'critical'
        : draft.severity >= 2
          ? 'high'
          : draft.severity >= 1
            ? 'medium'
            : 'low',
    feedback: assessment.issues,
    readyToSubmit: assessment.readyToSubmit,
  }
}

export function BugBountyWizard({
  onComplete,
  onCancel,
}: BugBountyWizardProps) {
  const { address } = useAccount()
  const [step, setStep] = useState<WizardStep>('type')
  const [draft, setDraft] = useState<BountyDraft>({
    severity: 1,
    vulnType: 9,
    title: '',
    summary: '',
    description: '',
    affectedComponents: [],
    stepsToReproduce: [''],
    proofOfConcept: '',
    suggestedFix: '',
    stake: '0.01',
  })

  const [assessment, setAssessment] = useState<WizardAssessment | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Step validation
  const canProceed = {
    type: draft.vulnType !== undefined && draft.severity !== undefined,
    details:
      draft.title.length >= 10 &&
      draft.summary.length >= 50 &&
      draft.description.length >= 200 &&
      draft.affectedComponents.length > 0,
    poc: draft.stepsToReproduce.filter((s) => s.trim()).length >= 2,
    review: assessment?.readyToSubmit ?? false,
    submit: true,
  }

  // Assess submission using Eden
  const handleAssess = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const submissionDraft = draftToSubmission(draft)
      const result = await assessBugBounty(submissionDraft)
      setAssessment(assessmentToWizard(result, draft))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assessment failed')
      // Create fallback assessment
      setAssessment({
        severityScore: 50,
        impactScore: 50,
        exploitabilityScore: draft.proofOfConcept ? 70 : 30,
        isImmediateThreat: draft.severity === 3 && draft.vulnType <= 2,
        estimatedReward: SEVERITY_OPTIONS[draft.severity].range.split(' - ')[0],
        validationPriority: draft.severity >= 2 ? 'high' : 'medium',
        feedback: ['Assessment service unavailable - manual review required'],
        readyToSubmit: canProceed.details && canProceed.poc,
      })
    }

    setLoading(false)
  }, [draft, canProceed.details, canProceed.poc])

  // Submit vulnerability using Eden
  const handleSubmit = async () => {
    if (!address) {
      setError('Please connect your wallet to submit')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const submissionDraft = draftToSubmission(draft)
      const result = await submitBugBounty(submissionDraft, address)
      const submissionId = (result as { submissionId: string }).submissionId
      onComplete?.(submissionId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
    }

    setSubmitting(false)
  }

  // Add/remove step
  const addStep = () => {
    setDraft({ ...draft, stepsToReproduce: [...draft.stepsToReproduce, ''] })
  }

  const removeStep = (index: number) => {
    const steps = [...draft.stepsToReproduce]
    steps.splice(index, 1)
    setDraft({ ...draft, stepsToReproduce: steps })
  }

  const updateStep = (index: number, value: string) => {
    const steps = [...draft.stepsToReproduce]
    steps[index] = value
    setDraft({ ...draft, stepsToReproduce: steps })
  }

  // Toggle component
  const toggleComponent = (component: string) => {
    const components = draft.affectedComponents.includes(component)
      ? draft.affectedComponents.filter((c) => c !== component)
      : [...draft.affectedComponents, component]
    setDraft({ ...draft, affectedComponents: components })
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Progress */}
      <div className="flex items-center justify-between mb-8">
        {(['type', 'details', 'poc', 'review', 'submit'] as WizardStep[]).map(
          (s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`
                w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium
                ${
                  step === s
                    ? 'bg-red-500 text-white'
                    : canProceed[s]
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-700 text-gray-400'
                }
              `}
              >
                {canProceed[s] && step !== s ? <Check size={16} /> : i + 1}
              </div>
              {i < 4 && (
                <div
                  className={`hidden sm:block w-16 h-0.5 mx-2 ${
                    canProceed[
                      (['type', 'details', 'poc', 'review'] as WizardStep[])[i]
                    ]
                      ? 'bg-green-500'
                      : 'bg-gray-700'
                  }`}
                />
              )}
            </div>
          ),
        )}
      </div>

      {/* Step Labels */}
      <div className="hidden sm:flex justify-between mb-6 text-xs text-gray-500">
        <span className="w-16 text-center">Type</span>
        <span className="w-16 text-center">Details</span>
        <span className="w-16 text-center">PoC</span>
        <span className="w-16 text-center">Review</span>
        <span className="w-16 text-center">Submit</span>
      </div>

      {/* Content */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        {/* Type Step */}
        {step === 'type' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              Severity & Type
            </h2>

            {/* Severity */}
            <div>
              <div className="block text-sm font-medium text-gray-300 mb-3">
                Severity Level
              </div>
              <div className="grid grid-cols-2 gap-3">
                {SEVERITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDraft({ ...draft, severity: opt.value })}
                    className={`p-4 rounded-lg border text-left transition-all ${
                      draft.severity === opt.value
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-gray-600 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium text-white ${opt.color}`}
                      >
                        {opt.label}
                      </span>
                      <span className="text-sm text-green-400">
                        {opt.range}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Vulnerability Type */}
            <div>
              <div className="block text-sm font-medium text-gray-300 mb-3">
                Vulnerability Type
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {VULN_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDraft({ ...draft, vulnType: opt.value })}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      draft.vulnType === opt.value
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-gray-600 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <opt.icon className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-white">
                        {opt.label}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Warning for Critical */}
            {draft.severity === 3 && (
              <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="text-sm text-red-200">
                  <strong>Critical Severity:</strong> This will trigger
                  fast-track review. Please ensure you have solid evidence.
                  False critical reports may affect your reputation.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Details Step */}
        {step === 'details' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Bug className="w-5 h-5 text-red-400" />
              Vulnerability Details
            </h2>

            {/* Title */}
            <div>
              <label
                htmlFor="bounty-title"
                className="block text-sm font-medium text-gray-300 mb-1"
              >
                Title
              </label>
              <input
                id="bounty-title"
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Brief, descriptive title (10-100 chars)"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-500"
                maxLength={100}
              />
              <div className="text-xs text-gray-500 mt-1">
                {draft.title.length}/100
              </div>
            </div>

            {/* Summary */}
            <div>
              <label
                htmlFor="bounty-summary"
                className="block text-sm font-medium text-gray-300 mb-1"
              >
                Summary
              </label>
              <textarea
                id="bounty-summary"
                value={draft.summary}
                onChange={(e) =>
                  setDraft({ ...draft, summary: e.target.value })
                }
                placeholder="1-2 sentence summary of the vulnerability (50-500 chars)"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-500"
                rows={2}
                maxLength={500}
              />
              <div className="text-xs text-gray-500 mt-1">
                {draft.summary.length}/500
              </div>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="bounty-description"
                className="block text-sm font-medium text-gray-300 mb-1"
              >
                Full Description
              </label>
              <textarea
                id="bounty-description"
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                placeholder={`Detailed vulnerability description including:
• Root cause analysis
• Attack vector
• Impact assessment
• Affected users/assets`}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-500"
                rows={8}
              />
              <div className="text-xs text-gray-500 mt-1">
                {draft.description.length} chars (min 200)
              </div>
            </div>

            {/* Affected Components */}
            <div>
              <div className="block text-sm font-medium text-gray-300 mb-2">
                Affected Components
              </div>
              <div className="flex flex-wrap gap-2">
                {COMPONENT_OPTIONS.map((comp) => (
                  <button
                    key={comp}
                    type="button"
                    onClick={() => toggleComponent(comp)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      draft.affectedComponents.includes(comp)
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {comp}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PoC Step */}
        {step === 'poc' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Code className="w-5 h-5 text-red-400" />
              Proof of Concept
            </h2>

            {/* Steps to Reproduce */}
            <div>
              <div className="block text-sm font-medium text-gray-300 mb-2">
                Steps to Reproduce
              </div>
              <div className="space-y-2">
                {draft.stepsToReproduce.map((stepText, i) => (
                  <div
                    key={`step-${i}-${stepText.slice(0, 10)}`}
                    className="flex gap-2"
                  >
                    <span className="w-8 h-10 flex items-center justify-center text-sm text-gray-400 bg-gray-700 rounded">
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={stepText}
                      onChange={(e) => updateStep(i, e.target.value)}
                      placeholder={`Step ${i + 1}`}
                      aria-label={`Step ${i + 1}`}
                      className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-500"
                    />
                    {draft.stepsToReproduce.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeStep(i)}
                        className="px-3 py-2 text-gray-400 hover:text-red-400 transition-colors"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addStep}
                  className="text-sm text-red-400 hover:text-red-300"
                >
                  + Add Step
                </button>
              </div>
            </div>

            {/* Proof of Concept Code */}
            <div>
              <label
                htmlFor="bounty-poc"
                className="block text-sm font-medium text-gray-300 mb-1"
              >
                Proof of Concept Code
                <span className="text-gray-500 font-normal ml-2">
                  (Recommended)
                </span>
              </label>
              <textarea
                id="bounty-poc"
                value={draft.proofOfConcept}
                onChange={(e) =>
                  setDraft({ ...draft, proofOfConcept: e.target.value })
                }
                placeholder={`// Paste your PoC code here
// This will be executed in a secure sandbox
// Include all necessary setup and exploit steps

async function exploit() {
  // Your code here
}`}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-green-400 font-mono text-sm placeholder-gray-500 focus:outline-none focus:border-red-500"
                rows={12}
              />
              <p className="text-xs text-gray-500 mt-1">
                PoC will be encrypted and only accessible to guardians. Executed
                in isolated sandbox.
              </p>
            </div>

            {/* Suggested Fix */}
            <div>
              <label
                htmlFor="bounty-fix"
                className="block text-sm font-medium text-gray-300 mb-1"
              >
                Suggested Fix
                <span className="text-gray-500 font-normal ml-2">
                  (Optional, increases reward)
                </span>
              </label>
              <textarea
                id="bounty-fix"
                value={draft.suggestedFix}
                onChange={(e) =>
                  setDraft({ ...draft, suggestedFix: e.target.value })
                }
                placeholder="Describe how to fix this vulnerability..."
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-500"
                rows={4}
              />
            </div>
          </div>
        )}

        {/* Review Step */}
        {step === 'review' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Shield className="w-5 h-5 text-red-400" />
                Review & Assessment
              </h2>
              <button
                type="button"
                onClick={handleAssess}
                disabled={loading}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {loading
                  ? 'Assessing...'
                  : assessment
                    ? 'Re-assess'
                    : 'Run Assessment'}
              </button>
            </div>

            {!assessment ? (
              <div className="text-center py-12">
                <Shield className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">
                  Click "Run Assessment" to analyze your submission
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Scores */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-gray-700/50 rounded-lg text-center">
                    <div className="text-2xl font-bold text-white">
                      {assessment.severityScore}%
                    </div>
                    <div className="text-sm text-gray-400">Severity</div>
                  </div>
                  <div className="p-4 bg-gray-700/50 rounded-lg text-center">
                    <div className="text-2xl font-bold text-white">
                      {assessment.impactScore}%
                    </div>
                    <div className="text-sm text-gray-400">Impact</div>
                  </div>
                  <div className="p-4 bg-gray-700/50 rounded-lg text-center">
                    <div className="text-2xl font-bold text-white">
                      {assessment.exploitabilityScore}%
                    </div>
                    <div className="text-sm text-gray-400">Exploitability</div>
                  </div>
                </div>

                {/* Priority Badge */}
                {assessment.isImmediateThreat && (
                  <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3">
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                    <div>
                      <div className="font-semibold text-red-300">
                        IMMEDIATE THREAT DETECTED
                      </div>
                      <div className="text-sm text-red-200">
                        This submission will receive fast-track review
                      </div>
                    </div>
                  </div>
                )}

                {/* Estimated Reward */}
                <div className="p-4 bg-green-900/20 border border-green-700/50 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <DollarSign className="w-6 h-6 text-green-400" />
                    <div>
                      <div className="text-sm text-gray-400">
                        Estimated Reward
                      </div>
                      <div className="text-xl font-bold text-green-400">
                        {assessment.estimatedReward}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      assessment.validationPriority === 'critical'
                        ? 'bg-red-500'
                        : assessment.validationPriority === 'high'
                          ? 'bg-orange-500'
                          : assessment.validationPriority === 'medium'
                            ? 'bg-yellow-500'
                            : 'bg-blue-500'
                    } text-white`}
                  >
                    {assessment.validationPriority.toUpperCase()} Priority
                  </div>
                </div>

                {/* Feedback */}
                {assessment.feedback.length > 0 && (
                  <div className="p-4 bg-gray-700/50 rounded-lg">
                    <h3 className="font-medium text-white mb-2">Feedback</h3>
                    <ul className="space-y-1">
                      {assessment.feedback.map((f) => (
                        <li
                          key={f}
                          className="text-sm text-gray-300 flex items-start gap-2"
                        >
                          <span className="text-gray-500">•</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Summary */}
                <div className="p-4 bg-gray-700/50 rounded-lg space-y-3">
                  <h3 className="font-medium text-white">Submission Summary</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">Severity:</span>{' '}
                      <span className="text-white">
                        {SEVERITY_OPTIONS[draft.severity].label}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Type:</span>{' '}
                      <span className="text-white">
                        {VULN_TYPE_OPTIONS[draft.vulnType].label}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Components:</span>{' '}
                      <span className="text-white">
                        {draft.affectedComponents.join(', ')}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">PoC:</span>{' '}
                      <span className="text-white">
                        {draft.proofOfConcept ? 'Provided' : 'Not provided'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Ready Status */}
                <div
                  className={`p-4 rounded-lg flex items-center gap-3 ${
                    assessment.readyToSubmit
                      ? 'bg-green-900/20 border border-green-700/50'
                      : 'bg-yellow-900/20 border border-yellow-700/50'
                  }`}
                >
                  {assessment.readyToSubmit ? (
                    <>
                      <Check className="w-6 h-6 text-green-400" />
                      <span className="text-green-300">Ready to submit</span>
                    </>
                  ) : (
                    <>
                      <Clock className="w-6 h-6 text-yellow-400" />
                      <span className="text-yellow-300">
                        Address feedback before submitting
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Submit Step */}
        {step === 'submit' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-red-400" />
              Submit Vulnerability
            </h2>

            {/* Wallet Connection Check */}
            {!address && (
              <div className="p-4 bg-yellow-900/30 border border-yellow-700 rounded-lg flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
                <span className="text-yellow-300">
                  Please connect your wallet to submit
                </span>
              </div>
            )}

            {/* Stake Selection */}
            <div className="p-4 bg-gray-700/50 rounded-lg">
              <div className="block text-sm font-medium text-gray-300 mb-2">
                Stake Amount
                <span className="text-gray-500 font-normal ml-2">
                  (Higher stake = faster review)
                </span>
              </div>
              <div className="flex gap-2">
                {['0.01', '0.05', '0.1', '0.5'].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setDraft({ ...draft, stake: amount })}
                    className={`px-4 py-2 rounded-lg transition-colors ${
                      draft.stake === amount
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                    }`}
                  >
                    {amount} ETH
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Stake is returned if submission is valid (accepted or rejected
                as out-of-scope).
              </p>
            </div>

            {/* Final Summary */}
            <div className="p-4 bg-gray-700/50 rounded-lg space-y-3">
              <h3 className="font-medium text-white">Final Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Title</span>
                  <span className="text-white">{draft.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Severity</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium text-white ${SEVERITY_OPTIONS[draft.severity].color}`}
                  >
                    {SEVERITY_OPTIONS[draft.severity].label}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Type</span>
                  <span className="text-white">
                    {VULN_TYPE_OPTIONS[draft.vulnType].label}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Stake</span>
                  <span className="text-white">{draft.stake} ETH</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Est. Reward</span>
                  <span className="text-green-400">
                    {SEVERITY_OPTIONS[draft.severity].range}
                  </span>
                </div>
              </div>
            </div>

            {/* Terms */}
            <div className="p-4 bg-gray-700/50 rounded-lg text-sm text-gray-300">
              <p className="mb-2">By submitting, you agree to:</p>
              <ul className="space-y-1 text-gray-400">
                <li>• Not disclose vulnerability until fix is deployed</li>
                <li>• Allow encrypted report to be reviewed by guardians</li>
                <li>• Accept the reward decision by the DAO</li>
                <li>• Not exploit the vulnerability on mainnet</li>
              </ul>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          type="button"
          onClick={() => {
            if (step === 'type') {
              onCancel?.()
            } else {
              const steps: WizardStep[] = [
                'type',
                'details',
                'poc',
                'review',
                'submit',
              ]
              const idx = steps.indexOf(step)
              setStep(steps[idx - 1])
            }
          }}
          className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          {step === 'type' ? 'Cancel' : 'Back'}
        </button>

        <button
          type="button"
          onClick={() => {
            if (step === 'type' && canProceed.type) setStep('details')
            else if (step === 'details' && canProceed.details) setStep('poc')
            else if (step === 'poc' && canProceed.poc) {
              setStep('review')
              handleAssess()
            } else if (step === 'review' && canProceed.review) setStep('submit')
            else if (step === 'submit') handleSubmit()
          }}
          disabled={
            !canProceed[step] || submitting || (step === 'submit' && !address)
          }
          className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {step === 'submit'
            ? submitting
              ? 'Submitting...'
              : 'Submit Report'
            : 'Continue'}
          {step === 'submit' ? (
            <Send className="w-4 h-4" />
          ) : (
            <ArrowRight className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  )
}

export default BugBountyWizard
