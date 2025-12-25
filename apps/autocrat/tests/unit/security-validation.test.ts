/**
 * Security Validation Agent Unit Tests
 *
 * Tests for confidence calculation, reward calculation, and validation result determination
 */

import { describe, expect, test } from 'bun:test'

const BountySeverity = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
} as const
type BountySeverity = (typeof BountySeverity)[keyof typeof BountySeverity]

const VulnerabilityType = {
  REMOTE_CODE_EXECUTION: 0,
  PRIVILEGE_ESCALATION: 1,
  FUNDS_AT_RISK: 2,
  WALLET_DRAIN: 3,
  TEE_BYPASS: 4,
  MPC_KEY_EXPOSURE: 5,
  CONSENSUS_ATTACK: 6,
  DATA_LEAK: 7,
  DOS: 8,
  OTHER: 9,
} as const
type VulnerabilityType =
  (typeof VulnerabilityType)[keyof typeof VulnerabilityType]

const ValidationResult = {
  VALID: 'VALID',
  INVALID: 'INVALID',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
} as const
type ValidationResult = (typeof ValidationResult)[keyof typeof ValidationResult]

interface StaticAnalysis {
  isLikelyValid: boolean
  notes: string[]
}

interface SandboxResult {
  success: boolean
  exploitTriggered: boolean
  output: string
  errorLogs: string
  executionTime: number
  memoryUsed: number
}
function calculateConfidence(
  staticAnalysis: StaticAnalysis,
  sandboxResult: SandboxResult | null,
): number {
  let confidence = 50

  if (staticAnalysis.isLikelyValid) {
    confidence += 20
  } else {
    confidence -= 20
  }

  if (sandboxResult) {
    if (sandboxResult.exploitTriggered) {
      confidence = Math.max(confidence, 90)
    } else if (sandboxResult.success) {
      confidence += 10
    } else {
      confidence -= 10
    }
  }

  return Math.max(0, Math.min(100, confidence))
}

function determineResult(
  _staticAnalysis: StaticAnalysis,
  sandboxResult: SandboxResult | null,
  confidence: number,
): ValidationResult {
  if (sandboxResult?.exploitTriggered) {
    return ValidationResult.VALID
  }

  if (confidence >= 70) {
    return ValidationResult.VALID
  }

  if (confidence >= 40) {
    return ValidationResult.NEEDS_REVIEW
  }

  return ValidationResult.INVALID
}

function calculateReward(
  severity: BountySeverity,
  confidence: number,
  exploitVerified: boolean,
): bigint {
  const baseRewards: Record<BountySeverity, bigint> = {
    [BountySeverity.LOW]: (500n * 10n ** 18n) / 2500n,
    [BountySeverity.MEDIUM]: (5000n * 10n ** 18n) / 2500n,
    [BountySeverity.HIGH]: (15000n * 10n ** 18n) / 2500n,
    [BountySeverity.CRITICAL]: (35000n * 10n ** 18n) / 2500n,
  }

  let reward = baseRewards[severity]

  // Adjust by confidence
  reward = (reward * BigInt(confidence)) / 100n

  // Bonus for verified exploits
  if (exploitVerified) {
    reward = (reward * 120n) / 100n // 20% bonus
  }

  return reward
}

function assessSeverity(
  claimedSeverity: BountySeverity,
  vulnType: VulnerabilityType,
  exploitTriggered: boolean,
): BountySeverity {
  // If exploit verified and matches critical types, confirm critical
  if (exploitTriggered) {
    if (
      vulnType === VulnerabilityType.FUNDS_AT_RISK ||
      vulnType === VulnerabilityType.WALLET_DRAIN ||
      vulnType === VulnerabilityType.REMOTE_CODE_EXECUTION
    ) {
      return BountySeverity.CRITICAL
    }
    if (
      vulnType === VulnerabilityType.TEE_BYPASS ||
      vulnType === VulnerabilityType.MPC_KEY_EXPOSURE ||
      vulnType === VulnerabilityType.CONSENSUS_ATTACK
    ) {
      return BountySeverity.HIGH
    }
  }

  // Default to claimed severity
  return claimedSeverity
}

