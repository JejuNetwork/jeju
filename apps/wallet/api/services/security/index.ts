/**
 * Network Security Engine
 * Transaction risk analysis and security checks
 * Ported from Rabby's security engine
 */

import type { Address, Hex } from 'viem'
import type { SupportedChainId } from '../rpc'

// Risk levels
export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical'

// Security rule types
export type RuleId =
  | 'contract_not_verified'
  | 'contract_new'
  | 'unlimited_approval'
  | 'high_value_transfer'
  | 'known_scam_address'
  | 'suspicious_contract'
  | 'permit_signature'
  | 'simulation_failed'
  | 'unknown_token'
  | 'gas_too_high'
  | 'unusual_recipient'

interface SecurityRule {
  id: RuleId
  name: string
  description: string
  level: RiskLevel
  enabled: boolean
}

interface RuleResult {
  ruleId: RuleId
  triggered: boolean
  level: RiskLevel
  message: string
  details?: Record<string, unknown>
}

interface SimulationResult {
  success: boolean
  gasUsed: bigint
  logs: { address: Address; topics: Hex[]; data: Hex }[]
  stateChanges: {
    type:
      | 'balance_change'
      | 'approval_change'
      | 'nft_transfer'
      | 'contract_call'
    token?: Address
    from?: Address
    to?: Address
    amount?: bigint
    tokenId?: bigint
  }[]
  error?: string
}

interface SecurityAnalysis {
  overallRisk: RiskLevel
  ruleResults: RuleResult[]
  simulation?: SimulationResult
  recommendations: string[]
  approvedForExecution: boolean
}

interface TransactionToAnalyze {
  chainId: SupportedChainId
  from: Address
  to: Address
  value: bigint
  data: Hex
  gasLimit?: bigint
  gasPrice?: bigint
}

// Default security rules
const DEFAULT_RULES: SecurityRule[] = [
  {
    id: 'contract_not_verified',
    name: 'Unverified Contract',
    description: 'Contract source code is not verified',
    level: 'medium',
    enabled: true,
  },
  {
    id: 'contract_new',
    name: 'New Contract',
    description: 'Contract was deployed recently',
    level: 'low',
    enabled: true,
  },
  {
    id: 'unlimited_approval',
    name: 'Unlimited Approval',
    description: 'Transaction grants unlimited token approval',
    level: 'high',
    enabled: true,
  },
  {
    id: 'high_value_transfer',
    name: 'High Value',
    description: 'Transaction involves high value transfer',
    level: 'medium',
    enabled: true,
  },
  {
    id: 'known_scam_address',
    name: 'Known Scam',
    description: 'Address is flagged as scam',
    level: 'critical',
    enabled: true,
  },
  {
    id: 'suspicious_contract',
    name: 'Suspicious Contract',
    description: 'Contract has suspicious patterns',
    level: 'high',
    enabled: true,
  },
  {
    id: 'permit_signature',
    name: 'Permit Signature',
    description: 'Signing permit allows token spending',
    level: 'medium',
    enabled: true,
  },
  {
    id: 'simulation_failed',
    name: 'Simulation Failed',
    description: 'Transaction simulation failed',
    level: 'high',
    enabled: true,
  },
  {
    id: 'unknown_token',
    name: 'Unknown Token',
    description: 'Token is not recognized',
    level: 'low',
    enabled: true,
  },
  {
    id: 'gas_too_high',
    name: 'High Gas',
    description: 'Gas cost is unusually high',
    level: 'low',
    enabled: true,
  },
  {
    id: 'unusual_recipient',
    name: 'New Recipient',
    description: 'Never sent to this address before',
    level: 'low',
    enabled: true,
  },
]

// Known scam addresses (would be fetched from the network API in production)
const SCAM_ADDRESSES = new Set<string>([
  // Example scam addresses - in production, fetch from the network security API
])

// User blacklist/whitelist
interface UserSecurityData {
  addressBlacklist: Address[]
  addressWhitelist: Address[]
  contractBlacklist: Address[]
  contractWhitelist: Address[]
  trustedDapps: string[]
}

