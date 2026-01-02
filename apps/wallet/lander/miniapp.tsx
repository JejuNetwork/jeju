/**
 * Wallet Miniapp
 *
 * Minimal wallet interface for Telegram and Farcaster miniapps.
 * Supports send/receive, balance checking, and basic transactions.
 */

import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void
        expand: () => void
        close: () => void
        MainButton: {
          text: string
          show: () => void
          hide: () => void
          onClick: (callback: () => void) => void
          offClick: (callback: () => void) => void
          enable: () => void
          disable: () => void
        }
        BackButton: {
          show: () => void
          hide: () => void
          onClick: (callback: () => void) => void
        }
        themeParams: {
          bg_color?: string
          text_color?: string
          hint_color?: string
          button_color?: string
          button_text_color?: string
        }
        initDataUnsafe: {
          user?: {
            id: number
            first_name: string
            last_name?: string
            username?: string
          }
        }
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy') => void
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void
        }
      }
    }
  }
}

type Screen = 'home' | 'send' | 'receive' | 'history'

interface Transaction {
  hash: string
  type: 'send' | 'receive'
  amount: string
  token: string
  to: string
  from: string
  chain: string
  timestamp: number
  status: 'pending' | 'confirmed' | 'failed'
}

const CHAINS = [
  { id: 'ethereum', name: 'Ethereum', icon: '⟠', color: '#627EEA' },
  { id: 'base', name: 'Base', icon: '🔵', color: '#0052FF' },
  { id: 'arbitrum', name: 'Arbitrum', icon: '🔷', color: '#28A0F0' },
  { id: 'optimism', name: 'Optimism', icon: '🔴', color: '#FF0420' },
]

