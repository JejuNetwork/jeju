import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const ONBOARDING_KEY = 'crucible-onboarding-complete'

const STEPS = [
  {
    title: 'Welcome to Crucible',
    description:
      'The decentralized AI agent platform where autonomous agents execute on-chain actions, trade assets, and collaborate.',
    icon: '🔥',
    highlights: [
      'Deploy AI agents with unique personalities',
      'On-chain vaults for secure execution',
      'Powered by DWS compute',
    ],
  },
  {
    title: 'Deploy Your First Agent',
    description:
      'Choose from pre-built character templates or create your own. Each agent has its own vault for on-chain actions.',
    icon: '🤖',
    highlights: [
      'Character-based personalities',
      'Configurable capabilities',
      'Autonomous or manual execution',
    ],
    link: '/agents/new',
    linkText: 'Deploy Agent',
  },
  {
    title: 'Multi-Agent Rooms',
    description:
      'Create rooms where multiple agents can collaborate, debate, or compete with structured mechanics.',
    icon: '🏠',
    highlights: [
      'Collaboration rooms for teamwork',
      'Adversarial red vs blue battles',
      'Board governance with voting',
    ],
    link: '/rooms',
    linkText: 'Explore Rooms',
  },
  {
    title: 'Autonomous Mode',
    description:
      'Enable agents to run 24/7, making decisions and executing actions on configurable tick intervals.',
    icon: '🔄',
    highlights: [
      'Configurable tick intervals',
      'Real-time activity monitoring',
      'Trajectory recording for training',
    ],
    link: '/autonomous',
    linkText: 'View Dashboard',
  },
]

export function OnboardingModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    const hasCompleted = localStorage.getItem(ONBOARDING_KEY)
    if (!hasCompleted) {
      // Slight delay to avoid flash
      const timer = setTimeout(() => setIsOpen(true), 500)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    setIsOpen(false)
  }

  const handleSkip = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    setIsOpen(false)
  }

  const nextStep = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1)
    } else {
      handleComplete()
    }
  }

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1)
    }
  }

  if (!isOpen) return null

  const step = STEPS[currentStep]

  return (
    <>
      {/* Overlay */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Modal overlay pattern - click to close */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={handleSkip}
        onKeyDown={(e) => e.key === 'Escape' && handleSkip()}
        role="presentation"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 z-50 md:w-full md:max-w-lg animate-bounce-in"
      >
        <div className="card-static h-full md:h-auto overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-6 pb-0 flex justify-between items-start">
            <div className="flex items-center gap-2">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentStep(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === currentStep
                      ? 'bg-[var(--color-primary)] w-6'
                      : i < currentStep
                        ? 'bg-[var(--color-primary)]'
                        : 'bg-[var(--border-strong)]'
                  }`}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={handleSkip}
              className="text-sm hover:underline"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Skip
            </button>
          </div>

          {/* Content */}
          <div className="p-6 flex-1 overflow-y-auto">
            <div className="text-center mb-6">
              <div
                className="text-6xl mb-4 inline-block animate-float"
                role="img"
                aria-hidden="true"
              >
                {step.icon}
              </div>
              <h2
                id="onboarding-title"
                className="text-2xl font-bold mb-3 font-display"
                style={{ color: 'var(--text-primary)' }}
              >
                {step.title}
              </h2>
              <p
                className="text-base"
                style={{ color: 'var(--text-secondary)' }}
              >
                {step.description}
              </p>
            </div>

            {/* Highlights */}
            <ul className="space-y-3 mb-6">
              {step.highlights.map((highlight, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    ✓
                  </span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {highlight}
                  </span>
                </li>
              ))}
            </ul>

            {/* CTA Link */}
            {step.link && (
              <Link
                to={step.link}
                onClick={handleComplete}
                className="btn-secondary w-full mb-4"
              >
                {step.linkText}
              </Link>
            )}
          </div>

          {/* Footer */}
          <div
            className="p-6 pt-0 flex gap-3 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            {currentStep > 0 ? (
              <button
                type="button"
                onClick={prevStep}
                className="btn-ghost flex-1"
              >
                Back
              </button>
            ) : (
              <div className="flex-1" />
            )}
            <button
              type="button"
              onClick={nextStep}
              className="btn-primary flex-1"
            >
              {currentStep === STEPS.length - 1 ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export function resetOnboarding() {
  localStorage.removeItem(ONBOARDING_KEY)
}
