/**
 * Otto Trading Command Parsing Utilities
 *
 * Parses natural language trading commands into structured parameters.
 */

export interface SwapParams {
  amount?: string
  from?: string
  to?: string
  chain?: string
}

export interface BridgeParams {
  amount?: string
  token?: string
  fromChain?: string
  toChain?: string
}

export interface LimitOrderParams {
  amount?: string
  from?: string
  to?: string
  price?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * Parse swap command parameters from natural language
 * Supports patterns like:
 * - "swap X TOKEN to TOKEN"
 * - "swap X TOKEN for TOKEN"
 * - "exchange X TOKEN into TOKEN"
 * - "swap X TOKEN to TOKEN on CHAIN"
 */
export function parseSwapParams(input: string): SwapParams {
  const result: SwapParams = {}

  if (!input?.trim()) {
    return result
  }

  // Pattern: swap/exchange AMOUNT FROM to/for/into TO [on CHAIN]
  const swapPattern =
    /(?:swap|exchange)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(?:to|for|into)\s+(\w+)(?:\s+on\s+(\w+))?/i

  const match = input.match(swapPattern)
  if (match) {
    result.amount = match[1]
    result.from = match[2].toUpperCase()
    result.to = match[3].toUpperCase()
    if (match[4]) {
      result.chain = match[4].toLowerCase()
    }
  }

  return result
}

/**
 * Parse bridge command parameters from natural language
 * Supports patterns like:
 * - "bridge X TOKEN from CHAIN to CHAIN"
 */
export function parseBridgeParams(input: string): BridgeParams {
  const result: BridgeParams = {}

  if (!input?.trim()) {
    return result
  }

  // Pattern: bridge AMOUNT TOKEN from FROMCHAIN to TOCHAIN
  const bridgePattern =
    /bridge\s+(\d+(?:\.\d+)?)\s+(\w+)\s+from\s+(\w+)\s+to\s+(\w+)/i

  const match = input.match(bridgePattern)
  if (match) {
    result.amount = match[1]
    result.token = match[2].toUpperCase()
    result.fromChain = match[3].toLowerCase()
    result.toChain = match[4].toLowerCase()
  }

  return result
}

/**
 * Parse limit order command parameters from natural language
 * Supports patterns like:
 * - "limit X TOKEN at PRICE TOKEN"
 */
export function parseLimitOrderParams(input: string): LimitOrderParams {
  const result: LimitOrderParams = {}

  if (!input?.trim()) {
    return result
  }

  // Pattern: limit AMOUNT FROM at PRICE TO
  const limitPattern =
    /limit\s+(\d+(?:\.\d+)?)\s+(\w+)\s+at\s+(\d+(?:\.\d+)?)\s+(\w+)/i

  const match = input.match(limitPattern)
  if (match) {
    result.amount = match[1]
    result.from = match[2].toUpperCase()
    result.price = match[3]
    result.to = match[4].toUpperCase()
  }

  return result
}

/**
 * Validate swap parameters
 */
export function validateSwapParams(
  params: Partial<SwapParams>,
): ValidationResult {
  if (!params.amount) {
    return { valid: false, error: 'Missing amount' }
  }

  if (!params.from) {
    return { valid: false, error: 'Missing from token' }
  }

  if (!params.to) {
    return { valid: false, error: 'Missing to token' }
  }

  const amount = Number.parseFloat(params.amount)
  if (Number.isNaN(amount) || amount <= 0) {
    return { valid: false, error: 'Invalid amount' }
  }

  return { valid: true }
}

/**
 * Validate bridge parameters
 */
export function validateBridgeParams(
  params: Partial<BridgeParams>,
): ValidationResult {
  if (!params.amount) {
    return { valid: false, error: 'Missing amount' }
  }

  if (!params.token) {
    return { valid: false, error: 'Missing token' }
  }

  if (!params.fromChain) {
    return { valid: false, error: 'Missing from chain' }
  }

  if (!params.toChain) {
    return { valid: false, error: 'Missing to chain' }
  }

  const amount = Number.parseFloat(params.amount)
  if (Number.isNaN(amount) || amount <= 0) {
    return { valid: false, error: 'Invalid amount' }
  }

  return { valid: true }
}

/**
 * Validate limit order parameters
 */
export function validateLimitOrderParams(
  params: Partial<LimitOrderParams>,
): ValidationResult {
  if (!params.amount) {
    return { valid: false, error: 'Missing amount' }
  }

  if (!params.from) {
    return { valid: false, error: 'Missing from token' }
  }

  if (!params.to) {
    return { valid: false, error: 'Missing to token' }
  }

  if (!params.price) {
    return { valid: false, error: 'Missing price' }
  }

  const amount = Number.parseFloat(params.amount)
  if (Number.isNaN(amount) || amount <= 0) {
    return { valid: false, error: 'Invalid amount' }
  }

  const price = Number.parseFloat(params.price)
  if (Number.isNaN(price) || price <= 0) {
    return { valid: false, error: 'Invalid price' }
  }

  return { valid: true }
}
