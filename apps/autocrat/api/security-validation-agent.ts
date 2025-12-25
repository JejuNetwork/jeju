/**
 * Security Validation Agent
 *
 * AI-powered security vulnerability validation agent
 * Runs exploit code in sandbox, analyzes impact, suggests fixes
 */

import { getCurrentNetwork, getDWSComputeUrl } from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import { z } from 'zod'
import {
  BountySeverity,
  BountySeverityName,
  extractLLMContent,
  LLMCompletionResponseSchema,
  SandboxExecutionResponseSchema,
  ValidationResult,
  VulnerabilityType,
  VulnerabilityTypeName,
} from '../lib'

// Schemas for AI response parsing
const SecurityValidationResponseSchema = z.object({
  isLikelyValid: z.boolean(),
  notes: z.array(z.string()),
})

// DWS URL is resolved from network config (handles env overrides)
function getDWSEndpoint(): string {
  return getDWSComputeUrl()
}

interface ValidationContext {
  submissionId: string
  severity: BountySeverity
  vulnType: VulnerabilityType
  title: string
  description: string
  affectedComponents: string[]
  stepsToReproduce: string[]
  proofOfConcept: string
  suggestedFix: string
}

interface ValidationReport {
  result: ValidationResult
  confidence: number
  exploitVerified: boolean
  impactAssessment: string
  severityAssessment: BountySeverity
  fixAnalysis: string
  suggestedReward: bigint
  securityNotes: string[]
  sandboxLogs: string
}

interface SandboxResult {
  success: boolean
  exploitTriggered: boolean
  output: string
  errorLogs: string
  executionTime: number
  memoryUsed: number
}

async function analyzeWithAI(
  prompt: string,
  systemPrompt: string,
  maxTokens = 4096,
): Promise<string> {
  // DWS routes to best available provider (Groq, OpenAI, Anthropic, etc.)
  const endpoint = getDWSEndpoint()

  const response = await fetch(`${endpoint}/compute/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3, // Lower temperature for security analysis precision
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    const network = getCurrentNetwork()
    const errorBody = await response.text()
    throw new Error(
      `DWS compute error (network: ${network}): ${response.status} ${response.statusText} - ${errorBody}`,
    )
  }

  const data = expectValid(
    LLMCompletionResponseSchema,
    await response.json(),
    'DWS security AI response',
  )

  return extractLLMContent(data, 'DWS security AI response')
}

async function executePoCInSandbox(
  proofOfConcept: string,
  vulnType: VulnerabilityType,
  timeout: number = 300,
): Promise<SandboxResult> {
  const sandboxConfig = getSandboxConfig(vulnType)
  const endpoint = getDWSEndpoint()

  let response: Response
  try {
    response = await fetch(`${endpoint}/api/containers/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageRef: sandboxConfig.image,
        command: sandboxConfig.command,
        env: {
          POC_CODE: Buffer.from(proofOfConcept).toString('base64'),
          VULN_TYPE: String(vulnType),
          TIMEOUT: String(timeout),
        },
        resources: {
          cpuCores: sandboxConfig.cpuCores,
          memoryMb: sandboxConfig.memoryMb,
          storageMb: 512,
          networkBandwidthMbps: 0, // No network for security
        },
        mode: 'serverless',
        timeout,
      }),
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      exploitTriggered: false,
      output: '',
      errorLogs: `Sandbox connection failed: ${errorMessage}`,
      executionTime: 0,
      memoryUsed: 0,
    }
  }

  if (!response.ok) {
    const errorBody = await response.text()
    return {
      success: false,
      exploitTriggered: false,
      output: '',
      errorLogs: `Sandbox execution failed: ${response.status} ${response.statusText} - ${errorBody}`,
      executionTime: 0,
      memoryUsed: 0,
    }
  }

  const result = expectValid(
    SandboxExecutionResponseSchema,
    await response.json(),
    'Sandbox execution response',
  )

  return {
    success: result.status === 'success',
    exploitTriggered: result.output.exploitTriggered,
    output: result.output.result,
    errorLogs: result.logs,
    executionTime: result.metrics.executionTimeMs,
    memoryUsed: result.metrics.memoryUsedMb,
  }
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

