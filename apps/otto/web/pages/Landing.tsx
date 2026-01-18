/**
 * Otto Landing Page
 */

import { useState } from 'react'

interface LandingProps {
  onStartChat: () => void
}

export function Landing({ onStartChat }: LandingProps) {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)

  const openWizard = () => {
    setWizardStep(0)
    setWizardOpen(true)
  }

  const handleNext = () => {
    if (wizardStep >= 2) {
      setWizardOpen(false)
      onStartChat()
      return
    }
    setWizardStep((current) => current + 1)
  }

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="logo">
          <span className="logo-icon">🤖</span>
          <span className="logo-text">Otto</span>
        </div>
        <button
          type="button"
          className="cta-button"
          style={{ backgroundColor: '#6366f1' }}
          onClick={openWizard}
        >
          Get Started
        </button>
      </header>

      <main className="landing-main" data-testid="landing-hero">
        <h1 className="landing-title">AI Trading Agent</h1>
        <p className="landing-subtitle">
          Trade, bridge, and launch tokens with natural language
        </p>

        <section className="features-section">
          <div className="feature-card">
            <span className="feature-icon">💱</span>
            <h3>Swap Tokens</h3>
            <p>Exchange tokens across multiple chains with the best rates</p>
          </div>

          <div className="feature-card">
            <span className="feature-icon">🌉</span>
            <h3>Bridge Assets</h3>
            <p>Move assets between Ethereum, Base, Arbitrum, and more</p>
          </div>

          <div className="feature-card">
            <span className="feature-icon">🚀</span>
            <h3>Launch Tokens</h3>
            <p>Create new tokens with bonding curves in seconds</p>
          </div>

          <div className="feature-card">
            <span className="feature-icon">📊</span>
            <h3>Track Portfolio</h3>
            <p>View balances and prices across all your wallets</p>
          </div>
        </section>

        <button
          type="button"
          className="cta-button"
          style={{ backgroundColor: '#6366f1' }}
          onClick={openWizard}
        >
          Get Started
        </button>

        <div className="platforms">
          <p>Also available on:</p>
          <div className="platform-icons">
            <span title="Discord">Discord</span>
            <span title="Telegram">Telegram</span>
            <span title="Farcaster">Farcaster</span>
            <span title="Twitter/X">Twitter</span>
          </div>
        </div>
      </main>

      <footer className="landing-footer">
        <div className="footer-links">
          <a href="https://jejunetwork.org">Jeju Network</a>
          <a href="https://docs.jejunetwork.org">Docs</a>
          <a href="https://x.com/jejunetwork">X</a>
        </div>
        <p>Powered by Jeju Network</p>
      </footer>

      {wizardOpen ? (
        <div className="wizard-modal" role="dialog">
          <div className="wizard-card">
            <h2>Get Started</h2>
            <p>Step {wizardStep + 1} of 3</p>
            <button type="button" onClick={handleNext}>
              {wizardStep >= 2 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
