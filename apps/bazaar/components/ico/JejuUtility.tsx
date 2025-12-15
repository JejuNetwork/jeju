'use client'

import { JEJU_TOKENOMICS } from '@/config/jeju-tokenomics'

const ICONS: Record<string, string> = {
  vote: '🗳️',
  shield: '🛡️',
  lock: '🔒',
  cpu: '💻',
  database: '💾',
  store: '🏪',
  globe: '🌐',
}

export function JejuUtility() {
  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
        Token Utility
      </h3>
      
      <div className="space-y-6">
        {/* Exclusive JEJU utility */}
        <div>
          <h4 className="text-sm font-medium mb-3 text-bazaar-primary">
            Exclusive JEJU Functions
          </h4>
          <div className="space-y-2">
            {JEJU_TOKENOMICS.exclusiveUtility.map((item) => (
              <div key={item.name} className="flex items-center gap-3 p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <span className="text-lg">{ICONS[item.icon]}</span>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.name}</div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{item.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {/* Universal payment */}
        <div>
          <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
            Universal Payment (Any Token)
          </h4>
          <div className="space-y-2">
            {JEJU_TOKENOMICS.universalPayment.map((item) => (
              <div key={item.name} className="flex items-center gap-3 p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <span className="text-lg">{ICONS[item.icon]}</span>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.name}</div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{item.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
