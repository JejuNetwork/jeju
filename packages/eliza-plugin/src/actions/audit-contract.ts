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
import {
  type AuditFinding,
  type AuditReport,
  type Severity,
  type SeverityCounts,
  auditFindingsArraySchema,
  fetchWithTimeout,
  isUrlSafeToFetch,
  truncateOutput,
} from '../validation'

// Domain allowlist for security
const ALLOWED_DOMAINS = new Set([
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
])

function isAllowedDomain(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return ALLOWED_DOMAINS.has(url.hostname)
  } catch {
    return false
  }
}

// Analysis prompts for each vulnerability category
const ANALYSIS_PROMPTS = {
  reentrancy: (source: string) => `Analyze this Solidity contract for REENTRANCY vulnerabilities only.

Look for:
- External calls (call, send, transfer) before state updates
- Callbacks that could re-enter the contract
- Cross-function reentrancy via shared state

Contract:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding: { id, severity, title, location, description, recommendation }
If no issues: []

JSON:`,

  accessControl: (source: string) => `Analyze this Solidity contract for ACCESS CONTROL vulnerabilities only.

Look for:
- Missing onlyOwner/role checks on sensitive functions
- Unprotected selfdestruct or delegatecall
- tx.origin authentication
- Centralization risks

Contract:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding: { id, severity, title, location, description, recommendation }
If no issues: []

JSON:`,

  arithmetic: (source: string) => `Analyze this Solidity contract for ARITHMETIC vulnerabilities only.

Look for:
- Integer overflow/underflow (pre-0.8.0 without SafeMath)
- Unchecked blocks with risky arithmetic
- Division by zero

Contract:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding: { id, severity, title, location, description, recommendation }
If no issues: []

JSON:`,

  general: (source: string) => `Analyze this Solidity contract for GENERAL security issues.

Look for:
- Unchecked return values from low-level calls
- Front-running vulnerabilities
- Denial of Service vectors
- Missing events, floating pragma

Contract:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding: { id, severity, title, location, description, recommendation }
If no issues: []

JSON:`,
}

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
          severity: (['critical', 'high', 'medium', 'low', 'informational'].includes(
            f.severity?.toLowerCase(),
          )
            ? f.severity.toLowerCase()
            : 'medium') as Severity,
          title: String(f.title),
          location: String(f.location ?? 'Unknown'),
          description: String(f.description),
          recommendation: String(f.recommendation ?? 'Review and fix'),
        }))
    }
    return []
  } catch {
    return []
  }
}

function countBySeverity(findings: AuditFinding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 }
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity]++
  }
  return counts
}

function generateReportMarkdown(report: AuditReport): string {
  const emoji: Record<Severity, string> = {
    critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', informational: '⚪',
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
    const order: Severity[] = ['critical', 'high', 'medium', 'low', 'informational']
    const sorted = [...report.findings].sort(
      (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
    )

    for (const f of sorted) {
      md += `### ${emoji[f.severity]} [${f.severity.toUpperCase()}] ${f.title}

**Location:** \`${f.location}\`

${f.description}

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
  if (counts.low + counts.informational > 0) parts.push(`${counts.low + counts.informational} low/info`)

  const risk = counts.critical > 0 ? 'HIGH RISK' : counts.high > 0 ? 'MEDIUM RISK' : 'LOW RISK'

  return `Found ${total} issue${total > 1 ? 's' : ''}: ${parts.join(', ')}. Risk: **${risk}**`
}

export const auditContractAction: Action = {
  name: 'AUDIT_CONTRACT',
  description: 'Fetch Solidity contract from GitHub URL and perform full security audit',
  similes: [
    'audit contract',
    'security audit',
    'analyze contract',
    'check contract security',
    'review contract',
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
      callback?.({ text: 'Please provide a GitHub raw URL to audit.' })
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
        text: `Only GitHub raw URLs allowed: ${[...ALLOWED_DOMAINS].join(', ')}`,
      })
      return
    }

    callback?.({ text: `Fetching contract from ${targetUrl}...` })

    // Fetch source
    const response = await fetchWithTimeout(targetUrl, {}, 30000)
    if (!response.ok) {
      callback?.({ text: `Fetch failed: ${response.status} ${response.statusText}` })
      return
    }

    const contractSource = await response.text()

    if (contractSource.length > 50 * 1024) {
      callback?.({ text: `Contract too large (${contractSource.length} bytes). Max 50KB.` })
      return
    }

    const contractName = extractContractName(contractSource)
    callback?.({
      text: `Analyzing ${contractName} (${contractSource.length} bytes)...\n\nRunning security checks:\n• Reentrancy\n• Access control\n• Arithmetic\n• General issues`,
    })

    // Run analysis passes
    const allFindings: AuditFinding[] = []
    const categories = ['reentrancy', 'accessControl', 'arithmetic', 'general'] as const

    // Check which LLM method is available
    const hasUseModel = 'useModel' in runtime && typeof runtime.useModel === 'function'
    const hasGenerateText = 'generateText' in runtime && typeof runtime.generateText === 'function'
    console.log(`[AUDIT_CONTRACT] LLM methods available: useModel=${hasUseModel}, generateText=${hasGenerateText}`)

    if (!hasUseModel && !hasGenerateText) {
      console.error('[AUDIT_CONTRACT] ERROR: No LLM methods available on runtime!')
      callback?.({
        text: `Error: No LLM inference available. The runtime is missing generateText/useModel methods.`,
      })
      return
    }

    for (const category of categories) {
      try {
        console.log(`[AUDIT_CONTRACT] Starting ${category} analysis pass...`)
        const prompt = ANALYSIS_PROMPTS[category](truncateOutput(contractSource, 35000))

        let response: string
        if (hasUseModel) {
          console.log(`[AUDIT_CONTRACT] Calling useModel('TEXT_ANALYSIS') for ${category}...`)
          response = await (runtime as unknown as { useModel: (t: string, o: { prompt: string }) => Promise<string> }).useModel('TEXT_ANALYSIS', { prompt })
        } else {
          console.log(`[AUDIT_CONTRACT] Calling generateText() for ${category}...`)
          response = await (runtime as unknown as { generateText: (p: string) => Promise<string> }).generateText(prompt)
        }

        console.log(`[AUDIT_CONTRACT] ${category} response length: ${response.length}`)
        console.log(`[AUDIT_CONTRACT] ${category} response preview: ${response.slice(0, 500)}`)

        const findings = parseFindingsFromResponse(response)
        console.log(`[AUDIT_CONTRACT] ${category} parsed findings: ${findings.length}`)
        allFindings.push(...findings)
      } catch (err) {
        console.error(`[AUDIT_CONTRACT] Analysis pass ${category} failed:`, err)
      }
    }

    console.log(`[AUDIT_CONTRACT] Total findings across all passes: ${allFindings.length}`)

    // De-duplicate by title
    const seen = new Set<string>()
    const unique = allFindings.filter((f) => {
      const key = f.title.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const report: AuditReport = {
      contractName,
      contractUrl: targetUrl,
      date: new Date().toISOString().split('T')[0],
      summary: generateSummary(unique, contractName),
      findings: unique,
      severityCounts: countBySeverity(unique),
    }

    callback?.({
      text: generateReportMarkdown(report),
      content: { report, type: 'security_audit' },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Audit https://raw.githubusercontent.com/.../Contract.sol' } },
      { name: 'agent', content: { text: '# Security Audit Report\n\n**Contract:** MyContract...' } },
    ],
  ],
}
