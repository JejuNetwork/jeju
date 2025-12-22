/**
 * Launchpad Actions - Token launches, presales, and bonding curves
 */

import type {
  Action,
  ActionExample,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { getNetworkName } from '@jejunetwork/config'
import { type Address, formatEther, type Hex, parseEther } from 'viem'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import { getMessageText, validateServiceExists } from '../validation'

const networkName = getNetworkName()

// ============================================================================
// Create Token
// ============================================================================

export const createTokenAction: Action = {
  name: 'CREATE_TOKEN',
  similes: ['create token', 'launch token', 'deploy token', 'new token'],
  description: `Create a new ERC-20 token on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    // Parse token details
    const nameMatch = text.match(/name[:\s]+["']?([^"',]+)["']?/i)
    const symbolMatch = text.match(/symbol[:\s]+["']?([A-Z0-9]+)["']?/i)
    const supplyMatch = text.match(/supply[:\s]+(\d+(?:,\d+)*)/i)

    if (!nameMatch || !symbolMatch || !supplyMatch) {
      await callback?.({
        text: `Please specify token details. Example:
'Create token with name: "My Token", symbol: MTK, supply: 1,000,000'`,
      })
      return
    }

    const name = nameMatch[1].trim()
    const symbol = symbolMatch[1].trim()
    const supply = BigInt(supplyMatch[1].replace(/,/g, ''))

    const result = await sdk.launchpad.createToken({
      name,
      symbol,
      totalSupply: parseEther(supply.toString()),
    })

    await callback?.({
      text: `Token Created:
- Name: ${name}
- Symbol: ${symbol}
- Total Supply: ${supply.toLocaleString()} ${symbol}
- Token Address: ${result.token}
- Transaction: ${result.hash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Create token with name: "My Token", symbol: MTK, supply: 1,000,000',
        },
      },
      {
        name: 'assistant',
        content: {
          text: 'Token Created: My Token (MTK)\nToken Address: 0x...',
        },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Create Presale
// ============================================================================

export const createPresaleAction: Action = {
  name: 'CREATE_PRESALE',
  similes: ['create presale', 'launch presale', 'start presale', 'new presale'],
  description: `Create a new token presale on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    // Parse presale details
    const tokenMatch = text.match(/token[:\s]+(0x[a-fA-F0-9]{40})/i)
    const rateMatch = text.match(/rate[:\s]+(\d+)/i)
    const softCapMatch = text.match(/soft\s*cap[:\s]+(\d+(?:\.\d+)?)/i)
    const hardCapMatch = text.match(/hard\s*cap[:\s]+(\d+(?:\.\d+)?)/i)

    if (!tokenMatch || !rateMatch) {
      await callback?.({
        text: `Please specify presale details. Example:
'Create presale for token: 0x..., rate: 1000 tokens per ETH, soft cap: 10 ETH, hard cap: 100 ETH'`,
      })
      return
    }

    if (!softCapMatch || !hardCapMatch) {
      await callback?.({
        text: `Please specify presale caps. Example:
'Create presale for token: 0x..., rate: 1000 tokens per ETH, soft cap: 10 ETH, hard cap: 100 ETH'`,
      })
      return
    }

    const token = tokenMatch[1] as Address
    const rate = BigInt(rateMatch[1])
    const softCap = parseEther(softCapMatch[1])
    const hardCap = parseEther(hardCapMatch[1])

    // Default times: start now, end in 7 days
    const startTime = BigInt(Math.floor(Date.now() / 1000))
    const endTime = startTime + BigInt(7 * 24 * 60 * 60)

    const txHash = await sdk.launchpad.createPresale({
      token,
      rate,
      softCap,
      hardCap,
      minContribution: parseEther('0.01'),
      maxContribution: parseEther('10'),
      startTime,
      endTime,
    })

    await callback?.({
      text: `Presale Created:
- Token: ${token}
- Rate: ${rate} tokens per ETH
- Soft Cap: ${formatEther(softCap)} ETH
- Hard Cap: ${formatEther(hardCap)} ETH
- Duration: 7 days
- Transaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Create presale for token: 0x742d..., rate: 1000, soft cap: 10 ETH, hard cap: 100 ETH',
        },
      },
      {
        name: 'assistant',
        content: { text: 'Presale Created for 0x742d...' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Contribute to Presale
// ============================================================================

export const contributePresaleAction: Action = {
  name: 'CONTRIBUTE_PRESALE',
  similes: ['contribute', 'buy presale', 'join presale', 'invest in presale'],
  description: `Contribute to a token presale on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    // Parse: "contribute 1 ETH to presale 0x..."
    const presaleMatch =
      text.match(/presale[:\s]+(0x[a-fA-F0-9]{64})/i) ??
      text.match(/(0x[a-fA-F0-9]{64})/)
    const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*ETH/i)

    if (!presaleMatch || !amountMatch) {
      await callback?.({
        text: "Please specify the presale ID and amount. Example: 'Contribute 1 ETH to presale 0x...'",
      })
      return
    }

    const presaleId = presaleMatch[1] as Hex
    const amount = parseEther(amountMatch[1])

    const txHash = await sdk.launchpad.contribute(presaleId, amount)

    await callback?.({
      text: `Contributed ${amountMatch[1]} ETH to presale\nTransaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Contribute 1 ETH to presale 0x...' },
      },
      {
        name: 'assistant',
        content: { text: 'Contributed 1 ETH. Transaction: 0x...' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// List Active Presales
// ============================================================================

export const listPresalesAction: Action = {
  name: 'LIST_PRESALES',
  similes: [
    'list presales',
    'active presales',
    'show presales',
    'presale list',
  ],
  description: `List active token presales on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const presales = await sdk.launchpad.listActivePresales()

    if (presales.length === 0) {
      await callback?.({
        text: 'No active presales at the moment.',
      })
      return
    }

    const presaleList = presales
      .slice(0, 10)
      .map(
        (p: {
          presaleId: string
          raised: bigint
          hardCap: bigint
          status: string
        }) =>
          `- ${p.presaleId.slice(0, 10)}...: ${formatEther(p.raised)}/${formatEther(p.hardCap)} ETH (${p.status})`,
      )
      .join('\n')

    await callback?.({
      text: `Active Presales (${presales.length}):\n${presaleList}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Show active presales' },
      },
      {
        name: 'assistant',
        content: {
          text: 'Active Presales (5):\n- 0x1234...: 50/100 ETH (ACTIVE)',
        },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Create Bonding Curve
// ============================================================================

export const createBondingCurveAction: Action = {
  name: 'CREATE_BONDING_CURVE',
  similes: ['create bonding curve', 'launch bonding curve', 'pump fun style'],
  description: `Create a bonding curve token launch on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    const nameMatch = text.match(/name[:\s]+["']?([^"',]+)["']?/i)
    const symbolMatch = text.match(/symbol[:\s]+["']?([A-Z0-9]+)["']?/i)

    if (!nameMatch || !symbolMatch) {
      await callback?.({
        text: `Please specify bonding curve details. Example:
'Create bonding curve with name: "Meme Token", symbol: MEME'`,
      })
      return
    }

    const name = nameMatch[1].trim()
    const symbol = symbolMatch[1].trim()

    // Use ETH as reserve token (zero address = native token)
    const reserveToken = '0x0000000000000000000000000000000000000000' as Address

    const txHash = await sdk.launchpad.createBondingCurve({
      name,
      symbol,
      reserveToken,
      initialPrice: parseEther('0.00001'),
      curveExponent: 2, // quadratic
      targetMarketCap: parseEther('1000'), // $1000 in ETH
      creatorFee: 100, // 1%
    })

    await callback?.({
      text: `Bonding Curve Created:
- Name: ${name}
- Symbol: ${symbol}
- Initial Price: 0.00001 ETH
- Curve Type: Quadratic
- Creator Fee: 1%
- Transaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Create bonding curve with name: "Meme Token", symbol: MEME',
        },
      },
      {
        name: 'assistant',
        content: { text: 'Bonding Curve Created: Meme Token (MEME)' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Buy from Bonding Curve
// ============================================================================

export const buyFromCurveAction: Action = {
  name: 'BUY_FROM_CURVE',
  similes: ['buy from curve', 'buy curve token', 'pump it'],
  description: `Buy tokens from a bonding curve on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    const curveMatch =
      text.match(/curve[:\s]+(0x[a-fA-F0-9]{64})/i) ??
      text.match(/(0x[a-fA-F0-9]{64})/)
    const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*ETH/i)

    if (!curveMatch || !amountMatch) {
      await callback?.({
        text: "Please specify the curve ID and amount. Example: 'Buy from curve 0x... for 0.1 ETH'",
      })
      return
    }

    const curveId = curveMatch[1] as Hex
    const amount = parseEther(amountMatch[1])

    const txHash = await sdk.launchpad.buyFromCurve(curveId, amount)

    await callback?.({
      text: `Bought tokens for ${amountMatch[1]} ETH\nTransaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Buy from curve 0x... for 0.1 ETH' },
      },
      {
        name: 'assistant',
        content: { text: 'Bought tokens for 0.1 ETH. Transaction: 0x...' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Sell to Bonding Curve
// ============================================================================

export const sellToCurveAction: Action = {
  name: 'SELL_TO_CURVE',
  similes: ['sell to curve', 'sell curve token', 'dump it'],
  description: `Sell tokens to a bonding curve on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    const curveMatch =
      text.match(/curve[:\s]+(0x[a-fA-F0-9]{64})/i) ??
      text.match(/(0x[a-fA-F0-9]{64})/)
    const amountMatch = text.match(/(\d+(?:,\d+)*)\s*tokens?/i)

    if (!curveMatch || !amountMatch) {
      await callback?.({
        text: "Please specify the curve ID and token amount. Example: 'Sell 1000 tokens to curve 0x...'",
      })
      return
    }

    const curveId = curveMatch[1] as Hex
    const tokenAmount = parseEther(amountMatch[1].replace(/,/g, ''))

    const txHash = await sdk.launchpad.sellToCurve(curveId, tokenAmount)

    await callback?.({
      text: `Sold ${amountMatch[1]} tokens\nTransaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Sell 1000 tokens to curve 0x...' },
      },
      {
        name: 'assistant',
        content: { text: 'Sold 1000 tokens. Transaction: 0x...' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// List Active Bonding Curves
// ============================================================================

export const listCurvesAction: Action = {
  name: 'LIST_BONDING_CURVES',
  similes: ['list curves', 'active curves', 'show bonding curves'],
  description: `List active bonding curves on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const curves = await sdk.launchpad.listActiveCurves()

    if (curves.length === 0) {
      await callback?.({
        text: 'No active bonding curves at the moment.',
      })
      return
    }

    const curveList = curves
      .slice(0, 10)
      .map(
        (c: {
          curveId: string
          currentPrice: bigint
          reserveBalance: bigint
        }) =>
          `- ${c.curveId.slice(0, 10)}...: ${formatEther(c.currentPrice)} ETH (${formatEther(c.reserveBalance)} ETH reserve)`,
      )
      .join('\n')

    await callback?.({
      text: `Active Bonding Curves (${curves.length}):\n${curveList}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Show active bonding curves' },
      },
      {
        name: 'assistant',
        content: {
          text: 'Active Bonding Curves (3):\n- 0x1234...: 0.0001 ETH (10 ETH reserve)',
        },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Lock LP
// ============================================================================

export const lockLPAction: Action = {
  name: 'LOCK_LP',
  similes: ['lock lp', 'lock liquidity', 'lp lock'],
  description: `Lock LP tokens on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    const lpTokenMatch =
      text.match(/lp[:\s]+(0x[a-fA-F0-9]{40})/i) ??
      text.match(/(0x[a-fA-F0-9]{40})/)
    const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(lp)?/i)
    const daysMatch = text.match(/(\d+)\s*days?/i)

    if (!lpTokenMatch || !amountMatch) {
      await callback?.({
        text: "Please specify the LP token and amount. Example: 'Lock 100 LP 0x... for 365 days'",
      })
      return
    }

    if (!daysMatch) {
      await callback?.({
        text: "Please specify the lock duration. Example: 'Lock 100 LP 0x... for 365 days'",
      })
      return
    }

    const lpToken = lpTokenMatch[1] as Address
    const amount = parseEther(amountMatch[1])
    const days = parseInt(daysMatch[1], 10)
    const unlockTime = BigInt(
      Math.floor(Date.now() / 1000) + days * 24 * 60 * 60,
    )

    const txHash = await sdk.launchpad.lockLP(lpToken, amount, unlockTime)

    await callback?.({
      text: `LP Locked:
- LP Token: ${lpToken}
- Amount: ${amountMatch[1]}
- Duration: ${days} days
- Transaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Lock 100 LP 0x742d... for 365 days' },
      },
      {
        name: 'assistant',
        content: { text: 'LP Locked for 365 days. Transaction: 0x...' },
      },
    ],
  ] as ActionExample[][],
}
