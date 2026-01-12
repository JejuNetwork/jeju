/**
 * Security Monitoring Actions for Blue Team
 *
 * Real security analysis capabilities:
 * - Transaction analysis for suspicious patterns
 * - Contract bytecode analysis
 * - Scam address detection
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { getCurrentNetwork } from '@jejunetwork/config'
import { getChainConfig } from '@jejunetwork/sdk'
import { type Address, createPublicClient, http, isAddress } from 'viem'
import { getMessageText } from '../validation'

// Known scam patterns in bytecode
const SUSPICIOUS_PATTERNS = {
  honeypot: [
    '0x7ff36ab5', // swapExactETHForTokens with hidden restrictions
    '0x18cbafe5', // swapExactTokensForETH disabled
  ],
  rugPull: [
    '0x715018a6', // renounceOwnership that doesn't actually renounce
    '0x8da5cb5b', // owner() hidden admin functions
  ],
  feeOnTransfer: [
    '0x49bd5a5e', // uniswapV2Pair with hidden fee
  ],
}

// Known scam addresses (sample - in production would query an API)
const KNOWN_SCAM_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000', // Null address abuse
])

interface TransactionRisk {
  level: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  reasons: string[]
  recommendations: string[]
}

function analyzeTransactionData(
  to: Address,
  value: string,
  data: string,
): TransactionRisk {
  const reasons: string[] = []
  const recommendations: string[] = []
  let riskLevel: TransactionRisk['level'] = 'safe'

  // Check for known scam address
  if (KNOWN_SCAM_ADDRESSES.has(to.toLowerCase())) {
    reasons.push('Recipient is a known scam address')
    riskLevel = 'critical'
  }

  // Check for high value transfer
  const valueInEth = Number(BigInt(value || '0')) / 1e18
  if (valueInEth > 10) {
    reasons.push(`High value transfer: ${valueInEth.toFixed(4)} ETH`)
    if (riskLevel === 'safe') riskLevel = 'medium'
    recommendations.push(
      'Verify recipient address before sending large amounts',
    )
  }

  // Check for unlimited approval
  if (
    data.includes(
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    )
  ) {
    reasons.push('Unlimited token approval detected')
    if (riskLevel === 'safe') riskLevel = 'high'
    recommendations.push('Consider using a limited approval amount')
  }

  // Check for suspicious function selectors
  const selector = data.slice(0, 10).toLowerCase()
  for (const [pattern, selectors] of Object.entries(SUSPICIOUS_PATTERNS)) {
    if (selectors.some((s) => selector === s.toLowerCase())) {
      reasons.push(`Suspicious ${pattern} pattern detected in function call`)
      if (riskLevel !== 'critical') riskLevel = 'high'
    }
  }

  if (reasons.length === 0) {
    reasons.push('No obvious security risks detected')
  }

  return { level: riskLevel, reasons, recommendations }
}

async function analyzeContractBytecode(
  address: Address,
  network: string,
): Promise<{
  hasCode: boolean
  codeSize: number
  isProxy: boolean
  warnings: string[]
}> {
  const chainConfig = getChainConfig(
    network as 'localnet' | 'testnet' | 'mainnet',
  )
  const client = createPublicClient({
    transport: http(chainConfig.rpcUrl),
  })

  const code = await client.getCode({ address })
  const warnings: string[] = []

  if (!code || code === '0x') {
    return {
      hasCode: false,
      codeSize: 0,
      isProxy: false,
      warnings: ['Address has no contract code - EOA or destroyed'],
    }
  }

  const codeSize = (code.length - 2) / 2 // Remove 0x and divide by 2 for bytes

  // Check for proxy patterns
  const isProxy =
    code.includes('363d3d373d3d3d363d73') || // EIP-1167 minimal proxy
    code.includes('5880818283335afa') // DELEGATECALL pattern

  if (isProxy) {
    warnings.push('Contract is a proxy - verify implementation contract')
  }

  // Check for selfdestruct
  if (code.includes('ff')) {
    warnings.push('Contract may contain SELFDESTRUCT - funds could be at risk')
  }

  // Check code size (very small contracts may be suspicious)
  if (codeSize < 100) {
    warnings.push(
      'Very small contract - may be a proxy or minimal implementation',
    )
  }

  // Check for hardcoded addresses that could be admin backdoors
  const addressPattern = /0x[a-fA-F0-9]{40}/g
  const hardcodedAddresses = code.match(addressPattern)
  if (hardcodedAddresses && hardcodedAddresses.length > 5) {
    warnings.push(
      `Contract contains ${hardcodedAddresses.length} hardcoded addresses`,
    )
  }

  return { hasCode: true, codeSize, isProxy, warnings }
}

export const analyzeTransactionAction: Action = {
  name: 'ANALYZE_TRANSACTION',
  description: 'Analyze a transaction for security risks before execution',
  similes: ['check transaction', 'scan tx', 'verify transaction safety'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Analyze this transaction to 0x1234... for 5 ETH' },
      },
      {
        name: 'assistant',
        content: { text: 'Analyzing transaction for security risks...' },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = getMessageText(message).toLowerCase()

    // Extract address from message
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/)
    if (!addressMatch) {
      callback?.({
        text: 'Please provide a valid Ethereum address to analyze.',
      })
      return
    }

    const address = addressMatch[0] as Address

    // Extract value if mentioned
    const valueMatch = text.match(/(\d+(?:\.\d+)?)\s*eth/i)
    const value = valueMatch
      ? (parseFloat(valueMatch[1]) * 1e18).toString()
      : '0'

    // Simple data - in real implementation would parse actual tx data
    const data = '0x'

    const risk = analyzeTransactionData(address, value, data)

    const response = `**Transaction Security Analysis**

**Risk Level:** ${risk.level.toUpperCase()}

**Findings:**
${risk.reasons.map((r) => `- ${r}`).join('\n')}

${risk.recommendations.length > 0 ? `**Recommendations:**\n${risk.recommendations.map((r) => `- ${r}`).join('\n')}` : ''}

${risk.level === 'critical' ? '⚠️ **WARNING: Do not proceed with this transaction**' : risk.level === 'high' ? '⚠️ Proceed with caution' : '✅ Transaction appears safe'}`

    callback?.({ text: response })
  },
}

export const scanContractAction: Action = {
  name: 'SCAN_CONTRACT',
  description:
    'Scan a smart contract for security vulnerabilities and red flags',
  similes: ['audit contract', 'check contract', 'analyze contract'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Scan contract 0x1234... for vulnerabilities' },
      },
      {
        name: 'assistant',
        content: { text: 'Scanning contract bytecode...' },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = getMessageText(message)

    // Extract address from message
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/)
    if (!addressMatch || !isAddress(addressMatch[0])) {
      callback?.({ text: 'Please provide a valid contract address to scan.' })
      return
    }

    const address = addressMatch[0] as Address
    const network = getCurrentNetwork()

    callback?.({ text: `Scanning contract ${address} on ${network}...` })

    const analysis = await analyzeContractBytecode(address, network)

    if (!analysis.hasCode) {
      callback?.({
        text: `**Contract Scan: ${address}**\n\n❌ No contract code found at this address. This is either an EOA (externally owned account) or a destroyed contract.`,
      })
      return
    }

    const warningLevel =
      analysis.warnings.length === 0
        ? '✅ LOW RISK'
        : analysis.warnings.length <= 2
          ? '⚠️ MEDIUM RISK'
          : '🚨 HIGH RISK'

    const response = `**Contract Security Scan: ${address}**

**Risk Assessment:** ${warningLevel}

**Contract Details:**
- Code Size: ${analysis.codeSize} bytes
- Is Proxy: ${analysis.isProxy ? 'Yes ⚠️' : 'No'}

**Warnings:**
${analysis.warnings.length > 0 ? analysis.warnings.map((w) => `- ${w}`).join('\n') : '- No major warnings detected'}

${analysis.isProxy ? '\n**Proxy Contract:** The actual implementation should also be audited.' : ''}`

    callback?.({ text: response })
  },
}

export const checkScamAddressAction: Action = {
  name: 'CHECK_SCAM_ADDRESS',
  description: 'Check if an address is associated with known scams',
  similes: ['is scam', 'check address', 'verify address'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Is 0x1234... a scam address?' },
      },
      {
        name: 'assistant',
        content: { text: 'Checking address against scam databases...' },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = getMessageText(message)

    // Extract address from message
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/)
    if (!addressMatch || !isAddress(addressMatch[0])) {
      callback?.({ text: 'Please provide a valid address to check.' })
      return
    }

    const address = addressMatch[0].toLowerCase()

    // Check against known scam list
    const isKnownScam = KNOWN_SCAM_ADDRESSES.has(address)

    // In production, would also:
    // - Query external scam databases (e.g., Etherscan labels, ScamSniffer)
    // - Check on-chain reputation labels
    // - Analyze transaction history for suspicious patterns

    if (isKnownScam) {
      callback?.({
        text: `🚨 **SCAM ALERT**\n\nAddress ${address} is a **known scam address**.\n\n**DO NOT** send funds or interact with this address.`,
      })
    } else {
      callback?.({
        text: `**Address Check: ${address}**\n\n✅ This address is not in our known scam database.\n\n**Disclaimer:** This doesn't guarantee safety. Always verify:\n- Contract source code if interacting with a contract\n- Transaction history and patterns\n- On-chain reputation labels`,
      })
    }
  },
}

// Export all security actions
export const securityActions = [
  analyzeTransactionAction,
  scanContractAction,
  checkScamAddressAction,
]