export async function validateSubmission(
  context: ValidationContext,
): Promise<ValidationReport> {
  const securityNotes: string[] = []
  let sandboxLogs = ''

  const staticAnalysis = await performStaticAnalysis(context)
  securityNotes.push(...staticAnalysis.notes)

  let sandboxResult: SandboxResult | null = null
  if (context.proofOfConcept && context.proofOfConcept.length > 50) {
    sandboxResult = await executePoCInSandbox(
      context.proofOfConcept,
      context.vulnType,
    )
    sandboxLogs = `${sandboxResult.output}\n${sandboxResult.errorLogs}`

    if (sandboxResult.exploitTriggered) {
      securityNotes.push(
        'EXPLOIT VERIFIED: PoC successfully demonstrated vulnerability',
      )
    } else if (sandboxResult.success) {
      securityNotes.push(
        'PoC executed without triggering exploit - may need review',
      )
    } else {
      securityNotes.push('PoC execution failed - sandbox error or invalid code')
    }
  }

  // Step 3: Assess severity
  const severityAssessment = await assessSeverity(context, sandboxResult)
  securityNotes.push(
    `Assessed severity: ${BountySeverityName[severityAssessment]}`,
  )

  // Step 4: Analyze suggested fix
  let fixAnalysis = ''
  if (context.suggestedFix) {
    fixAnalysis = await analyzeProposedFix(context)
    securityNotes.push(`Fix analysis: ${fixAnalysis.slice(0, 100)}...`)
  }

  // Step 5: Calculate confidence and result
  const confidence = calculateConfidence(staticAnalysis, sandboxResult)
  const result = determineResult(staticAnalysis, sandboxResult, confidence)

  // Step 6: Suggest reward
  const suggestedReward = calculateReward(
    severityAssessment,
    confidence,
    sandboxResult?.exploitTriggered ?? false,
  )

  // Step 7: Generate impact assessment
  const impactAssessment = await generateImpactAssessment(
    context,
    severityAssessment,
  )

  return {
    result,
    confidence,
    exploitVerified: sandboxResult?.exploitTriggered ?? false,
    impactAssessment,
    severityAssessment,
    fixAnalysis,
    suggestedReward,
    securityNotes,
    sandboxLogs,
  }
}

async function performStaticAnalysis(context: ValidationContext): Promise<{
  isLikelyValid: boolean
  notes: string[]
}> {
  const systemPrompt = `You are a security expert analyzing vulnerability reports.
Evaluate the following submission for validity, severity accuracy, and potential impact.
Be skeptical but fair. Look for:
1. Technical accuracy of the vulnerability description
2. Whether the claimed severity matches the actual impact
3. Completeness of reproduction steps
4. Quality of proof of concept (if provided)

Respond in JSON format: { "isLikelyValid": boolean, "notes": string[] }`

  const prompt = `VULNERABILITY SUBMISSION:
Title: ${context.title}
Claimed Severity: ${BountySeverityName[context.severity]}
Type: ${VulnerabilityTypeName[context.vulnType]}

Description:
${context.description}

Affected Components:
${context.affectedComponents.join(', ')}

Steps to Reproduce:
${context.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Proof of Concept:
${context.proofOfConcept ? context.proofOfConcept.slice(0, 2000) : 'Not provided'}

Suggested Fix:
${context.suggestedFix ?? 'Not provided'}

Analyze this submission and provide your assessment.`

  const response = await analyzeWithAI(prompt, systemPrompt)
  const rawParsed = JSON.parse(response)
  return SecurityValidationResponseSchema.parse(rawParsed)
}

