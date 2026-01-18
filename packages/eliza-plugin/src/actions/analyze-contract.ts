/**
 * ANALYZE_CONTRACT Action
 *
 * Performs systematic multi-pass LLM analysis of Solidity contracts
 * and generates structured security audit reports.
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
  auditFindingsArraySchema,
  type Severity,
  type SeverityCounts,
  truncateOutput,
} from '../validation'

// Analysis prompts for each vulnerability category
const ANALYSIS_PROMPTS = {
  reentrancy: (
    source: string,
  ) => `Analyze this Solidity contract for REENTRANCY vulnerabilities only.

Look for:
- External calls (call, send, transfer) before state updates
- Callbacks that could re-enter the contract
- Cross-function reentrancy via shared state
- Read-only reentrancy in view functions

Contract source:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding must have:
- id: unique string like "REENTRANCY-1"
- severity: "critical", "high", "medium", or "low"
- title: short description
- location: function name or line reference
- description: detailed explanation of the issue
- recommendation: how to fix it

If no reentrancy issues found, output: []

JSON array:`,

  accessControl: (
    source: string,
  ) => `Analyze this Solidity contract for ACCESS CONTROL vulnerabilities only.

Look for:
- Missing onlyOwner or role-based modifiers on sensitive functions
- Unprotected selfdestruct or delegatecall
- tx.origin used for authentication
- Missing zero-address checks on critical parameters
- Centralization risks (single owner controls everything)

Contract source:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding must have:
- id: unique string like "ACCESS-1"
- severity: "critical", "high", "medium", or "low"
- title: short description
- location: function name or line reference
- description: detailed explanation of the issue
- recommendation: how to fix it

If no access control issues found, output: []

JSON array:`,

  arithmetic: (
    source: string,
  ) => `Analyze this Solidity contract for ARITHMETIC vulnerabilities only.

Look for:
- Integer overflow/underflow (especially in Solidity <0.8.0 without SafeMath)
- Unchecked blocks with risky arithmetic
- Division by zero possibilities
- Precision loss in calculations
- Rounding errors that could be exploited

Contract source:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding must have:
- id: unique string like "ARITH-1"
- severity: "critical", "high", "medium", or "low"
- title: short description
- location: function name or line reference
- description: detailed explanation of the issue
- recommendation: how to fix it

If no arithmetic issues found, output: []

JSON array:`,

  general: (
    source: string,
  ) => `Analyze this Solidity contract for GENERAL security issues.

Look for:
- Unchecked return values from low-level calls
- Front-running vulnerabilities
- Timestamp dependence for critical logic
- Denial of Service vectors (unbounded loops, block gas limit)
- Missing event emissions for state changes
- Floating pragma versions
- Unused variables or dead code
- Gas optimization issues

Contract source:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding must have:
- id: unique string like "GEN-1"
- severity: "critical", "high", "medium", "low", or "informational"
- title: short description
- location: function name or line reference
- description: detailed explanation of the issue
- recommendation: how to fix it

If no issues found, output: []

JSON array:`,
}

/**
 * Extract contract name from Solidity source
 */
function extractContractName(source: string): string {
  const match = source.match(/contract\s+(\w+)/)
  return match?.[1] ?? 'Unknown'
}

/**
 * Parse findings JSON from LLM response
 */
function parseFindingsFromResponse(response: string): AuditFinding[] {
  try {
    // Try to extract JSON array from response
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return []
    }

    const parsed = JSON.parse(jsonMatch[0])
    const validated = auditFindingsArraySchema.safeParse(parsed)

    if (validated.success) {
      return validated.data
    }

    // If validation fails, try to salvage what we can
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (f) =>
            f &&
            typeof f.title === 'string' &&
            typeof f.description === 'string',
        )
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
          recommendation: String(
            f.recommendation ?? 'Review and fix as appropriate',
          ),
          reasoning: String(f.reasoning ?? 'See description'),
          exploitSteps: String(f.exploitSteps ?? 'Not specified'),
        }))
    }

    return []
  } catch {
    return []
  }
}