class SecurityEngine {
  private rules: SecurityRule[] = DEFAULT_RULES
  private userData: UserSecurityData = {
    addressBlacklist: [],
    addressWhitelist: [],
    contractBlacklist: [],
    contractWhitelist: [],
    trustedDapps: [],
  }

  async analyzeTransaction(
    tx: TransactionToAnalyze,
  ): Promise<SecurityAnalysis> {
    const results: RuleResult[] = []
    const recommendations: string[] = []

    // Check each rule
    for (const rule of this.rules) {
      if (!rule.enabled) continue
      const result = await this.checkRule(rule, tx)
      results.push(result)

      if (result.triggered && result.level !== 'safe') {
        recommendations.push(this.getRecommendation(rule.id))
      }
    }

    // Simulate transaction
    let simulation: SimulationResult | undefined
    try {
      simulation = await this.simulateTransaction(tx)
      if (!simulation.success) {
        results.push({
          ruleId: 'simulation_failed',
          triggered: true,
          level: 'high',
          message: `Transaction will fail: ${simulation.error}`,
        })
      }
    } catch (simError) {
      // Log simulation failure but continue analysis - simulation may be unavailable
      console.warn('Transaction simulation failed:', simError)
      results.push({
        ruleId: 'simulation_failed',
        triggered: true,
        level: 'medium',
        message: `Simulation unavailable: ${simError instanceof Error ? simError.message : 'Unknown error'}`,
      })
    }

    // Calculate overall risk
    const overallRisk = this.calculateOverallRisk(results)
    const approvedForExecution =
      overallRisk !== 'critical' && (simulation?.success ?? true)

    return {
      overallRisk,
      ruleResults: results,
      simulation,
      recommendations,
      approvedForExecution,
    }
  }

  private async checkRule(
    rule: SecurityRule,
    tx: TransactionToAnalyze,
  ): Promise<RuleResult> {
    switch (rule.id) {
      case 'known_scam_address':
        return this.checkScamAddress(tx.to)

      case 'unlimited_approval':
        return this.checkUnlimitedApproval(tx.data)

      case 'high_value_transfer':
        return this.checkHighValue(tx.value, tx.chainId)

      case 'unusual_recipient':
        return this.checkUnusualRecipient(tx.to)

      case 'gas_too_high':
        return this.checkGasCost(tx)

      default:
        return { ruleId: rule.id, triggered: false, level: 'safe', message: '' }
    }
  }

  private checkScamAddress(address: Address): RuleResult {
    const isScam =
      SCAM_ADDRESSES.has(address.toLowerCase()) ||
      this.userData.addressBlacklist.some(
        (a) => a.toLowerCase() === address.toLowerCase(),
      )
    return {
      ruleId: 'known_scam_address',
      triggered: isScam,
      level: isScam ? 'critical' : 'safe',
      message: isScam ? 'This address is flagged as a scam' : '',
    }
  }

  private checkUnlimitedApproval(data: Hex): RuleResult {
    // Check for approve(address, uint256) with max uint256
    const approveSelector = '0x095ea7b3'
    const maxUint =
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

    if (
      data.startsWith(approveSelector) &&
      data.toLowerCase().includes(maxUint)
    ) {
      return {
        ruleId: 'unlimited_approval',
        triggered: true,
        level: 'high',
        message: 'This transaction grants unlimited token approval',
      }
    }
    return {
      ruleId: 'unlimited_approval',
      triggered: false,
      level: 'safe',
      message: '',
    }
  }

  private checkHighValue(value: bigint, chainId: SupportedChainId): RuleResult {
    // Consider > 1 ETH as high value (would use oracle for USD value in production)
    const oneEth = 1000000000000000000n
    const isHigh = value > oneEth
    return {
      ruleId: 'high_value_transfer',
      triggered: isHigh,
      level: isHigh ? 'medium' : 'safe',
      message: isHigh ? 'This is a high-value transaction' : '',
      details: { value: value.toString(), chainId },
    }
  }

  private checkUnusualRecipient(address: Address): RuleResult {
    const isWhitelisted = this.userData.addressWhitelist.some(
      (a) => a.toLowerCase() === address.toLowerCase(),
    )
    return {
      ruleId: 'unusual_recipient',
      triggered: !isWhitelisted,
      level: isWhitelisted ? 'safe' : 'low',
      message: isWhitelisted ? '' : 'First time sending to this address',
    }
  }