async function assessSeverity(
  context: ValidationContext,
  sandboxResult: SandboxResult | null,
): Promise<BountySeverity> {
  // If exploit verified and matches critical types, confirm critical
  if (sandboxResult?.exploitTriggered) {
    if (
      context.vulnType === VulnerabilityType.FUNDS_AT_RISK ||
      context.vulnType === VulnerabilityType.WALLET_DRAIN ||
      context.vulnType === VulnerabilityType.REMOTE_CODE_EXECUTION
    ) {
      return BountySeverity.CRITICAL
    }
    if (
      context.vulnType === VulnerabilityType.TEE_BYPASS ||
      context.vulnType === VulnerabilityType.MPC_KEY_EXPOSURE ||
      context.vulnType === VulnerabilityType.CONSENSUS_ATTACK
    ) {
      return BountySeverity.HIGH
    }
  }

  // Default to claimed severity if within one level
  return context.severity
}

async function analyzeProposedFix(context: ValidationContext): Promise<string> {
  const systemPrompt = `You are a security engineer reviewing a proposed fix for a vulnerability.
Evaluate if the fix:
1. Actually addresses the vulnerability
2. Introduces any new security issues
3. Is complete or needs additional work

Be concise and technical.`

  const prompt = `VULNERABILITY:
${context.description}

PROPOSED FIX:
${context.suggestedFix}

Analyze this fix.`

  return await analyzeWithAI(prompt, systemPrompt)
}

function calculateConfidence(
  staticAnalysis: { isLikelyValid: boolean; notes: string[] },
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
  _staticAnalysis: { isLikelyValid: boolean; notes: string[] },
  sandboxResult: SandboxResult | null,
  confidence: number,
): ValidationResult {
  if (sandboxResult?.exploitTriggered) {
    return ValidationResult.VERIFIED
  }

  if (confidence >= 70) {
    return ValidationResult.LIKELY_VALID
  }

  if (confidence >= 40) {
    return ValidationResult.NEEDS_MORE_INFO
  }

  return ValidationResult.INVALID
}

function calculateReward(
  severity: BountySeverity,
  confidence: number,
  exploitVerified: boolean,
): bigint {
  const baseRewards: Record<BountySeverity, bigint> = {
    [BountySeverity.LOW]: (500n * 10n ** 18n) / 2500n, // ~$500 in ETH
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

async function generateImpactAssessment(
  context: ValidationContext,
  assessedSeverity: BountySeverity,
): Promise<string> {
  const systemPrompt = `You are writing an impact assessment for a security vulnerability.
Be clear, technical, and focus on real-world impact. Include:
1. What an attacker could achieve
2. Who is affected
3. Potential financial impact
4. Urgency of fix`

  const prompt = `VULNERABILITY: ${context.title}
TYPE: ${VulnerabilityTypeName[context.vulnType]}
SEVERITY: ${BountySeverityName[assessedSeverity]}
DESCRIPTION: ${context.description}
AFFECTED: ${context.affectedComponents.join(', ')}

Write a brief impact assessment.`

  return await analyzeWithAI(prompt, systemPrompt)
}

export const securityValidationAgent = {
  id: 'security-validation',
  name: 'Security Validation Agent',
  role: 'SECURITY_VALIDATOR',
  character: {
    name: 'Security Validation Agent',
    system: `You are a specialized security validation agent for the Jeju Network bug bounty program.

Your responsibilities:
1. Analyze vulnerability submissions for validity
2. Execute proofs of concept in secure sandboxes
3. Assess actual vs claimed severity
4. Evaluate proposed fixes
5. Recommend reward amounts

You are skeptical but fair. You look for:
- Technical accuracy
- Reproducibility
- Real-world impact
- Quality of evidence

When in doubt, escalate to guardian review with your concerns.`,
    bio: ['Security validation specialist for bug bounty program'],
    messageExamples: [],
    plugins: [],
    settings: {},
  },
}

export type { ValidationContext, ValidationReport, SandboxResult }
