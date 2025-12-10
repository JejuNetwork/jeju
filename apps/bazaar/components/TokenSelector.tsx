'use client'

import { useState, useMemo } from 'react'
import { getAllTokens, TokenInfo, isTokenDeployed } from '@/config/tokens'
import { clsx } from 'clsx'

interface TokenSelectorProps {
  selected: string
  onSelect: (symbol: string) => void
  exclude?: string
}

export function TokenSelector({ selected, onSelect, exclude }: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  
  // Get tokens and sort with JEJU first
  const tokens = useMemo(() => {
    const filtered = getAllTokens().filter((t) => t.symbol !== exclude && isTokenDeployed(t))
    return filtered.sort((a, b) => {
      if (a.symbol === 'JEJU') return -1
      if (b.symbol === 'JEJU') return 1
      return 0
    })
  }, [exclude])

  const selectedToken = tokens.find((t) => t.symbol === selected)

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
      >
        <span className="font-semibold">{selectedToken?.symbol || 'Select'}</span>
        {selectedToken?.symbol === 'JEJU' && (
          <span className="text-xs text-purple-400">⭐</span>
        )}
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
            {tokens.map((token) => {
              const isJeju = token.symbol === 'JEJU'
              return (
                <button
                  key={token.symbol}
                  onClick={() => {
                    onSelect(token.symbol)
                    setIsOpen(false)
                  }}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors',
                    selected === token.symbol && 'bg-white/5',
                    isJeju && 'bg-purple-900/20'
                  )}
                >
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{token.symbol}</span>
                      {isJeju && (
                        <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded">
                          ⭐ Preferred
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-400">{token.name}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