/**
 * Count findings by severity
 */
function countBySeverity(findings: AuditFinding[]): SeverityCounts {
  const counts: SeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  }

  for (const finding of findings) {
    if (finding.severity in counts) {
      counts[finding.severity]++
    }
  }

  return counts
}

/**
 * Generate markdown report from audit findings
 */
function generateReportMarkdown(report: AuditReport): string {
  const severityEmoji: Record<Severity, string> = {
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
**Auditor:** AI Security Analyst

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
| ⚪ Informational | ${report.severityCounts.informational} |

**Total Findings:** ${report.findings.length}

---

## Detailed Findings

`

  if (report.findings.length === 0) {
    md += `*No security issues identified in this analysis.*\n`
  } else {
    // Sort by severity
    const severityOrder: Severity[] = [
      'critical',
      'high',
      'medium',
      'low',
      'informational',
    ]
    const sortedFindings = [...report.findings].sort(
      (a, b) =>
        severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
    )

    for (const finding of sortedFindings) {
      md += `### ${severityEmoji[finding.severity]} [${finding.severity.toUpperCase()}] ${finding.title}

**ID:** ${finding.id}
**Function:** \`${finding.function}\`

**Description:**
${finding.description}

**Reasoning:** ${finding.reasoning}

**Exploit Steps:** ${finding.exploitSteps}

**Recommendation:**
${finding.recommendation}

---

`
    }
  }

  md += `
## Disclaimer

This is an automated security analysis performed by an AI agent. It may not identify all vulnerabilities. A manual audit by experienced security researchers is recommended for production contracts.
`

  return md
}

/**
 * Generate executive summary based on findings
 */
function generateSummary(
  findings: AuditFinding[],
  contractName: string,
): string {
  const counts = countBySeverity(findings)
  const total = findings.length

  if (total === 0) {
    return `The ${contractName} contract appears to be well-structured with no obvious security vulnerabilities identified in this automated analysis. However, this does not guarantee the contract is free of issues.`
  }

  const parts: string[] = []

  if (counts.critical > 0) {
    parts.push(
      `**${counts.critical} critical issue${counts.critical > 1 ? 's' : ''}** requiring immediate attention`,
    )
  }
  if (counts.high > 0) {
    parts.push(
      `${counts.high} high-severity issue${counts.high > 1 ? 's' : ''}`,
    )
  }
  if (counts.medium > 0) {
    parts.push(
      `${counts.medium} medium-severity issue${counts.medium > 1 ? 's' : ''}`,
    )
  }
  if (counts.low + counts.informational > 0) {
    parts.push(
      `${counts.low + counts.informational} low/informational finding${counts.low + counts.informational > 1 ? 's' : ''}`,
    )
  }

  const riskLevel =
    counts.critical > 0
      ? 'HIGH RISK'
      : counts.high > 0
        ? 'MEDIUM RISK'
        : 'LOW RISK'

  return `The ${contractName} contract analysis identified ${total} finding${total > 1 ? 's' : ''}: ${parts.join(', ')}. Overall risk assessment: **${riskLevel}**. ${counts.critical > 0 ? 'Critical issues should be addressed before deployment.' : ''}`
}