  private checkGasCost(tx: TransactionToAnalyze): RuleResult {
    // Check if gas * gasPrice > 0.1 ETH (would be more sophisticated in production)
    if (tx.gasLimit && tx.gasPrice) {
      const gasCost = tx.gasLimit * tx.gasPrice
      const threshold = 100000000000000000n // 0.1 ETH
      if (gasCost > threshold) {
        return {
          ruleId: 'gas_too_high',
          triggered: true,
          level: 'medium',
          message: 'Gas cost is unusually high',
          details: { gasCost: gasCost.toString() },
        }
      }
    }
    return {
      ruleId: 'gas_too_high',
      triggered: false,
      level: 'safe',
      message: '',
    }
  }

  private async simulateTransaction(
    tx: TransactionToAnalyze,
  ): Promise<SimulationResult> {
    // In production, call network simulation API
    // For now, return mock success
    return {
      success: true,
      gasUsed: tx.gasLimit || 21000n,
      logs: [],
      stateChanges: [],
    }
  }

  private calculateOverallRisk(results: RuleResult[]): RiskLevel {
    const levels: RiskLevel[] = ['safe', 'low', 'medium', 'high', 'critical']
    let maxLevel: RiskLevel = 'safe'

    for (const result of results) {
      if (
        result.triggered &&
        levels.indexOf(result.level) > levels.indexOf(maxLevel)
      ) {
        maxLevel = result.level
      }
    }
    return maxLevel
  }

  private getRecommendation(ruleId: RuleId): string {
    const recommendations: Record<RuleId, string> = {
      contract_not_verified:
        'Consider only interacting with verified contracts',
      contract_new: 'This contract is new - extra caution advised',
      unlimited_approval:
        'Consider setting a specific approval amount instead of unlimited',
      high_value_transfer: 'Double-check the recipient address and amount',
      known_scam_address: 'DO NOT proceed - this is a known scam address',
      suspicious_contract:
        'This contract has suspicious patterns - proceed with caution',
      permit_signature: 'This signature will allow spending your tokens',
      simulation_failed: 'Transaction will likely fail - check parameters',
      unknown_token: 'Verify this token is legitimate before proceeding',
      gas_too_high: 'Gas cost seems high - consider waiting for lower gas',
      unusual_recipient: 'Verify this is the correct recipient address',
    }
    return recommendations[ruleId]
  }

  // User data management
  addToBlacklist(address: Address, type: 'address' | 'contract') {
    if (type === 'address') {
      this.userData.addressBlacklist.push(address)
    } else {
      this.userData.contractBlacklist.push(address)
    }
  }

  addToWhitelist(address: Address, type: 'address' | 'contract') {
    if (type === 'address') {
      this.userData.addressWhitelist.push(address)
    } else {
      this.userData.contractWhitelist.push(address)
    }
  }

  isWhitelisted(address: Address): boolean {
    return (
      this.userData.addressWhitelist.some(
        (a) => a.toLowerCase() === address.toLowerCase(),
      ) ||
      this.userData.contractWhitelist.some(
        (a) => a.toLowerCase() === address.toLowerCase(),
      )
    )
  }

  getRiskLevelColor(level: RiskLevel): string {
    const colors: Record<RiskLevel, string> = {
      safe: '#22c55e',
      low: '#84cc16',
      medium: '#eab308',
      high: '#f97316',
      critical: '#ef4444',
    }
    return colors[level]
  }

  getRiskLevelLabel(level: RiskLevel): string {
    const labels: Record<RiskLevel, string> = {
      safe: 'Safe',
      low: 'Low Risk',
      medium: 'Medium Risk',
      high: 'High Risk',
      critical: 'Critical - Do Not Proceed',
    }
    return labels[level]
  }
}

export const securityEngine = new SecurityEngine()
export { SecurityEngine }
export type {
  SecurityAnalysis,
  SimulationResult,
  TransactionToAnalyze,
  RuleResult,
}