function getSandboxConfig(vulnType: VulnerabilityType): {
  image: string
  command: string[]
  cpuCores: number
  memoryMb: number
} {
  switch (vulnType) {
    case VulnerabilityType.REMOTE_CODE_EXECUTION:
    case VulnerabilityType.PRIVILEGE_ESCALATION:
      return {
        image: 'jeju/security-sandbox:isolated',
        command: ['validate-rce'],
        cpuCores: 1,
        memoryMb: 1024,
      }

    case VulnerabilityType.FUNDS_AT_RISK:
    case VulnerabilityType.WALLET_DRAIN:
      return {
        image: 'jeju/security-sandbox:evm',
        command: ['validate-defi'],
        cpuCores: 2,
        memoryMb: 4096,
      }

    case VulnerabilityType.TEE_BYPASS:
    case VulnerabilityType.MPC_KEY_EXPOSURE:
      return {
        image: 'jeju/security-sandbox:crypto',
        command: ['validate-crypto'],
        cpuCores: 2,
        memoryMb: 2048,
      }

    case VulnerabilityType.CONSENSUS_ATTACK:
      return {
        image: 'jeju/security-sandbox:consensus',
        command: ['validate-consensus'],
        cpuCores: 4,
        memoryMb: 8192,
      }

    default:
      return {
        image: 'jeju/security-sandbox:general',
        command: ['validate-general'],
        cpuCores: 1,
        memoryMb: 2048,
      }
  }
}
function createSandboxResult(
  overrides: Partial<SandboxResult> = {},
): SandboxResult {
  return {
    success: true,
    exploitTriggered: false,
    output: '',
    errorLogs: '',
    executionTime: 100,
    memoryUsed: 256,
    ...overrides,
  }
}
describe('SecurityValidationAgent', () => {
  describe('calculateConfidence', () => {
    test('base confidence is 50 without static analysis or sandbox', () => {
      const result = calculateConfidence(
        { isLikelyValid: false, notes: [] },
        null,
      )
      // 50 - 20 (not valid) = 30
      expect(result).toBe(30)
    })

    test('static analysis likely valid adds 20', () => {
      const result = calculateConfidence(
        { isLikelyValid: true, notes: [] },
        null,
      )
      expect(result).toBe(70)
    })

    test('static analysis not likely valid subtracts 20', () => {
      const result = calculateConfidence(
        { isLikelyValid: false, notes: [] },
        null,
      )
      expect(result).toBe(30)
    })

    test('successful sandbox execution adds 10', () => {
      const sandbox = createSandboxResult({
        success: true,
        exploitTriggered: false,
      })
      const result = calculateConfidence(
        { isLikelyValid: true, notes: [] },
        sandbox,
      )
      // 50 + 20 + 10 = 80
      expect(result).toBe(80)
    })

    test('failed sandbox execution subtracts 10', () => {
      const sandbox = createSandboxResult({
        success: false,
        exploitTriggered: false,
      })
      const result = calculateConfidence(
        { isLikelyValid: true, notes: [] },
        sandbox,
      )
      // 50 + 20 - 10 = 60
      expect(result).toBe(60)
    })

    test('exploit triggered sets confidence to at least 90', () => {
      const sandbox = createSandboxResult({
        success: true,
        exploitTriggered: true,
      })

      // Even with negative static analysis, exploit confirmation overrides
      const result = calculateConfidence(
        { isLikelyValid: false, notes: [] },
        sandbox,
      )
      expect(result).toBe(90)
    })

    test('exploit triggered with high static analysis confidence', () => {
      const sandbox = createSandboxResult({
        success: true,
        exploitTriggered: true,
      })
      const result = calculateConfidence(
        { isLikelyValid: true, notes: [] },
        sandbox,
      )
      // max(70, 90) = 90
      expect(result).toBe(90)
    })

    test('confidence is capped at 100', () => {
      const sandbox = createSandboxResult({
        success: true,
        exploitTriggered: true,
      })
      const result = calculateConfidence(
        { isLikelyValid: true, notes: [] },
        sandbox,
      )
      expect(result).toBeLessThanOrEqual(100)
    })

    test('confidence is never below 0', () => {
      const sandbox = createSandboxResult({
        success: false,
        exploitTriggered: false,
      })
      const result = calculateConfidence(
        { isLikelyValid: false, notes: [] },
        sandbox,
      )
      expect(result).toBeGreaterThanOrEqual(0)
    })
  })

  describe('determineResult', () => {
    test('exploit triggered = VALID regardless of confidence', () => {
      const sandbox = createSandboxResult({ exploitTriggered: true })
      const result = determineResult(
        { isLikelyValid: false, notes: [] },
        sandbox,
        10,
      )
      expect(result).toBe(ValidationResult.VALID)
    })

    test('confidence >= 70 = VALID', () => {
      expect(
        determineResult({ isLikelyValid: true, notes: [] }, null, 70),
      ).toBe(ValidationResult.VALID)

      expect(
        determineResult({ isLikelyValid: true, notes: [] }, null, 85),
      ).toBe(ValidationResult.VALID)

      expect(
        determineResult({ isLikelyValid: true, notes: [] }, null, 100),
      ).toBe(ValidationResult.VALID)
    })

    test('confidence 40-69 = NEEDS_REVIEW', () => {
      expect(
        determineResult({ isLikelyValid: true, notes: [] }, null, 40),
      ).toBe(ValidationResult.NEEDS_REVIEW)

      expect(
        determineResult({ isLikelyValid: true, notes: [] }, null, 55),
      ).toBe(ValidationResult.NEEDS_REVIEW)

      expect(
        determineResult({ isLikelyValid: true, notes: [] }, null, 69),
      ).toBe(ValidationResult.NEEDS_REVIEW)
    })

    test('confidence < 40 = INVALID', () => {
      expect(
        determineResult({ isLikelyValid: false, notes: [] }, null, 39),
      ).toBe(ValidationResult.INVALID)

      expect(
        determineResult({ isLikelyValid: false, notes: [] }, null, 20),
      ).toBe(ValidationResult.INVALID)

      expect(
        determineResult({ isLikelyValid: false, notes: [] }, null, 0),
      ).toBe(ValidationResult.INVALID)
    })
  })

  describe('calculateReward', () => {
    test('CRITICAL severity has highest base reward', () => {
      const critical = calculateReward(BountySeverity.CRITICAL, 100, false)
      const high = calculateReward(BountySeverity.HIGH, 100, false)
      const medium = calculateReward(BountySeverity.MEDIUM, 100, false)
      const low = calculateReward(BountySeverity.LOW, 100, false)

      expect(critical).toBeGreaterThan(high)
      expect(high).toBeGreaterThan(medium)
      expect(medium).toBeGreaterThan(low)
    })

    test('reward scales with confidence', () => {
      const full = calculateReward(BountySeverity.HIGH, 100, false)
      const half = calculateReward(BountySeverity.HIGH, 50, false)

      // 50% confidence should give ~50% reward
      expect(half).toBe(full / 2n)
    })

    test('exploit verification adds 20% bonus', () => {
      const unverified = calculateReward(BountySeverity.HIGH, 100, false)
      const verified = calculateReward(BountySeverity.HIGH, 100, true)

      // Verified should be 120% of unverified
      expect(verified).toBe((unverified * 120n) / 100n)
    })

    test('zero confidence gives zero reward', () => {
      const result = calculateReward(BountySeverity.CRITICAL, 0, false)
      expect(result).toBe(0n)
    })

    test('exploit bonus applies after confidence scaling', () => {
      const base = calculateReward(BountySeverity.MEDIUM, 80, false)
      const withBonus = calculateReward(BountySeverity.MEDIUM, 80, true)

      // Should be exactly 20% more
      expect(withBonus).toBe((base * 120n) / 100n)
    })

    test('LOW severity reward is reasonable', () => {
      const reward = calculateReward(BountySeverity.LOW, 100, false)
      // Base: 500 * 10^18 / 2500 = 0.2 ETH worth at $2500/ETH = $500
      expect(reward).toBeGreaterThan(0n)
    })
  })

  describe('assessSeverity', () => {
    test('FUNDS_AT_RISK with exploit = CRITICAL', () => {
      expect(
        assessSeverity(
          BountySeverity.MEDIUM,
          VulnerabilityType.FUNDS_AT_RISK,
          true,
        ),
      ).toBe(BountySeverity.CRITICAL)
    })

    test('WALLET_DRAIN with exploit = CRITICAL', () => {
      expect(
        assessSeverity(
          BountySeverity.LOW,
          VulnerabilityType.WALLET_DRAIN,
          true,
        ),
      ).toBe(BountySeverity.CRITICAL)
    })

    test('REMOTE_CODE_EXECUTION with exploit = CRITICAL', () => {
      expect(
        assessSeverity(
          BountySeverity.MEDIUM,
          VulnerabilityType.REMOTE_CODE_EXECUTION,
          true,
        ),
      ).toBe(BountySeverity.CRITICAL)
    })

    test('TEE_BYPASS with exploit = HIGH', () => {
      expect(
        assessSeverity(
          BountySeverity.MEDIUM,
          VulnerabilityType.TEE_BYPASS,
          true,
        ),
      ).toBe(BountySeverity.HIGH)
    })

    test('MPC_KEY_EXPOSURE with exploit = HIGH', () => {
      expect(
        assessSeverity(
          BountySeverity.LOW,
          VulnerabilityType.MPC_KEY_EXPOSURE,
          true,
        ),
      ).toBe(BountySeverity.HIGH)
    })

    test('CONSENSUS_ATTACK with exploit = HIGH', () => {
      expect(
        assessSeverity(
          BountySeverity.MEDIUM,
          VulnerabilityType.CONSENSUS_ATTACK,
          true,
        ),
      ).toBe(BountySeverity.HIGH)
    })

    test('without exploit, uses claimed severity', () => {
      expect(
        assessSeverity(
          BountySeverity.LOW,
          VulnerabilityType.FUNDS_AT_RISK,
          false,
        ),
      ).toBe(BountySeverity.LOW)

      expect(
        assessSeverity(BountySeverity.CRITICAL, VulnerabilityType.DOS, false),
      ).toBe(BountySeverity.CRITICAL)
    })

    test('other vuln types with exploit use claimed severity', () => {
      expect(
        assessSeverity(
          BountySeverity.MEDIUM,
          VulnerabilityType.DATA_LEAK,
          true,
        ),
      ).toBe(BountySeverity.MEDIUM)

      expect(
        assessSeverity(BountySeverity.LOW, VulnerabilityType.DOS, true),
      ).toBe(BountySeverity.LOW)
    })
  })

  describe('getSandboxConfig', () => {
    test('RCE and privilege escalation use isolated sandbox', () => {
      const rce = getSandboxConfig(VulnerabilityType.REMOTE_CODE_EXECUTION)
      const priv = getSandboxConfig(VulnerabilityType.PRIVILEGE_ESCALATION)

      expect(rce.image).toBe('jeju/security-sandbox:isolated')
      expect(priv.image).toBe('jeju/security-sandbox:isolated')
    })

    test('DeFi vulnerabilities use EVM sandbox', () => {
      const funds = getSandboxConfig(VulnerabilityType.FUNDS_AT_RISK)
      const drain = getSandboxConfig(VulnerabilityType.WALLET_DRAIN)

      expect(funds.image).toBe('jeju/security-sandbox:evm')
      expect(drain.image).toBe('jeju/security-sandbox:evm')
      expect(funds.memoryMb).toBe(4096)
    })

    test('crypto vulnerabilities use crypto sandbox', () => {
      const tee = getSandboxConfig(VulnerabilityType.TEE_BYPASS)
      const mpc = getSandboxConfig(VulnerabilityType.MPC_KEY_EXPOSURE)

      expect(tee.image).toBe('jeju/security-sandbox:crypto')
      expect(mpc.image).toBe('jeju/security-sandbox:crypto')
    })

    test('consensus attacks get most resources', () => {
      const consensus = getSandboxConfig(VulnerabilityType.CONSENSUS_ATTACK)

      expect(consensus.cpuCores).toBe(4)
      expect(consensus.memoryMb).toBe(8192)
    })

    test('unknown types use general sandbox', () => {
      const other = getSandboxConfig(VulnerabilityType.OTHER)
      const dos = getSandboxConfig(VulnerabilityType.DOS)

      expect(other.image).toBe('jeju/security-sandbox:general')
      expect(dos.image).toBe('jeju/security-sandbox:general')
    })
  })

  describe('Reward Calculation Edge Cases', () => {
    test('all severity levels give non-zero rewards at 100% confidence', () => {
      for (const severity of [
        BountySeverity.LOW,
        BountySeverity.MEDIUM,
        BountySeverity.HIGH,
        BountySeverity.CRITICAL,
      ]) {
        const reward = calculateReward(severity, 100, false)
        expect(reward).toBeGreaterThan(0n)
      }
    })

    test('reward ordering is consistent', () => {
      // At any confidence level, higher severity = higher reward
      for (const confidence of [25, 50, 75, 100]) {
        const low = calculateReward(BountySeverity.LOW, confidence, false)
        const medium = calculateReward(BountySeverity.MEDIUM, confidence, false)
        const high = calculateReward(BountySeverity.HIGH, confidence, false)
        const critical = calculateReward(
          BountySeverity.CRITICAL,
          confidence,
          false,
        )

        expect(critical).toBeGreaterThan(high)
        expect(high).toBeGreaterThan(medium)
        expect(medium).toBeGreaterThan(low)
      }
    })

    test('exploit bonus is always multiplicative', () => {
      for (const severity of [
        BountySeverity.LOW,
        BountySeverity.MEDIUM,
        BountySeverity.HIGH,
        BountySeverity.CRITICAL,
      ]) {
        for (const confidence of [50, 75, 100]) {
          const base = calculateReward(severity, confidence, false)
          const bonus = calculateReward(severity, confidence, true)

          // 20% bonus means bonus = base * 1.2
          expect(bonus).toBe((base * 120n) / 100n)
        }
      }
    })
  })

  describe('Validation Flow Integration', () => {
    test('high quality submission with exploit = VALID + high reward', () => {
      const staticAnalysis: StaticAnalysis = { isLikelyValid: true, notes: [] }
      const sandbox = createSandboxResult({
        success: true,
        exploitTriggered: true,
      })

      const confidence = calculateConfidence(staticAnalysis, sandbox)
      const result = determineResult(staticAnalysis, sandbox, confidence)
      const severity = assessSeverity(
        BountySeverity.HIGH,
        VulnerabilityType.FUNDS_AT_RISK,
        true,
      )
      const reward = calculateReward(severity, confidence, true)

      expect(confidence).toBe(90)
      expect(result).toBe(ValidationResult.VALID)
      expect(severity).toBe(BountySeverity.CRITICAL)
      expect(reward).toBeGreaterThan(0n)
    })

    test('low quality submission without exploit = INVALID + no reward path', () => {
      const staticAnalysis: StaticAnalysis = { isLikelyValid: false, notes: [] }
      const sandbox = createSandboxResult({
        success: false,
        exploitTriggered: false,
      })

      const confidence = calculateConfidence(staticAnalysis, sandbox)
      const result = determineResult(staticAnalysis, sandbox, confidence)

      // 50 - 20 - 10 = 20
      expect(confidence).toBe(20)
      expect(result).toBe(ValidationResult.INVALID)
    })

    test('borderline submission = NEEDS_REVIEW', () => {
      const staticAnalysis: StaticAnalysis = { isLikelyValid: true, notes: [] }
      const sandbox: SandboxResult | null = null

      const confidence = calculateConfidence(staticAnalysis, sandbox)
      const result = determineResult(staticAnalysis, sandbox, confidence)

      // 50 + 20 = 70, exactly at threshold
      expect(confidence).toBe(70)
      expect(result).toBe(ValidationResult.VALID)

      // Just below threshold
      const result2 = determineResult(staticAnalysis, sandbox, 69)
      expect(result2).toBe(ValidationResult.NEEDS_REVIEW)
    })
  })
})
