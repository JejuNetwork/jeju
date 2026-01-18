import {
  ArrowRight,
  Book,
  Check,
  ChevronLeft,
  ChevronRight,
  Droplet,
  type LucideProps,
  Server,
  Sparkles,
  Wallet,
  Waves,
  X,
  Zap,
} from 'lucide-react'
import { type ComponentType, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'

const ArrowRightIcon = ArrowRight as ComponentType<LucideProps>
const CheckIcon = Check as ComponentType<LucideProps>
const ChevronLeftIcon = ChevronLeft as ComponentType<LucideProps>
const ChevronRightIcon = ChevronRight as ComponentType<LucideProps>
const XIcon = X as ComponentType<LucideProps>
const WalletIcon = Wallet as ComponentType<LucideProps>
const BookIcon = Book as ComponentType<LucideProps>
const DropletIcon = Droplet as ComponentType<LucideProps>
const ZapIcon = Zap as ComponentType<LucideProps>
const WavesIcon = Waves as ComponentType<LucideProps>
const SparklesIcon = Sparkles as ComponentType<LucideProps>
const ServerIcon = Server as ComponentType<LucideProps>

interface OnboardingStep {
  id: string
  title: string
  description: string
  icon: ComponentType<LucideProps>
  action?: {
    label: string
    path: string
  }
  details: string[]
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Jeju Gateway',
    description:
      'Your portal to the Jeju Network ecosystem. Build, trade, and earn on a decentralized infrastructure.',
    icon: SparklesIcon,
    details: [
      'Protocol Infrastructure Hub for the Jeju Network',
      'Manage identities, tokens, and cross-chain operations',
      'Access DeFi features like staking and liquidity provision',
    ],
  },
  {
    id: 'connect',
    title: 'Connect Your Wallet',
    description:
      'Start by connecting your Web3 wallet. We support MetaMask, WalletConnect, and more.',
    icon: WalletIcon,
    details: [
      'Click the Connect Wallet button in the header',
      'Select your preferred wallet provider',
      'Approve the connection request in your wallet',
    ],
  },
  {
    id: 'register',
    title: 'Register Your Identity',
    description:
      'Create your on-chain identity using the ERC-8004 standard. This unlocks all protocol features.',
    icon: BookIcon,
    action: {
      label: 'Go to Registry',
      path: '/registry',
    },
    details: [
      'Choose a name and category for your identity',
      'Stake tokens to secure your registration',
      'Stake is fully refundable when you unregister',
    ],
  },
  {
    id: 'faucet',
    title: 'Get Testnet Tokens',
    description:
      'Claim free JEJU tokens from our faucet to start experimenting on testnet.',
    icon: DropletIcon,
    action: {
      label: 'Go to Faucet',
      path: '/faucet',
    },
    details: [
      'Claim 100 JEJU every 12 hours',
      'Requires registered identity (prevents bots)',
      'New users can get a gas grant to register first',
    ],
  },
  {
    id: 'transfer',
    title: 'Bridge Assets Cross-Chain',
    description:
      'Use our EIL protocol to transfer tokens across different blockchains seamlessly.',
    icon: ZapIcon,
    action: {
      label: 'Go to Transfer',
      path: '/transfer',
    },
    details: [
      'Bridge to Ethereum, Arbitrum, Optimism, and more',
      'Low fees via XLP liquidity providers',
      'Fast settlements (5-30 minutes)',
    ],
  },
  {
    id: 'liquidity',
    title: 'Provide Liquidity',
    description:
      'Become an XLP and earn fees by providing cross-chain liquidity to the network.',
    icon: WavesIcon,
    action: {
      label: 'Go to Liquidity',
      path: '/liquidity',
    },
    details: [
      'Stake ETH on L1 to become an XLP',
      'Deposit tokens to provide liquidity',
      'Earn 0.05% fee on every bridge transaction',
    ],
  },
  {
    id: 'build',
    title: 'Build on Jeju',
    description:
      'Deploy your own contracts, oracles, and paymasters on the Jeju Network.',
    icon: ServerIcon,
    action: {
      label: 'Explore Build Tools',
      path: '/paymaster',
    },
    details: [
      'Deploy cross-chain paymasters',
      'Register oracle data feeds',
      'Create intent-based transactions',
    ],
  },
]

