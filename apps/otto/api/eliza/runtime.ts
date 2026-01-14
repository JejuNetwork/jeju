/**
 * Eliza Runtime - Action selection and entity extraction for conversational AI
 */

export interface ActionInfo {
  name: string
  description: string
}

// Action definitions
const ACTIONS: Record<string, ActionInfo> = {
  SWAP: { name: 'SWAP', description: 'Swap one token for another' },
  BRIDGE: { name: 'BRIDGE', description: 'Bridge tokens across chains' },
  BALANCE: { name: 'BALANCE', description: 'Check token balances' },
  PRICE: { name: 'PRICE', description: 'Get token prices' },
  CONNECT: { name: 'CONNECT', description: 'Connect wallet' },
  HELP: { name: 'HELP', description: 'Show help information' },
  CONFIRM: { name: 'CONFIRM', description: 'Confirm action' },
  CANCEL: { name: 'CANCEL', description: 'Cancel action' },
}

/**
 * Select an action based on user input text
 * @param text - The user's input text
 * @returns The matched action or null if no match
 */
export function selectAction(text: string): ActionInfo | null {
  if (!text || text.trim() === '') {
    return null
  }

  const lowerText = text.toLowerCase().trim()

  // Exact matches first (for confirm/cancel)
  if (lowerText === 'confirm' || lowerText === 'yes') {
    return ACTIONS.CONFIRM
  }
  if (lowerText === 'cancel' || lowerText === 'no') {
    return ACTIONS.CANCEL
  }

  // Keyword matches (order matters - more specific first)
  if (/\bswap\b|\btrade\b/.test(lowerText)) {
    return ACTIONS.SWAP
  }
  if (/\bbridge\b/.test(lowerText)) {
    return ACTIONS.BRIDGE
  }
  if (/\bbalance\b/.test(lowerText)) {
    return ACTIONS.BALANCE
  }
  if (/\bprice\b/.test(lowerText)) {
    return ACTIONS.PRICE
  }
  if (/\bconnect\b/.test(lowerText)) {
    return ACTIONS.CONNECT
  }
  if (/\bhelp\b/.test(lowerText)) {
    return ACTIONS.HELP
  }

  return null
}

export interface ExtractedEntities {
  amount?: string
  fromToken?: string
  toToken?: string
  token?: string
  fromChain?: string
  toChain?: string
}

/**
 * Extract entities from user input text
 * @param text - The user's input text
 * @returns Extracted entities from the text
 */
export function extractEntities(text: string): ExtractedEntities {
  if (!text || text.trim() === '') {
    return {}
  }

  const result: ExtractedEntities = {}

  // Swap pattern: "swap X TOKEN1 to/for TOKEN2"
  const swapPattern =
    /(?:swap|trade)\s+(\d+\.?\d*)\s+(\w+)\s+(?:to|for)\s+(\w+)/i
  const swapMatch = text.match(swapPattern)
  if (swapMatch) {
    result.amount = swapMatch[1]
    result.fromToken = swapMatch[2].toUpperCase()
    result.toToken = swapMatch[3].toUpperCase()
    return result
  }

  // Bridge pattern: "bridge X TOKEN from CHAIN1 to CHAIN2"
  const bridgePattern =
    /bridge\s+(\d+\.?\d*)\s+(\w+)\s+from\s+(\w+)\s+to\s+(\w+)/i
  const bridgeMatch = text.match(bridgePattern)
  if (bridgeMatch) {
    result.amount = bridgeMatch[1]
    result.token = bridgeMatch[2].toUpperCase()
    result.fromChain = bridgeMatch[3].toLowerCase()
    result.toChain = bridgeMatch[4].toLowerCase()
    return result
  }

  return result
}




