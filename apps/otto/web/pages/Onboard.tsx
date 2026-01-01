import React, { useState } from 'react'
import {
  DiscordIcon,
  TelegramIcon,
  FarcasterIcon,
  WhatsAppIcon,
  TwitterIcon,
  WalletIcon,
  CheckIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
} from '../components/Icons'

type Platform = 'discord' | 'telegram' | 'farcaster' | 'whatsapp' | 'twitter' | 'web'

interface Props {
  onNavigate: (page: 'landing' | 'onboard' | 'configure' | 'chat') => void
  onSessionCreated: (sessionId: string) => void
}

interface StepProps {
  onNext: () => void
  onBack?: () => void
}

export function Onboard({ onNavigate, onSessionCreated }: Props) {
  const [step, setStep] = useState(0)
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([])
  const [walletConnected, setWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState('')

  const steps = [
    { title: 'Welcome', component: WelcomeStep },
    { title: 'Platform', component: PlatformStep },
    { title: 'Wallet', component: WalletStep },
    { title: 'Invite', component: InviteStep },
    { title: 'Complete', component: CompleteStep },
  ]

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1)
    }
  }

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1)
    }
  }

  const handleComplete = async () => {
    // Create session with API
    const response = await fetch('/api/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platforms: selectedPlatforms,
        walletAddress,
        inviteCode: inviteCode || undefined,
      }),
    })

    const data = await response.json()
    onSessionCreated(data.sessionId)
    onNavigate('configure')
  }

  const togglePlatform = (platform: Platform) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform],
    )
  }

  const connectWallet = async () => {
    // Check for injected wallet
    if (typeof window !== 'undefined' && (window as { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }).ethereum) {
      const accounts = await (window as { ethereum: { request: (args: { method: string }) => Promise<string[]> } }).ethereum.request({
        method: 'eth_requestAccounts',
      })
      if (accounts[0]) {
        setWalletAddress(accounts[0])
        setWalletConnected(true)
      }
    } else {
      // Demo mode - generate fake address
      const demoAddress = '0x' + Array.from({ length: 40 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join('')
      setWalletAddress(demoAddress)
      setWalletConnected(true)
    }
  }

  const CurrentStepComponent = steps[step].component

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-pattern" />
      <div className="grid-pattern" />

      {/* Header */}
      <header className="relative z-10 border-b border-surface-border">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => onNavigate('landing')}
            className="flex items-center gap-3 text-otto-cyan font-bold text-xl"
          >
            <div className="w-9 h-9 bg-gradient-to-br from-otto-cyan to-otto-purple rounded-xl flex items-center justify-center text-sm shadow-lg shadow-otto-cyan/30">
              O
            </div>
            Otto
          </button>

          {/* Progress */}
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div
                key={i}
                className={`w-8 h-1.5 rounded-full transition-all ${
                  i <= step ? 'bg-otto-cyan' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 relative z-10 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl">
          <CurrentStepComponent
            onNext={handleNext}
            onBack={step > 0 ? handleBack : undefined}
            selectedPlatforms={selectedPlatforms}
            togglePlatform={togglePlatform}
            walletConnected={walletConnected}
            walletAddress={walletAddress}
            connectWallet={connectWallet}
            inviteCode={inviteCode}
            setInviteCode={setInviteCode}
            onComplete={handleComplete}
          />
        </div>
      </main>
    </div>
  )
}

function WelcomeStep({ onNext }: StepProps) {
  return (
    <div className="text-center animate-fade-in-up">
      <div className="w-20 h-20 bg-gradient-to-br from-otto-cyan to-otto-purple rounded-3xl flex items-center justify-center text-4xl mx-auto mb-8 shadow-xl shadow-otto-cyan/30">
        O
      </div>
      <h1 className="text-4xl font-bold mb-4">Welcome to Otto</h1>
      <p className="text-xl text-white/60 mb-10 max-w-md mx-auto">
        Your AI-powered trading agent that works across Discord, Telegram, and more.
      </p>
      <button onClick={onNext} className="btn-primary text-lg px-10 py-4">
        Let's Get Started
        <span className="w-5 h-5">
          <ArrowRightIcon />
        </span>
      </button>
    </div>
  )
}

function PlatformStep({
  onNext,
  onBack,
  selectedPlatforms,
  togglePlatform,
}: StepProps & {
  selectedPlatforms: Platform[]
  togglePlatform: (platform: Platform) => void
}) {
  const platforms: { id: Platform; name: string; icon: React.ReactNode; className: string }[] = [
    { id: 'telegram', name: 'Telegram', icon: <TelegramIcon />, className: 'telegram' },
    { id: 'discord', name: 'Discord', icon: <DiscordIcon />, className: 'discord' },
    { id: 'farcaster', name: 'Farcaster', icon: <FarcasterIcon />, className: 'farcaster' },
    { id: 'whatsapp', name: 'WhatsApp', icon: <WhatsAppIcon />, className: 'whatsapp' },
    { id: 'twitter', name: 'X / Twitter', icon: <TwitterIcon />, className: 'twitter' },
  ]

  return (
    <div className="animate-fade-in-up">
      <h2 className="text-3xl font-bold mb-3 text-center">Choose your platforms</h2>
      <p className="text-white/60 mb-8 text-center">
        Select where you want to use Otto. You can add more later.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-10">
        {platforms.map(({ id, name, icon, className }) => {
          const isSelected = selectedPlatforms.includes(id)
          return (
            <button
              key={id}
              onClick={() => togglePlatform(id)}
              className={`platform-btn ${className} justify-between ${
                isSelected ? 'border-otto-cyan bg-otto-cyan/10' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 h-6">{icon}</span>
                {name}
              </div>
              {isSelected && (
                <span className="w-5 h-5 text-otto-cyan">
                  <CheckIcon />
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex gap-4">
        {onBack && (
          <button onClick={onBack} className="btn-secondary flex-1">
            <span className="w-5 h-5">
              <ArrowLeftIcon />
            </span>
            Back
          </button>
        )}
        <button
          onClick={onNext}
          disabled={selectedPlatforms.length === 0}
          className={`btn-primary flex-1 ${
            selectedPlatforms.length === 0 ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          Continue
          <span className="w-5 h-5">
            <ArrowRightIcon />
          </span>
        </button>
      </div>
    </div>
  )
}

function WalletStep({
  onNext,
  onBack,
  walletConnected,
  walletAddress,
  connectWallet,
}: StepProps & {
  walletConnected: boolean
  walletAddress: string | null
  connectWallet: () => Promise<void>
}) {
  return (
    <div className="animate-fade-in-up">
      <h2 className="text-3xl font-bold mb-3 text-center">Connect your wallet</h2>
      <p className="text-white/60 mb-8 text-center">
        Connect a wallet to trade and manage your assets. Your keys stay with you.
      </p>

      <div className="card mb-8">
        {walletConnected ? (
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-otto-green/20 rounded-xl flex items-center justify-center">
              <span className="w-6 h-6 text-otto-green">
                <CheckIcon />
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-otto-green">Wallet Connected</p>
              <p className="text-white/60 text-sm truncate">{walletAddress}</p>
            </div>
          </div>
        ) : (
          <button
            onClick={connectWallet}
            className="w-full flex items-center gap-4 group"
          >
            <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center group-hover:bg-otto-cyan/20 transition-colors">
              <span className="w-6 h-6 text-white/70 group-hover:text-otto-cyan">
                <WalletIcon />
              </span>
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold group-hover:text-otto-cyan transition-colors">
                Connect Wallet
              </p>
              <p className="text-white/60 text-sm">MetaMask, WalletConnect, or any EIP-1193 wallet</p>
            </div>
            <span className="w-5 h-5 text-white/40 group-hover:text-otto-cyan transition-colors">
              <ArrowRightIcon />
            </span>
          </button>
        )}
      </div>

      <div className="flex gap-4">
        {onBack && (
          <button onClick={onBack} className="btn-secondary flex-1">
            <span className="w-5 h-5">
              <ArrowLeftIcon />
            </span>
            Back
          </button>
        )}
        <button onClick={onNext} className="btn-primary flex-1">
          {walletConnected ? 'Continue' : 'Skip for Now'}
          <span className="w-5 h-5">
            <ArrowRightIcon />
          </span>
        </button>
      </div>
    </div>
  )
}

function InviteStep({
  onNext,
  onBack,
  inviteCode,
  setInviteCode,
}: StepProps & {
  inviteCode: string
  setInviteCode: (code: string) => void
}) {
  return (
    <div className="animate-fade-in-up">
      <h2 className="text-3xl font-bold mb-3 text-center">Have an invite code?</h2>
      <p className="text-white/60 mb-8 text-center">
        Enter a friend's invite code to unlock bonus features and help them earn rewards.
      </p>

      <div className="mb-8">
        <input
          type="text"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          placeholder="Enter invite code (optional)"
          className="input text-center text-lg tracking-widest uppercase"
          maxLength={8}
        />
      </div>

      <div className="card mb-8 bg-otto-purple/10 border-otto-purple/30">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-otto-purple/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-otto-purple text-lg">🎁</span>
          </div>
          <div>
            <p className="font-semibold text-otto-purple">Referral Rewards</p>
            <p className="text-white/60 text-sm">
              Both you and your friend get 10% bonus on trading rewards for the first month.
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        {onBack && (
          <button onClick={onBack} className="btn-secondary flex-1">
            <span className="w-5 h-5">
              <ArrowLeftIcon />
            </span>
            Back
          </button>
        )}
        <button onClick={onNext} className="btn-primary flex-1">
          Continue
          <span className="w-5 h-5">
            <ArrowRightIcon />
          </span>
        </button>
      </div>
    </div>
  )
}

function CompleteStep({
  onBack,
  onComplete,
  selectedPlatforms,
  walletConnected,
}: StepProps & {
  onComplete: () => void
  selectedPlatforms: Platform[]
  walletConnected: boolean
}) {
  const [isLoading, setIsLoading] = useState(false)

  const handleComplete = async () => {
    setIsLoading(true)
    await onComplete()
  }

  return (
    <div className="animate-fade-in-up text-center">
      <div className="w-20 h-20 bg-otto-green/20 rounded-3xl flex items-center justify-center mx-auto mb-8">
        <span className="w-10 h-10 text-otto-green">
          <CheckIcon />
        </span>
      </div>

      <h2 className="text-3xl font-bold mb-3">You're all set.</h2>
      <p className="text-white/60 mb-10 max-w-md mx-auto">
        Otto is ready to help you trade across{' '}
        {selectedPlatforms.length} platform{selectedPlatforms.length !== 1 ? 's' : ''}.
        {walletConnected && ' Your wallet is connected for seamless trading.'}
      </p>

      <div className="card mb-10 text-left">
        <h3 className="font-semibold mb-4">What's next?</h3>
        <ul className="space-y-3 text-white/70">
          <li className="flex items-center gap-3">
            <span className="w-5 h-5 text-otto-cyan">
              <CheckIcon />
            </span>
            Configure your trading settings
          </li>
          <li className="flex items-center gap-3">
            <span className="w-5 h-5 text-otto-cyan">
              <CheckIcon />
            </span>
            Add Otto to your selected platforms
          </li>
          <li className="flex items-center gap-3">
            <span className="w-5 h-5 text-otto-cyan">
              <CheckIcon />
            </span>
            Start trading with natural language
          </li>
        </ul>
      </div>

      <div className="flex gap-4">
        {onBack && (
          <button onClick={onBack} className="btn-secondary flex-1" disabled={isLoading}>
            <span className="w-5 h-5">
              <ArrowLeftIcon />
            </span>
            Back
          </button>
        )}
        <button
          onClick={handleComplete}
          disabled={isLoading}
          className="btn-primary flex-1"
        >
          {isLoading ? 'Setting up...' : 'Complete Setup'}
          {!isLoading && (
            <span className="w-5 h-5">
              <ArrowRightIcon />
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