const STORAGE_KEY = 'jeju-gateway-onboarding-complete'

export function OnboardingWizard() {
  const navigate = useNavigate()
  useAccount() // Keep wallet connection context active
  const [isOpen, setIsOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    const isComplete = localStorage.getItem(STORAGE_KEY) === 'true'
    if (!isComplete) {
      // Delay opening to avoid jarring UX
      const timer = setTimeout(() => setIsOpen(true), 1000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [])

  const handleClose = () => {
    setIsOpen(false)
    localStorage.setItem(STORAGE_KEY, 'true')
  }

  const handleNext = () => {
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleClose()
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleAction = (path: string) => {
    handleClose()
    navigate(path)
  }

  const handleSkip = () => {
    handleClose()
  }

  if (!isOpen) return null

  const step = ONBOARDING_STEPS[currentStep]
  const StepIcon = step.icon
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1
  const isFirstStep = currentStep === 0

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-xl)',
          maxWidth: '520px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: 'var(--shadow-lg)',
          animation: 'fadeIn 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--gradient-brand)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <StepIcon size={20} style={{ color: 'white' }} />
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Step {currentStep + 1} of {ONBOARDING_STEPS.length}
              </p>
              <h2
                style={{
                  fontSize: '1.125rem',
                  fontWeight: 700,
                  margin: 0,
                  color: 'var(--text-primary)',
                }}
              >
                {step.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: '0.5rem',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
          >
            <XIcon size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem' }}>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.9375rem',
              lineHeight: 1.6,
              marginBottom: '1.5rem',
            }}
          >
            {step.description}
          </p>

          <div
            style={{
              background: 'var(--surface-hover)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
            }}
          >
            {step.details.map((detail, i) => (
              <div
                key={`detail-${step.id}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  marginBottom: i < step.details.length - 1 ? '0.75rem' : 0,
                }}
              >
                <div
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: 'var(--accent-primary-soft)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: '2px',
                  }}
                >
                  <CheckIcon
                    size={12}
                    style={{ color: 'var(--accent-primary)' }}
                  />
                </div>
                <p
                  style={{
                    fontSize: '0.875rem',
                    color: 'var(--text-secondary)',
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {detail}
                </p>
              </div>
            ))}
          </div>

          {step.action && (
            <button
              type="button"
              onClick={() => handleAction(step.action?.path ?? '')}
              style={{
                width: '100%',
                marginTop: '1.5rem',
                padding: '0.875rem',
                background: 'var(--gradient-accent)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontWeight: 600,
                fontSize: '0.9375rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              {step.action.label}
              <ArrowRightIcon size={18} />
            </button>
          )}
        </div>

        {/* Progress dots */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0 1.5rem 1rem',
          }}
        >
          {ONBOARDING_STEPS.map((_, i) => (
            <button
              key={`dot-${i}`}
              type="button"
              onClick={() => setCurrentStep(i)}
              style={{
                width: i === currentStep ? '24px' : '8px',
                height: '8px',
                borderRadius: 'var(--radius-full)',
                background:
                  i === currentStep ? 'var(--accent-primary)' : 'var(--border)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            />
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {isFirstStep ? (
            <button
              type="button"
              onClick={handleSkip}
              style={{
                padding: '0.625rem 1rem',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Skip tour
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePrev}
              style={{
                padding: '0.625rem 1rem',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
              }}
            >
              <ChevronLeftIcon size={16} />
              Back
            </button>
          )}

          <button
            type="button"
            onClick={handleNext}
            className="button"
            style={{
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
            }}
          >
            {isLastStep ? (
              'Get Started'
            ) : (
              <>
                Next
                <ChevronRightIcon size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Hook to trigger onboarding manually
 */
export function useOnboarding() {
  const [isOpen, setIsOpen] = useState(false)

  const openOnboarding = () => {
    localStorage.removeItem(STORAGE_KEY)
    setIsOpen(true)
  }

  const resetOnboarding = () => {
    localStorage.removeItem(STORAGE_KEY)
  }

  return { isOpen, openOnboarding, resetOnboarding }
}

export default OnboardingWizard
