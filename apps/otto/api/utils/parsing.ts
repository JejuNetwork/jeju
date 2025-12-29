/**
 * Otto Trading Command Parsing
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

export interface LaunchParams {
  name?: string
  symbol?: string
  supply?: string
  liquidity?: string
  launchType?: 'bonding' | 'ico' | 'simple'
  description?: string
  imageUrl?: string // Token image URL (required for launch, optional in parsing)
  chain?: string // Target chain (base, arbitrum, ethereum, etc.)
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

/**
 * Parse token launch command parameters from natural language
 * Supports patterns like:
 * - "launch MyToken MTK"
 * - "launch "Moon Token" MOON 1000000"
 * - "launch Moon Token MOON bonding"
 * - "launch Moon Token MOON 1000000 1ETH"
 * - "create token Moon MOON ico"
 * - "launch Moon Token MOON with 5% buy tax"
 */
export function parseLaunchParams(input: string): LaunchParams {
  const result: LaunchParams = {}

  if (!input?.trim()) {
    return result
  }

  const normalized = input.trim()

  // Extract launch type if specified
  if (/\bbonding\b/i.test(normalized)) {
    result.launchType = 'bonding'
  } else if (/\bico\b|\bpresale\b/i.test(normalized)) {
    result.launchType = 'ico'
  } else if (/\bsimple\b/i.test(normalized)) {
    result.launchType = 'simple'
  } else {
    result.launchType = 'bonding' // Default to bonding curve
  }

  // Extract chain if specified
  const chainMatch = normalized.match(
    /\bon\s+(base|arbitrum|ethereum|unichain|monad|jeju)\b/i,
  )
  if (chainMatch) {
    result.chain = chainMatch[1].toLowerCase()
  }

  // Try to match quoted name first: launch "Moon Token" MOON
  const quotedPattern =
    /(?:launch|create\s+token|deploy\s+token|mint\s+token)\s+["']([^"']+)["']\s+([A-Z][A-Z0-9]{0,9})(?:\s+(\d+(?:\.\d+)?))?(?:\s+(\d+(?:\.\d+)?)\s*ETH)?/i

  const quotedMatch = normalized.match(quotedPattern)
  if (quotedMatch) {
    result.name = quotedMatch[1]
    result.symbol = quotedMatch[2].toUpperCase()
    if (quotedMatch[3]) {
      result.supply = quotedMatch[3]
    }
    if (quotedMatch[4]) {
      result.liquidity = quotedMatch[4]
    }
    return result
  }

  // Clean input for processing - remove modifiers we've already extracted
  const cleanedInput = normalized
    .replace(/\s+(?:bonding|ico|presale|simple)\b/gi, '')
    .replace(/\s+on\s+(?:base|arbitrum|ethereum|unichain|monad|jeju)\b/gi, '')
    .trim()

  // Try to find the symbol (all caps, 1-10 chars)
  // Look for pattern where we have words, then a symbol in caps
  const symbolPattern = /\b([A-Z][A-Z0-9]{0,9})\b/g
  const symbols: string[] = []
  let match: RegExpExecArray | null = symbolPattern.exec(cleanedInput)
  while (match !== null) {
    // Skip common words
    if (
      !['LAUNCH', 'CREATE', 'TOKEN', 'DEPLOY', 'MINT', 'ETH'].includes(match[1])
    ) {
      symbols.push(match[1])
    }
    match = symbolPattern.exec(cleanedInput)
  }

  if (symbols.length === 0) {
    return result
  }

  // The symbol is likely the last all-caps word that's not a modifier
  const symbol = symbols[symbols.length - 1]
  result.symbol = symbol

  // Extract name - everything between the command and the symbol
  const namePattern = new RegExp(
    `(?:launch|create\\s+token|deploy\\s+token|mint\\s+token)\\s+(.+?)\\s+${symbol}\\b`,
    'i',
  )
  const nameMatch = cleanedInput.match(namePattern)
  if (nameMatch) {
    result.name = nameMatch[1].trim()
  }

  // Extract supply if present (number after symbol)
  const supplyPattern = new RegExp(
    `${symbol}\\s+(\\d+(?:\\.\\d+)?)(?!\\s*ETH)`,
    'i',
  )
  const supplyMatch = normalized.match(supplyPattern)
  if (supplyMatch) {
    result.supply = supplyMatch[1]
  }

  // Extract liquidity if present (number followed by ETH)
  const liquidityPattern = /(\d+(?:\.\d+)?)\s*ETH/i
  const liquidityMatch = normalized.match(liquidityPattern)
  if (liquidityMatch) {
    result.liquidity = liquidityMatch[1]
  }

  return result
}

/**
 * Validate launch parameters
 */
export function validateLaunchParams(
  params: Partial<LaunchParams>,
): ValidationResult {
  if (!params.name) {
    return { valid: false, error: 'Missing token name' }
  }

  if (!params.symbol) {
    return { valid: false, error: 'Missing token symbol' }
  }

  if (params.symbol.length > 10) {
    return { valid: false, error: 'Symbol must be 10 characters or less' }
  }

  if (!/^[A-Z0-9]+$/i.test(params.symbol)) {
    return {
      valid: false,
      error: 'Symbol must contain only letters and numbers',
    }
  }

  if (params.supply) {
    const supply = Number.parseFloat(params.supply)
    if (Number.isNaN(supply) || supply <= 0) {
      return { valid: false, error: 'Invalid supply' }
    }
  }

  if (params.liquidity) {
    const liquidity = Number.parseFloat(params.liquidity)
    if (Number.isNaN(liquidity) || liquidity <= 0) {
      return { valid: false, error: 'Invalid liquidity amount' }
    }
  }

  return { valid: true }
}