function MiniApp() {
  const [screen, setScreen] = useState<Screen>('home')
  const [address, setAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState<string>('0.00')
  const [selectedChain, setSelectedChain] = useState(CHAINS[0])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [sendAmount, setSendAmount] = useState('')
  const [sendTo, setSendTo] = useState('')
  const [isTelegram, setIsTelegram] = useState(false)

  useEffect(() => {
    // Initialize Telegram WebApp if available
    if (window.Telegram?.WebApp) {
      setIsTelegram(true)
      window.Telegram.WebApp.ready()
      window.Telegram.WebApp.expand()
    }

    // Load or create wallet
    loadWallet()
  }, [])

  useEffect(() => {
    // Handle Telegram back button
    if (isTelegram && window.Telegram?.WebApp) {
      if (screen === 'home') {
        window.Telegram.WebApp.BackButton.hide()
      } else {
        window.Telegram.WebApp.BackButton.show()
        const handleBack = () => setScreen('home')
        window.Telegram.WebApp.BackButton.onClick(handleBack)
        return () => window.Telegram.WebApp.BackButton.offClick?.(handleBack)
      }
    }
    return undefined
  }, [screen, isTelegram])

  async function loadWallet() {
    // Check localStorage for existing wallet
    const saved = localStorage.getItem('wallet-address')
    if (saved) {
      setAddress(saved)
      fetchBalance(saved)
      fetchHistory(saved)
    }
  }

  async function fetchBalance(addr: string) {
    // In production, this would call the wallet API
    setBalance('1,234.56')
  }

  async function fetchHistory(addr: string) {
    // Mock transactions
    setTransactions([
      {
        hash: '0x123...',
        type: 'receive',
        amount: '100.00',
        token: 'USDC',
        to: addr,
        from: '0xabc...',
        chain: 'base',
        timestamp: Date.now() - 3600000,
        status: 'confirmed',
      },
      {
        hash: '0x456...',
        type: 'send',
        amount: '50.00',
        token: 'USDC',
        to: '0xdef...',
        from: addr,
        chain: 'ethereum',
        timestamp: Date.now() - 7200000,
        status: 'confirmed',
      },
    ])
  }

  async function createWallet() {
    // Generate address (in production, use proper key derivation)
    const mockAddress = `0x${Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('')}`
    localStorage.setItem('wallet-address', mockAddress)
    setAddress(mockAddress)
    haptic('success')
  }

  async function handleSend() {
    if (!sendAmount || !sendTo) return
    haptic('medium')
    // In production, this would create and sign the transaction
    console.log('Sending', sendAmount, 'to', sendTo)
    setScreen('home')
    setSendAmount('')
    setSendTo('')
  }

  function haptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'error') {
    if (window.Telegram?.WebApp?.HapticFeedback) {
      if (type === 'success' || type === 'error') {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred(type)
      } else {
        window.Telegram.WebApp.HapticFeedback.impactOccurred(type)
      }
    }
  }

  function formatAddress(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  function formatTime(ts: number): string {
    const diff = Date.now() - ts
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }

  if (!address) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col items-center justify-center p-6">
        <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-emerald-500/20">
          <svg
            className="w-10 h-10 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
            <path d="M16 12h.01" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold mb-2">Network Wallet</h1>
        <p className="text-gray-400 text-center mb-8">
          One wallet for every chain.<br />No bridging required.
        </p>
        <button
          onClick={createWallet}
          className="w-full max-w-xs bg-gradient-to-r from-emerald-500 to-green-600 text-white py-4 px-8 rounded-xl font-semibold text-lg"
        >
          Create Wallet
        </button>
        <button
          onClick={() => {
            const addr = prompt('Enter your address:')
            if (addr) {
              localStorage.setItem('wallet-address', addr)
              setAddress(addr)
            }
          }}
          className="mt-4 text-emerald-400 text-sm"
        >
          Import Existing Wallet
        </button>
      </div>
    )
  }

  if (screen === 'send') {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
        <header className="p-4 border-b border-white/10 flex items-center gap-4">
          <button onClick={() => setScreen('home')} className="text-emerald-400">
            ← Back
          </button>
          <h1 className="text-lg font-semibold">Send</h1>
        </header>

        <div className="flex-1 p-4 space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">To Address</label>
            <input
              type="text"
              placeholder="0x... or ENS name"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder:text-gray-500 focus:border-emerald-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-2 block">Amount</label>
            <div className="relative">
              <input
                type="text"
                placeholder="0.00"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-4 pr-20 text-white text-2xl font-semibold placeholder:text-gray-500 focus:border-emerald-400 focus:outline-none"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                USDC
              </span>
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-2 block">From Chain</label>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {CHAINS.map((chain) => (
                <button
                  key={chain.id}
                  onClick={() => setSelectedChain(chain)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl whitespace-nowrap ${
                    selectedChain.id === chain.id
                      ? 'bg-emerald-500/20 border border-emerald-400/50'
                      : 'bg-white/5 border border-white/10'
                  }`}
                >
                  <span>{chain.icon}</span>
                  <span>{chain.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/10">
          <button
            onClick={handleSend}
            disabled={!sendAmount || !sendTo}
            className="w-full bg-gradient-to-r from-emerald-500 to-green-600 text-white py-4 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    )
  }

  if (screen === 'receive') {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
        <header className="p-4 border-b border-white/10 flex items-center gap-4">
          <button onClick={() => setScreen('home')} className="text-emerald-400">
            ← Back
          </button>
          <h1 className="text-lg font-semibold">Receive</h1>
        </header>

        <div className="flex-1 p-4 flex flex-col items-center justify-center">
          <div className="w-48 h-48 bg-white rounded-2xl p-3 mb-6">
            {/* QR Code placeholder - in production use a QR library */}
            <div className="w-full h-full bg-[repeating-conic-gradient(#000_0%_25%,#fff_0%_50%)] bg-[length:10%_10%]" />
          </div>
          <p className="text-sm text-gray-400 mb-2">Your Address</p>
          <p className="font-mono text-sm bg-white/5 px-4 py-2 rounded-lg break-all max-w-full">
            {address}
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(address)
              haptic('success')
            }}
            className="mt-4 text-emerald-400 text-sm"
          >
            Copy Address
          </button>
          <p className="mt-8 text-sm text-gray-500 text-center">
            Send any token to this address on any supported chain.<br />
            Your balance will update automatically.
          </p>
        </div>
      </div>
    )
  }

  if (screen === 'history') {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
        <header className="p-4 border-b border-white/10 flex items-center gap-4">
          <button onClick={() => setScreen('home')} className="text-emerald-400">
            ← Back
          </button>
          <h1 className="text-lg font-semibold">History</h1>
        </header>

        <div className="flex-1 p-4">
          {transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <p>No transactions yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <div
                  key={tx.hash}
                  className="bg-white/5 border border-white/10 rounded-xl p-4"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className={tx.type === 'receive' ? 'text-emerald-400' : 'text-white'}>
                        {tx.type === 'receive' ? '+' : '-'}
                        {tx.amount} {tx.token}
                      </p>
                      <p className="text-sm text-gray-500">
                        {tx.type === 'receive' ? 'From' : 'To'}{' '}
                        {formatAddress(tx.type === 'receive' ? tx.from : tx.to)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-400">{formatTime(tx.timestamp)}</p>
                      <p className="text-xs text-gray-500">{tx.chain}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Home screen
  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
      {/* Header */}
      <header className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center">
              <svg
                className="w-5 h-5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                <path d="M16 12h.01" />
              </svg>
            </div>
            <div>
              <p className="font-semibold">Network Wallet</p>
              <p className="text-xs text-gray-500">{formatAddress(address)}</p>
            </div>
          </div>
          <button
            onClick={() => setScreen('history')}
            className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center"
          >
            <svg
              className="w-5 h-5 text-gray-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
        </div>
      </header>

      {/* Balance */}
      <div className="p-6 text-center">
        <p className="text-sm text-gray-400 mb-1">Total Balance</p>
        <p className="text-4xl font-bold mb-1">${balance}</p>
        <p className="text-sm text-emerald-400">All Chains Combined</p>
      </div>

      {/* Actions */}
      <div className="px-4 flex gap-3">
        <button
          onClick={() => {
            haptic('light')
            setScreen('send')
          }}
          className="flex-1 bg-emerald-500/20 border border-emerald-500/30 rounded-xl py-4 flex flex-col items-center gap-2"
        >
          <svg
            className="w-6 h-6 text-emerald-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
          <span className="text-sm font-medium">Send</span>
        </button>
        <button
          onClick={() => {
            haptic('light')
            setScreen('receive')
          }}
          className="flex-1 bg-white/5 border border-white/10 rounded-xl py-4 flex flex-col items-center gap-2"
        >
          <svg
            className="w-6 h-6 text-gray-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
          <span className="text-sm font-medium">Receive</span>
        </button>
      </div>

      {/* Chains */}
      <div className="p-4 mt-4">
        <p className="text-sm text-gray-400 mb-3">Balances by Chain</p>
        <div className="space-y-2">
          {CHAINS.map((chain) => (
            <div
              key={chain.id}
              className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{chain.icon}</span>
                <span className="font-medium">{chain.name}</span>
              </div>
              <span className="font-mono">$308.64</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      {transactions.length > 0 && (
        <div className="p-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-gray-400">Recent Activity</p>
            <button
              onClick={() => setScreen('history')}
              className="text-sm text-emerald-400"
            >
              See All
            </button>
          </div>
          <div className="space-y-2">
            {transactions.slice(0, 2).map((tx) => (
              <div
                key={tx.hash}
                className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      tx.type === 'receive'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-white/10 text-gray-400'
                    }`}
                  >
                    {tx.type === 'receive' ? '↓' : '↑'}
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {tx.type === 'receive' ? 'Received' : 'Sent'}
                    </p>
                    <p className="text-xs text-gray-500">{formatTime(tx.timestamp)}</p>
                  </div>
                </div>
                <p
                  className={`font-mono text-sm ${
                    tx.type === 'receive' ? 'text-emerald-400' : 'text-white'
                  }`}
                >
                  {tx.type === 'receive' ? '+' : '-'}
                  {tx.amount} {tx.token}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<MiniApp />)
}
