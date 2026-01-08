/**
 * AUDIT_CONTRACT Action
 *
 * Combined action that fetches Solidity source from GitHub and
 * performs systematic security analysis in a single turn.
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { z } from 'zod'
import {
  type AuditFinding,
  type AuditReport,
  auditFindingsArraySchema,
  fetchWithTimeout,
  isUrlSafeToFetch,
  type Severity,
  type SeverityCounts,
  truncateOutput,
} from '../validation'

// Domain allowlist for security
const ALLOWED_DOMAINS = new Set([
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
  'base.blockscout.com',
])

function isAllowedDomain(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return ALLOWED_DOMAINS.has(url.hostname)
  } catch {
    return false
  }
}

// Blockscout API response schemas
const blockscoutAdditionalSourceSchema = z.object({
  file_path: z.string(),
  source_code: z.string(),
})

const blockscoutContractResponseSchema = z.object({
  name: z.string(),
  source_code: z.string(),
  additional_sources: z.array(blockscoutAdditionalSourceSchema).optional(),
  compiler_version: z.string().optional(),
  is_verified: z.boolean().optional(),
})

// Blockscout URL detection and parsing
const BLOCKSCOUT_DOMAINS = ['base.blockscout.com'] as const

function isBlockscoutUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return BLOCKSCOUT_DOMAINS.some((domain) => url.hostname === domain)
  } catch {
    return false
  }
}

function extractAddressFromBlockscoutUrl(urlString: string): string | null {
  try {
    const url = new URL(urlString)

    // Pattern 1: /address/0x... (user-facing)
    const addressMatch = url.pathname.match(/\/address\/(0x[a-fA-F0-9]{40})/)
    if (addressMatch) return addressMatch[1]

    // Pattern 2: /api/v2/smart-contracts/0x... (API URL)
    const apiMatch = url.pathname.match(
      /\/api\/v2\/smart-contracts\/(0x[a-fA-F0-9]{40})/,
    )
    if (apiMatch) return apiMatch[1]

    return null
  } catch {
    return null
  }
}

function buildBlockscoutApiUrl(hostname: string, address: string): string {
  return `https://${hostname}/api/v2/smart-contracts/${address}`
}

interface BlockscoutSourceResult {
  contractName: string
  source: string
  compilerVersion?: string
  additionalSources?: Array<{ filePath: string; source: string }>
}

async function fetchBlockscoutSource(
  hostname: string,
  address: string,
): Promise<BlockscoutSourceResult> {
  const apiUrl = buildBlockscoutApiUrl(hostname, address)

  const response = await fetchWithTimeout(
    apiUrl,
    {
      headers: { Accept: 'application/json' },
    },
    30000,
  )

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Contract not found or not verified: ${address}`)
    }
    throw new Error(
      `Blockscout API error: ${response.status} ${response.statusText}`,
    )
  }

  const json = await response.json()
  const parsed = blockscoutContractResponseSchema.safeParse(json)

  if (!parsed.success) {
    throw new Error(`Invalid Blockscout response: ${parsed.error.message}`)
  }

  const { name, source_code, additional_sources, compiler_version } =
    parsed.data

  if (!source_code || source_code.trim() === '') {
    throw new Error(`Contract ${address} has no source code (not verified?)`)
  }

  return {
    contractName: name,
    source: source_code,
    compilerVersion: compiler_version,
    additionalSources: additional_sources?.map((s) => ({
      filePath: s.file_path,
      source: s.source_code,
    })),
  }
}

function combineBlockscoutSources(result: BlockscoutSourceResult): string {
  // For single-file contracts, return as-is
  if (!result.additionalSources || result.additionalSources.length === 0) {
    return result.source
  }

  // For multi-file contracts, combine with file headers
  const parts: string[] = []

  // Main contract first
  parts.push(`// === Main Contract: ${result.contractName} ===\n`)
  parts.push(result.source)

  // Additional sources
  for (const additional of result.additionalSources) {
    parts.push(`\n\n// === File: ${additional.filePath} ===\n`)
    parts.push(additional.source)
  }

  return parts.join('')
}

// Few-shot examples for vulnerability detection
const FEW_SHOT_EXAMPLES = {
  reentrancy: {
    vulnerable: `// VULNERABLE: External call before state update
function withdraw() external {
    (bool sent,) = msg.sender.call{value: balances[msg.sender]}("");
    balances[msg.sender] = 0;  // Too late! Attacker can re-enter
}`,
    safe: `// SAFE: State update before external call (CEI pattern)
function withdraw() external {
    uint256 bal = balances[msg.sender];
    balances[msg.sender] = 0;  // First!
    (bool sent,) = msg.sender.call{value: bal}("");
}`,
  },
  accessControl: {
    vulnerable: `// VULNERABLE: No access control on sensitive function
function setOwner(address newOwner) external {
    owner = newOwner;  // Anyone can call this!
}`,
    safe: `// SAFE: Proper access control
function setOwner(address newOwner) external onlyOwner {
    require(newOwner != address(0), "Invalid");
    owner = newOwner;
}`,
  },
  arithmetic: {
    vulnerable: `// VULNERABLE: Unchecked arithmetic in pre-0.8 Solidity
function transfer(address to, uint256 amount) external {
    balances[msg.sender] -= amount;  // Can underflow!
    balances[to] += amount;
}`,
    safe: `// SAFE: Solidity 0.8+ has built-in overflow checks
pragma solidity ^0.8.0;
function transfer(address to, uint256 amount) external {
    balances[msg.sender] -= amount;  // Reverts on underflow
    balances[to] += amount;
}`,
  },
  general: {
    vulnerable: `// VULNERABLE: Unchecked low-level call return value
function sendEther(address to, uint256 amount) external {
    to.call{value: amount}("");  // Return value ignored!
}`,
    safe: `// SAFE: Check return value
function sendEther(address to, uint256 amount) external {
    (bool success,) = to.call{value: amount}("");
    require(success, "Transfer failed");
}`,
  },
}

// Analysis prompts for each vulnerability category with CoT structure
const ANALYSIS_PROMPTS = {
  reentrancy: (
    source: string,
  ) => `You are a Solidity security auditor. Analyze this contract for REENTRANCY vulnerabilities.

## Definition
Reentrancy occurs when an external call allows an attacker to re-enter the contract before the first invocation completes, potentially draining funds or corrupting state.

## Detection Rule (GPTScan Pattern)
SCENARIO: Function makes an external call (call, send, transfer, or callback) AND modifies contract state
PROPERTY: State is modified AFTER the external call, with no reentrancy guard

## Vulnerable Example
\`\`\`solidity
${FEW_SHOT_EXAMPLES.reentrancy.vulnerable}
\`\`\`

## Safe Example
\`\`\`solidity
${FEW_SHOT_EXAMPLES.reentrancy.safe}
\`\`\`

## Contract to Analyze
\`\`\`solidity
${source}
\`\`\`

## Analysis Steps
STEP 1: Identify all external calls (msg.sender.call, address.call, transfer, send, interface calls)
STEP 2: For each external call, trace what state variables are read/written before and after
STEP 3: Check if state updates occur AFTER external calls without reentrancy guards (nonReentrant, mutex)
STEP 4: For each vulnerability found, determine severity based on fund exposure and exploitability

## Output Format
Return ONLY a JSON array. For each finding include:
{ "id": "REENTRANCY-N", "severity": "critical|high|medium|low|informational", "title": "Brief title", "function": "function name", "description": "What the issue is", "reasoning": "Why this is vulnerable (your analysis)", "exploitSteps": "1. First step 2. Second step (plain text)", "recommendation": "How to fix" }

If no reentrancy issues found, return: []

JSON:`,

  accessControl: (
    source: string,
  ) => `You are a Solidity security auditor. Analyze this contract for ACCESS CONTROL vulnerabilities.

## Definition
Access control vulnerabilities occur when sensitive functions lack proper authorization checks, allowing unauthorized users to perform privileged operations.

## Detection Rule (GPTScan Pattern)
SCENARIO: Function performs a sensitive operation (ownership change, fund transfer, pause, upgrade, selfdestruct, delegatecall)
PROPERTY: No authorization check (onlyOwner, role-based, msg.sender validation) guards the operation

## Vulnerable Example
\`\`\`solidity
${FEW_SHOT_EXAMPLES.accessControl.vulnerable}
\`\`\`

## Safe Example
\`\`\`solidity
${FEW_SHOT_EXAMPLES.accessControl.safe}
\`\`\`

## Contract to Analyze
\`\`\`solidity
${source}
\`\`\`

## Analysis Steps
STEP 1: List all functions that perform sensitive operations (state changes, fund movements, admin actions)
STEP 2: For each sensitive function, check for access control modifiers or require/if statements validating msg.sender
STEP 3: Flag functions using tx.origin for authentication (vulnerable to phishing)
STEP 4: Assess severity based on impact (fund loss = critical, admin takeover = high, info leak = low)

## Output Format
Return ONLY a JSON array. For each finding include:
{ "id": "ACCESS-N", "severity": "critical|high|medium|low|informational", "title": "Brief title", "function": "function name", "description": "What the issue is", "reasoning": "Why this is vulnerable (your analysis)", "exploitSteps": "1. First step 2. Second step (plain text)", "recommendation": "How to fix" }

If no access control issues found, return: []

JSON:`,

  arithmetic: (
    source: string,
  ) => `You are a Solidity security auditor. Analyze this contract for ARITHMETIC vulnerabilities.

## Definition
Arithmetic vulnerabilities include integer overflow/underflow, division by zero, and precision loss that can corrupt calculations or enable exploits.

## Detection Rule (GPTScan Pattern)
SCENARIO: Contract has arithmetic operations (+, -, *, /, %)
PROPERTY: Uses Solidity <0.8.0 without SafeMath, OR uses unchecked blocks with user-controlled values, OR has potential division by zero

## Vulnerable Example
\`\`\`solidity
${FEW_SHOT_EXAMPLES.arithmetic.vulnerable}
\`\`\`

## Safe Example
\`\`\`solidity
${FEW_SHOT_EXAMPLES.arithmetic.safe}
\`\`\`

## Contract to Analyze
\`\`\`solidity
${source}
\`\`\`

## Analysis Steps
STEP 1: Check the pragma version - Solidity 0.8.0+ has built-in overflow protection
STEP 2: Find all unchecked { } blocks and analyze arithmetic within them for overflow/underflow risk
STEP 3: Identify division operations and check if divisor can be zero
STEP 4: Look for precision loss in division before multiplication patterns

## Output Format
Return ONLY a JSON array. For each finding include:
{ "id": "ARITH-N", "severity": "critical|high|medium|low|informational", "title": "Brief title", "function": "function name", "description": "What the issue is", "reasoning": "Why this is vulnerable (your analysis)", "exploitSteps": "1. First step 2. Second step (plain text)", "recommendation": "How to fix" }

If no arithmetic issues found, return: []

JSON:`,

  general: (
    source: string,
  ) => `You are a Solidity security auditor. Analyze this contract for GENERAL security issues.

## Definition
General security issues include unchecked return values, front-running vulnerabilities, denial of service vectors, and other common smart contract pitfalls.

## Detection Rule (GPTScan Pattern)
SCENARIO: Any code pattern in the contract
PROPERTY: Matches a known vulnerability pattern (unchecked call return, unbounded loops, timestamp dependence, etc.)

## Vulnerable Example
\`\`\`solidity
${FEW_SHOT_EXAMPLES.general.vulnerable}
\`\`\`

## Safe Example
\`\`\`solidity
${FEW_SHOT_EXAMPLES.general.safe}
\`\`\`

## Contract to Analyze
\`\`\`solidity
${source}
\`\`\`

## Analysis Steps
STEP 1: Find all low-level calls (.call, .delegatecall, .staticcall) and verify return values are checked
STEP 2: Look for loops over dynamic arrays that could cause DoS via gas exhaustion
STEP 3: Check for front-running risks (price-sensitive operations without slippage protection)
STEP 4: Identify informational issues: floating pragma, missing events, unused variables

## Severity Guidelines
- Known token standard design limitations (ERC20 approve race condition, ERC721 safe transfer callbacks) = LOW or INFORMATIONAL, not medium/high
- Issues with mitigations already provided by the codebase (e.g., increaseAllowance/decreaseAllowance) = INFORMATIONAL

## Output Format
Return ONLY a JSON array. For each finding include:
{ "id": "GENERAL-N", "severity": "critical|high|medium|low|informational", "title": "Brief title", "function": "function name", "description": "What the issue is", "reasoning": "Why this is vulnerable (your analysis)", "exploitSteps": "1. First step 2. Second step (plain text)", "recommendation": "How to fix" }

If no general issues found, return: []

JSON:`,
}

// Critic prompt for filtering false positives
const CRITIC_PROMPT = (
  findings: AuditFinding[],
  contractSource: string,
) => `You are a security audit reviewer. Your job is to verify findings and remove false positives.

## Contract Source
\`\`\`solidity
${contractSource}
\`\`\`

## Candidate Findings to Verify
${JSON.stringify(findings, null, 2)}

## Verification Task
For EACH finding, determine if it is a real vulnerability or a false positive.

Ask yourself:
1. Can I describe a CONCRETE exploit? (specific steps, not theoretical)
2. Are there mitigating factors in the code the auditor missed?

## Output Format
Return a JSON object with verdicts for each finding ID:
{
  "verdicts": {
    "FINDING-ID": {
      "keep": true,
      "reason": "Brief explanation"
    },
    "ANOTHER-ID": {
      "keep": false,
      "reason": "Why it's a false positive"
    }
  }
}

Rules:
- KEEP if: concrete exploit exists AND no complete mitigation
- REMOVE if: purely theoretical OR mitigation exists in code
- When uncertain, default to KEEP (don't filter real issues)

JSON:`

function extractContractName(source: string): string {
  const match = source.match(/contract\s+(\w+)/)
  return match?.[1] ?? 'Unknown'
}

function parseFindingsFromResponse(response: string): AuditFinding[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0])
    const validated = auditFindingsArraySchema.safeParse(parsed)

    if (validated.success) return validated.data

    if (Array.isArray(parsed)) {
      return parsed
        .filter((f) => f?.title && f?.description)
        .map((f, i) => ({
          id: f.id ?? `FINDING-${i + 1}`,
          severity: ([
            'critical',
            'high',
            'medium',
            'low',
            'informational',
          ].includes(f.severity?.toLowerCase())
            ? f.severity.toLowerCase()
            : 'medium') as Severity,
          title: String(f.title),
          function: String(f.function ?? f.location ?? 'Unknown'), // Backward compat: accept 'location' field
          description: String(f.description),
          recommendation: String(f.recommendation ?? 'Review and fix'),
          reasoning: String(f.reasoning ?? 'See description'),
          exploitSteps: Array.isArray(f.exploitSteps)
            ? f.exploitSteps.join('\n')
            : String(f.exploitSteps ?? 'Not specified'),
        }))
    }
    return []
  } catch {
    return []
  }
}

// Critic response types and parsing
interface CriticVerdict {
  keep: boolean
  reason: string
}

interface CriticResponse {
  verdicts: Record<string, CriticVerdict>
}

function parseCriticResponse(response: string): CriticResponse | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.verdicts || typeof parsed.verdicts !== 'object') {
      return null
    }

    return parsed as CriticResponse
  } catch {
    return null
  }
}

function filterFindingsWithCritic(
  findings: AuditFinding[],
  criticResponse: CriticResponse | null,
): { kept: AuditFinding[]; removed: AuditFinding[] } {
  if (!criticResponse) {
    // If Critic fails, keep all findings (fail-safe)
    console.log('[AUDIT_CONTRACT] Critic parsing failed, keeping all findings')
    return { kept: findings, removed: [] }
  }

  const kept: AuditFinding[] = []
  const removed: AuditFinding[] = []

  for (const finding of findings) {
    const verdict = criticResponse.verdicts[finding.id]

    // Default to KEEP if no verdict (fail-safe)
    if (!verdict || verdict.keep !== false) {
      kept.push(finding)
    } else {
      removed.push(finding)
      console.log(
        `[AUDIT_CONTRACT] Critic removed: ${finding.id} - ${verdict.reason}`,
      )
    }
  }

  return { kept, removed }
}

function countBySeverity(findings: AuditFinding[]): SeverityCounts {
  const counts: SeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  }
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity]++
  }
  return counts
}

function generateReportMarkdown(report: AuditReport): string {
  const emoji: Record<Severity, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵',
    informational: '⚪',
  }

  let md = `# Security Audit Report

**Contract:** ${report.contractName}
${report.contractUrl ? `**Source:** ${report.contractUrl}` : ''}
**Date:** ${report.date}

---

## Executive Summary

${report.summary}

---

## Findings Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${report.severityCounts.critical} |
| 🟠 High | ${report.severityCounts.high} |
| 🟡 Medium | ${report.severityCounts.medium} |
| 🔵 Low | ${report.severityCounts.low} |
| ⚪ Info | ${report.severityCounts.informational} |

**Total:** ${report.findings.length}

---

## Detailed Findings

`

  if (report.findings.length === 0) {
    md += `*No security issues identified.*\n`
  } else {
    const order: Severity[] = [
      'critical',
      'high',
      'medium',
      'low',
      'informational',
    ]
    const sorted = [...report.findings].sort(
      (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
    )

    for (const f of sorted) {
      md += `### ${emoji[f.severity]} [${f.severity.toUpperCase()}] ${f.title}

**Function:** \`${f.function}\`

${f.description}

**Reasoning:** ${f.reasoning}

**Exploit Steps:** ${f.exploitSteps}

**Fix:** ${f.recommendation}

---

`
    }
  }

  return md
}

function generateSummary(findings: AuditFinding[], name: string): string {
  const counts = countBySeverity(findings)
  const total = findings.length

  if (total === 0) {
    return `The ${name} contract appears well-structured with no obvious vulnerabilities in this automated scan.`
  }

  const parts: string[] = []
  if (counts.critical > 0) parts.push(`**${counts.critical} critical**`)
  if (counts.high > 0) parts.push(`${counts.high} high`)
  if (counts.medium > 0) parts.push(`${counts.medium} medium`)
  if (counts.low + counts.informational > 0)
    parts.push(`${counts.low + counts.informational} low/info`)

  const risk =
    counts.critical > 0
      ? 'HIGH RISK'
      : counts.high > 0
        ? 'MEDIUM RISK'
        : 'LOW RISK'

  return `Found ${total} issue${total > 1 ? 's' : ''}: ${parts.join(', ')}. Risk: **${risk}**`
}

export const auditContractAction: Action = {
  name: 'AUDIT_CONTRACT',
  description:
    'Fetch Solidity contract from GitHub raw URL or Blockscout URL and perform full security audit',
  similes: [
    'audit contract',
    'security audit',
    'analyze contract',
    'check contract security',
    'review contract',
    'audit blockscout contract',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => true,

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = (message.content.text as string) ?? ''

    // Extract URL
    const urlMatch = text.match(/https?:\/\/[^\s]+/)
    if (!urlMatch) {
      callback?.({
        text: 'Please provide a GitHub raw URL or Blockscout URL to audit.',
      })
      return
    }

    const targetUrl = urlMatch[0]

    // Security checks
    if (!isUrlSafeToFetch(targetUrl)) {
      callback?.({ text: 'Cannot fetch from internal or private URLs.' })
      return
    }

    if (!isAllowedDomain(targetUrl)) {
      callback?.({
        text: `Only GitHub raw URLs or Blockscout URLs allowed: ${[...ALLOWED_DOMAINS].join(', ')}`,
      })
      return
    }

    callback?.({ text: `Fetching contract from ${targetUrl}...` })

    // Fetch source - branch based on URL type
    let contractSource: string
    let contractName: string

    if (isBlockscoutUrl(targetUrl)) {
      // Blockscout path: extract address and fetch via API
      const url = new URL(targetUrl)
      const address = extractAddressFromBlockscoutUrl(targetUrl)

      if (!address) {
        callback?.({
          text: `Could not extract contract address from Blockscout URL. Expected format: https://base.blockscout.com/address/0x...`,
        })
        return
      }

      try {
        const blockscoutResult = await fetchBlockscoutSource(
          url.hostname,
          address,
        )
        contractSource = combineBlockscoutSources(blockscoutResult)
        contractName = blockscoutResult.contractName

        if (blockscoutResult.compilerVersion) {
          console.log(
            `[AUDIT_CONTRACT] Blockscout contract ${contractName} compiled with ${blockscoutResult.compilerVersion}`,
          )
        }
        if (
          blockscoutResult.additionalSources &&
          blockscoutResult.additionalSources.length > 0
        ) {
          console.log(
            `[AUDIT_CONTRACT] Contract has ${blockscoutResult.additionalSources.length} additional source files`,
          )
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        callback?.({ text: `Blockscout fetch failed: ${errorMessage}` })
        return
      }
    } else {
      // GitHub path: fetch raw source directly
      const response = await fetchWithTimeout(targetUrl, {}, 30000)
      if (!response.ok) {
        callback?.({
          text: `Fetch failed: ${response.status} ${response.statusText}`,
        })
        return
      }

      contractSource = await response.text()
      contractName = extractContractName(contractSource)
    }

    if (contractSource.length > 50 * 1024) {
      callback?.({
        text: `Contract too large (${contractSource.length} bytes). Max 50KB.`,
      })
      return
    }
    callback?.({
      text: `Analyzing ${contractName} (${contractSource.length} bytes)...\n\nRunning security checks:\n• Reentrancy\n• Access control\n• Arithmetic\n• General issues`,
    })

    // Run analysis passes
    const allFindings: AuditFinding[] = []
    const categories = [
      'reentrancy',
      'accessControl',
      'arithmetic',
      'general',
    ] as const

    // Check which LLM method is available
    const hasUseModel =
      'useModel' in runtime && typeof runtime.useModel === 'function'
    const hasGenerateText =
      'generateText' in runtime && typeof runtime.generateText === 'function'
    console.log(
      `[AUDIT_CONTRACT] LLM methods available: useModel=${hasUseModel}, generateText=${hasGenerateText}`,
    )

    if (!hasUseModel && !hasGenerateText) {
      console.error(
        '[AUDIT_CONTRACT] ERROR: No LLM methods available on runtime!',
      )
      callback?.({
        text: `Error: No LLM inference available. The runtime is missing generateText/useModel methods.`,
      })
      return
    }

    for (const category of categories) {
      try {
        console.log(`[AUDIT_CONTRACT] Starting ${category} analysis pass...`)
        const prompt = ANALYSIS_PROMPTS[category](
          truncateOutput(contractSource, 35000),
        )

        let response: string
        if (hasUseModel) {
          console.log(
            `[AUDIT_CONTRACT] Calling useModel('TEXT_ANALYSIS') for ${category}...`,
          )
          response = await (
            runtime as unknown as {
              useModel: (t: string, o: { prompt: string }) => Promise<string>
            }
          ).useModel('TEXT_ANALYSIS', { prompt })
        } else {
          console.log(
            `[AUDIT_CONTRACT] Calling generateText() for ${category}...`,
          )
          response = await (
            runtime as unknown as {
              generateText: (p: string) => Promise<string>
            }
          ).generateText(prompt)
        }

        console.log(
          `[AUDIT_CONTRACT] ${category} response length: ${response.length}`,
        )
        console.log(
          `[AUDIT_CONTRACT] ${category} response preview: ${response.slice(0, 500)}`,
        )

        const findings = parseFindingsFromResponse(response)
        console.log(
          `[AUDIT_CONTRACT] ${category} parsed findings: ${findings.length}`,
        )
        allFindings.push(...findings)
      } catch (err) {
        console.error(`[AUDIT_CONTRACT] Analysis pass ${category} failed:`, err)
      }
    }

    console.log(
      `[AUDIT_CONTRACT] Total findings across all passes: ${allFindings.length}`,
    )

    // De-duplicate by title
    const seen = new Set<string>()
    const unique = allFindings.filter((f) => {
      const key = f.title.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Phase 2: Critic verification pass (if findings exist)
    let finalFindings = unique
    if (unique.length > 0) {
      console.log(
        `[AUDIT_CONTRACT] Running Critic pass on ${unique.length} findings...`,
      )

      try {
        const criticPromptText = CRITIC_PROMPT(
          unique,
          truncateOutput(contractSource, 15000),
        )

        let criticResponse: string
        if (hasUseModel) {
          console.log(
            `[AUDIT_CONTRACT] Calling useModel('TEXT_ANALYSIS') for Critic...`,
          )
          criticResponse = await (
            runtime as unknown as {
              useModel: (t: string, o: { prompt: string }) => Promise<string>
            }
          ).useModel('TEXT_ANALYSIS', { prompt: criticPromptText })
        } else {
          console.log(`[AUDIT_CONTRACT] Calling generateText() for Critic...`)
          criticResponse = await (
            runtime as unknown as {
              generateText: (p: string) => Promise<string>
            }
          ).generateText(criticPromptText)
        }

        console.log(
          `[AUDIT_CONTRACT] Critic response length: ${criticResponse.length}`,
        )

        const parsedCritic = parseCriticResponse(criticResponse)
        const { kept, removed } = filterFindingsWithCritic(unique, parsedCritic)

        finalFindings = kept
        console.log(
          `[AUDIT_CONTRACT] Critic: kept ${kept.length}, removed ${removed.length}`,
        )
      } catch (err) {
        console.error(
          '[AUDIT_CONTRACT] Critic pass failed, keeping all findings:',
          err,
        )
        // Fail-safe: keep all findings if Critic errors
      }
    }

    const report: AuditReport = {
      contractName,
      contractUrl: targetUrl,
      date: new Date().toISOString().split('T')[0],
      summary: generateSummary(finalFindings, contractName),
      findings: finalFindings,
      severityCounts: countBySeverity(finalFindings),
    }

    callback?.({
      text: generateReportMarkdown(report),
      content: { report, type: 'security_audit' },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Audit https://raw.githubusercontent.com/.../Contract.sol',
        },
      },
      {
        name: 'agent',
        content: {
          text: '# Security Audit Report\n\n**Contract:** MyContract...',
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: 'Audit this contract https://base.blockscout.com/address/0x1234567890abcdef1234567890abcdef12345678',
        },
      },
      {
        name: 'agent',
        content: {
          text: '# Security Audit Report\n\n**Contract:** VerifiedContract...',
        },
      },
    ],
  ],
}
