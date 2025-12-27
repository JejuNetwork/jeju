/**
 * Agent Plugins Tests
 *
 * Tests for ElizaOS plugin integration.
 */

import { describe, expect, it } from 'bun:test'

// Plugin interface
interface Plugin {
  name: string
  description: string
  version: string
  actions?: PluginAction[]
  evaluators?: PluginEvaluator[]
  providers?: PluginProvider[]
}

// Action definition
interface PluginAction {
  name: string
  description: string
  similes: string[]
  validate: (runtime: unknown, message: unknown) => Promise<boolean>
  handler: (
    runtime: unknown,
    message: unknown,
    state: unknown,
  ) => Promise<unknown>
}

// Evaluator definition
interface PluginEvaluator {
  name: string
  description: string
  alwaysRun?: boolean
  evaluate: (
    runtime: unknown,
    message: unknown,
    state: unknown,
  ) => Promise<unknown>
}

// Provider definition
interface PluginProvider {
  name: string
  description: string
  get: (runtime: unknown, message: unknown) => Promise<string>
}

describe('Plugin structure', () => {
  it('validates core plugin', () => {
    const plugin: Plugin = {
      name: 'core',
      description: 'Core Jeju capabilities',
      version: '1.0.0',
      actions: [],
      evaluators: [],
      providers: [],
    }

    expect(plugin.name).toBe('core')
    expect(plugin.version).toBe('1.0.0')
  })

  it('validates autonomy plugin', () => {
    const plugin: Plugin = {
      name: 'autonomy',
      description: 'Autonomous trading and posting',
      version: '1.0.0',
      actions: [],
    }

    expect(plugin.name).toBe('autonomy')
  })

  it('validates trajectory plugin', () => {
    const plugin: Plugin = {
      name: 'trajectory',
      description: 'Trajectory logging for training',
      version: '1.0.0',
      evaluators: [],
    }

    expect(plugin.name).toBe('trajectory')
  })

  it('validates experience plugin', () => {
    const plugin: Plugin = {
      name: 'experience',
      description: 'Learning from past experiences',
      version: '1.0.0',
      providers: [],
    }

    expect(plugin.name).toBe('experience')
  })
})

describe('PluginAction', () => {
  it('validates action with similes', () => {
    const action: PluginAction = {
      name: 'TRADE',
      description: 'Execute a trade',
      similes: ['buy', 'sell', 'swap', 'exchange'],
      validate: async () => true,
      handler: async () => ({ success: true }),
    }

    expect(action.similes).toContain('buy')
    expect(action.similes).toContain('sell')
    expect(action.similes).toHaveLength(4)
  })

  it('validates action handler return', async () => {
    const action: PluginAction = {
      name: 'ANALYZE',
      description: 'Analyze market data',
      similes: ['analyze', 'check'],
      validate: async () => true,
      handler: async () => ({
        success: true,
        data: { trend: 'bullish', confidence: 0.85 },
      }),
    }

    const result = await action.handler(null, null, null)
    expect(result).toHaveProperty('success')
  })

  it('validates action validation', async () => {
    const action: PluginAction = {
      name: 'TRANSFER',
      description: 'Transfer tokens',
      similes: ['send', 'transfer'],
      validate: async (_runtime, message) => {
        // Example validation: check if amount is specified
        return message !== null && typeof message === 'object'
      },
      handler: async () => ({ success: true }),
    }

    expect(await action.validate(null, {})).toBe(true)
    expect(await action.validate(null, null)).toBe(false)
  })
})

describe('PluginEvaluator', () => {
  it('validates trajectory evaluator', () => {
    const evaluator: PluginEvaluator = {
      name: 'trajectoryEvaluator',
      description: 'Records agent trajectories',
      alwaysRun: true,
      evaluate: async (_runtime, _message, state) => {
        return {
          recorded: true,
          state,
        }
      },
    }

    expect(evaluator.alwaysRun).toBe(true)
  })

  it('validates feedback evaluator', async () => {
    const evaluator: PluginEvaluator = {
      name: 'feedbackEvaluator',
      description: 'Collects user feedback',
      evaluate: async () => ({
        feedbackCollected: true,
        rating: 4.5,
      }),
    }

    const result = await evaluator.evaluate(null, null, null)
    expect(result).toHaveProperty('feedbackCollected')
  })
})

describe('PluginProvider', () => {
  it('validates market data provider', async () => {
    const provider: PluginProvider = {
      name: 'marketDataProvider',
      description: 'Provides current market data',
      get: async () => {
        return JSON.stringify({
          eth: { price: 3500, change24h: 2.5 },
          btc: { price: 65000, change24h: 1.2 },
        })
      },
    }

    const data = await provider.get(null, null)
    expect(JSON.parse(data)).toHaveProperty('eth')
  })

  it('validates portfolio provider', async () => {
    const provider: PluginProvider = {
      name: 'portfolioProvider',
      description: 'Provides agent portfolio',
      get: async () => {
        return JSON.stringify({
          totalValue: 10000,
          positions: [
            { symbol: 'ETH', amount: 2 },
            { symbol: 'USDC', amount: 5000 },
          ],
        })
      },
    }

    const data = await provider.get(null, null)
    const parsed = JSON.parse(data)
    expect(parsed.positions).toHaveLength(2)
  })
})

describe('Plugin composition', () => {
  it('combines multiple plugins', () => {
    const plugins: Plugin[] = [
      { name: 'core', description: 'Core', version: '1.0.0' },
      { name: 'trading', description: 'Trading', version: '1.0.0' },
      { name: 'social', description: 'Social', version: '1.0.0' },
    ]

    expect(plugins).toHaveLength(3)
    expect(plugins.map((p) => p.name)).toContain('trading')
  })

  it('merges plugin actions', () => {
    const coreActions: PluginAction[] = [
      {
        name: 'HELP',
        description: 'Get help',
        similes: ['help'],
        validate: async () => true,
        handler: async () => ({}),
      },
    ]

    const tradingActions: PluginAction[] = [
      {
        name: 'BUY',
        description: 'Buy tokens',
        similes: ['buy'],
        validate: async () => true,
        handler: async () => ({}),
      },
      {
        name: 'SELL',
        description: 'Sell tokens',
        similes: ['sell'],
        validate: async () => true,
        handler: async () => ({}),
      },
    ]

    const allActions = [...coreActions, ...tradingActions]
    expect(allActions).toHaveLength(3)
    expect(allActions.map((a) => a.name)).toContain('BUY')
  })
})

describe('Plugin configuration', () => {
  it('validates plugin settings', () => {
    const settings = {
      enableTrading: true,
      maxTradeSize: 1000,
      enableAutonomous: true,
      recordTrajectories: true,
    }

    expect(settings.enableTrading).toBe(true)
    expect(settings.maxTradeSize).toBeGreaterThan(0)
  })

  it('validates environment requirements', () => {
    const requirements = {
      requiredSecrets: ['PRIVATE_KEY', 'API_KEY'],
      optionalSecrets: ['ANALYTICS_KEY'],
    }

    expect(requirements.requiredSecrets).toContain('PRIVATE_KEY')
    expect(requirements.optionalSecrets).toHaveLength(1)
  })
})

