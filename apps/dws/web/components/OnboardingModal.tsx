/**
 * Onboarding Modal - First-time user experience
 */

import {
  ArrowRight,
  Box,
  Brain,
  Database,
  Key,
  Server,
  Wallet,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../context/AppContext'

interface Step {
  title: string
  description: string
  icon: React.ReactNode
  tips: string[]
}

const STEPS: Step[] = [
  {
    title: 'Welcome to DWS',
    description:
      'Decentralized Web Services - your open-source, permissionless alternative to AWS.',
    icon: <Server size={32} />,
    tips: [
      'No account required - just connect your wallet',
      'Pay only for what you use via x402 micropayments',
      'All data stored on decentralized networks',
    ],
  },
  {
    title: 'Storage & CDN',
    description:
      'Store files on IPFS, Arweave, or WebTorrent with automatic CDN distribution.',
    icon: <Database size={32} />,
    tips: [
      'Create S3-compatible buckets for your files',
      'Automatic content distribution across edge nodes',
      'Permanent storage option with Arweave',
    ],
  },
  {
    title: 'Compute',
    description:
      'Run containers, deploy workers, and execute compute jobs on the network.',
    icon: <Box size={32} />,
    tips: [
      'Docker containers with serverless scaling',
      'JavaScript/TypeScript workers with V8 isolates',
      'GPU compute for ML training and inference',
    ],
  },
  {
    title: 'AI & ML',
    description:
      'Access AI inference, embeddings, and distributed training capabilities.',
    icon: <Brain size={32} />,
    tips: [
      'OpenAI-compatible chat completions API',
      'Vector embeddings for RAG applications',
      'Federated learning with privacy guarantees',
    ],
  },
  {
    title: 'Security',
    description:
      'Decentralized key management, secrets storage, and OAuth3 authentication.',
    icon: <Key size={32} />,
    tips: [
      'Threshold signatures for secure key custody',
      'Encrypted secrets with access control',
      'OAuth3 for wallet-based authentication',
    ],
  },
  {
    title: 'Get Started',
    description:
      'Connect your wallet to start using DWS. Get testnet tokens from the faucet.',
    icon: <Wallet size={32} />,
    tips: [
      'Connect MetaMask or any injected wallet',
      'Get free JEJU tokens from the testnet faucet',
      'Switch to Provider mode to earn by running a node',
    ],
  },
]

export function OnboardingModal() {
  const { hasSeenOnboarding, setHasSeenOnboarding } = useApp()
  const [currentStep, setCurrentStep] = useState(0)

  if (hasSeenOnboarding) return null

  const step = STEPS[currentStep]
  const isLast = currentStep === STEPS.length - 1

  const handleNext = () => {
    if (isLast) {
      setHasSeenOnboarding(true)
    } else {
      setCurrentStep((s) => s + 1)
    }
  }

  const handleSkip = () => {
    setHasSeenOnboarding(true)
  }

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal onboarding-modal"
        style={{ maxWidth: '520px' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <div className="modal-body" style={{ padding: 0 }}>
          {/* Progress indicator */}
          <div
            style={{
              display: 'flex',
              gap: '0.25rem',
              padding: '1.25rem 1.5rem 0',
            }}
          >
            {STEPS.map((stepItem, i) => (
              <div
                key={`step-progress-${stepItem.title}`}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background:
                    i <= currentStep ? 'var(--accent)' : 'var(--border)',
                  transition: 'background 0.2s',
                }}
              />
            ))}
          </div>

          {/* Content */}
          <div style={{ padding: '1.5rem' }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 'var(--radius-lg)',
                background: 'var(--gradient-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.25rem',
                color: 'var(--accent)',
              }}
            >
              {step.icon}
            </div>

            <h2
              id="onboarding-title"
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                marginBottom: '0.5rem',
              }}
            >
              {step.title}
            </h2>

            <p
              style={{
                color: 'var(--text-secondary)',
                marginBottom: '1.5rem',
                lineHeight: 1.6,
              }}
            >
              {step.description}
            </p>

            <div
              style={{
                display: 'grid',
                gap: '0.75rem',
              }}
            >
              {step.tips.map((tip) => (
                <div
                  key={`tip-${tip}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    padding: '0.75rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <Zap
                    size={16}
                    style={{
                      color: 'var(--accent)',
                      marginTop: 2,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '0.9rem' }}>{tip}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem 1.5rem',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg-primary)',
              borderRadius: '0 0 var(--radius-xl) var(--radius-xl)',
            }}
          >
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleSkip}
              style={{ color: 'var(--text-muted)' }}
            >
              Skip tour
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleNext}
            >
              {isLast ? (
                "Let's go"
              ) : (
                <>
                  Next <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
