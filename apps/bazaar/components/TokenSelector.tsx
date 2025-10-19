'use client'

import { useState } from 'react'
import { getAllTokens, TokenInfo, isTokenDeployed } from '@/config/tokens'
import { clsx } from 'clsx'

interface TokenSelectorProps {
  selected: string
  onSelect: (symbol: string) => void
  exclude?: string
}

export function TokenSelector({ selected, onSelect, exclude }: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const tokens = getAllTokens().filter((t) => t.symbol !== exclude && isTokenDeployed(t))

  const selectedToken = tokens.find((t) => t.symbol === selected)

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
      >
        <span className="font-semibold">{selectedToken?.symbol || 'Select'}</span>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full mt-2 w-64 rounded-lg bg-slate-800 border border-white/10 shadow-xl z-50 max-h-80 overflow-y-auto">
            {tokens.map((token) => (
              <button
                key={token.symbol}
                onClick={() => {
                  onSelect(token.symbol)
                  setIsOpen(false)
                }}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors',
                  selected === token.symbol && 'bg-white/5'
                )}
              >
                <div className="flex-1 text-left">
                  <div className="font-semibold">{token.symbol}</div>
                  <div className="text-sm text-slate-400">{token.name}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