export const analyzeContractAction: Action = {
  name: 'ANALYZE_CONTRACT',
  description:
    'Perform systematic security analysis on Solidity contract source code and generate an audit report',
  similes: [
    'analyze contract',
    'audit contract',
    'security review',
    'check vulnerabilities',
    'scan contract',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => true,

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    // Get contract source from message or state
    const messageText = (message.content.text as string) ?? ''

    // Try to extract source from various locations
    let contractSource: string | undefined

    // Check if source was passed in state (from prior FETCH_CONTRACT)
    if (state?.values?.contractSource) {
      contractSource = state.values.contractSource as string
    }

    // Check if source is in message content
    if (!contractSource && message.content.source) {
      contractSource = message.content.source as string
    }

    // Check if source is inline in message text (between code blocks)
    if (!contractSource) {
      const codeBlockMatch = messageText.match(
        /```(?:solidity)?\s*([\s\S]*?)```/,
      )
      if (codeBlockMatch) {
        contractSource = codeBlockMatch[1].trim()
      }
    }

    // Check if the whole message is Solidity code
    if (!contractSource && messageText.includes('pragma solidity')) {
      contractSource = messageText
    }

    if (!contractSource) {
      callback?.({
        text: 'No contract source provided. Please either:\n1. First use FETCH_CONTRACT to get source from a URL\n2. Paste the Solidity code directly in your message',
      })
      return
    }

    // Size limit
    const MAX_SIZE = 50 * 1024
    if (contractSource.length > MAX_SIZE) {
      callback?.({
        text: `Contract source too large (${contractSource.length} bytes). Maximum size is ${MAX_SIZE} bytes.`,
      })
      return
    }

    const contractName = extractContractName(contractSource)
    callback?.({
      text: `Analyzing ${contractName} contract for security vulnerabilities...\n\nRunning multi-pass analysis:\n- Reentrancy checks\n- Access control review\n- Arithmetic analysis\n- General security scan`,
    })

    // Run analysis passes
    const allFindings: AuditFinding[] = []
    const analysisCategories = [
      'reentrancy',
      'accessControl',
      'arithmetic',
      'general',
    ] as const

    for (const category of analysisCategories) {
      try {
        const prompt = ANALYSIS_PROMPTS[category](
          truncateOutput(contractSource, 40000),
        )

        // Use runtime's completion method if available, otherwise use simple approach
        let response: string

        if ('useModel' in runtime && typeof runtime.useModel === 'function') {
          // ElizaOS v2 pattern
          response = await (
            runtime as unknown as {
              useModel: (
                type: string,
                opts: { prompt: string },
              ) => Promise<string>
            }
          ).useModel('TEXT_LARGE', { prompt })
        } else if (
          'generateText' in runtime &&
          typeof runtime.generateText === 'function'
        ) {
          response = await (
            runtime as unknown as {
              generateText: (prompt: string) => Promise<string>
            }
          ).generateText(prompt)
        } else {
          // Fallback: return partial results
          callback?.({
            text: `Note: LLM inference not available for ${category} analysis pass.`,
          })
          continue
        }

        const findings = parseFindingsFromResponse(response)
        allFindings.push(...findings)
      } catch (err) {
        // Continue with other passes even if one fails
        console.error(`Analysis pass ${category} failed:`, err)
      }
    }

    // De-duplicate findings by title similarity
    const uniqueFindings: AuditFinding[] = []
    const seenTitles = new Set<string>()

    for (const finding of allFindings) {
      const normalizedTitle = finding.title.toLowerCase().trim()
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.add(normalizedTitle)
        uniqueFindings.push(finding)
      }
    }

    // Build report
    const report: AuditReport = {
      contractName,
      contractUrl: (state?.values?.contractUrl as string) ?? undefined,
      date: new Date().toISOString().split('T')[0],
      summary: generateSummary(uniqueFindings, contractName),
      findings: uniqueFindings,
      severityCounts: countBySeverity(uniqueFindings),
    }

    const markdownReport = generateReportMarkdown(report)

    callback?.({
      text: markdownReport,
      content: {
        report,
        type: 'security_audit',
      },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Analyze the contract I just fetched' },
      },
      {
        name: 'agent',
        content: {
          text: '# Security Audit Report\n\n**Contract:** MyToken\n...',
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: '```solidity\ncontract Vault { function withdraw() external { ... } }\n```\n\nAnalyze this',
        },
      },
      {
        name: 'agent',
        content: {
          text: '# Security Audit Report\n\n**Contract:** Vault\n...',
        },
      },
    ],
  ],
}
