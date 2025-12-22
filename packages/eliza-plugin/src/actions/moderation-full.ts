/**
 * Full Moderation Actions for Eliza Plugin
 *
 * Evidence submission, case management, and reputation labels
 */

import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import type { Address, Hex } from 'viem'
import { parseEther } from 'viem'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import {
  appealContentSchema,
  caseContentSchema,
  caseIdSchema,
  evidenceContentSchema,
  evidenceSupportSchema,
  formatNumberedList,
  labelContentSchema,
  parseContent,
  validateServiceExists,
} from '../validation'

// ═══════════════════════════════════════════════════════════════════════════
//                          EVIDENCE ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const submitEvidenceAction: Action = {
  name: 'SUBMIT_EVIDENCE',
  description:
    'Submit evidence for a moderation case with stake. Evidence must be uploaded to IPFS first.',
  similes: ['add evidence', 'provide proof', 'submit proof'],
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Submit evidence for case 0x123... with IPFS hash QmXyz..., supporting action',
        },
      },
      {
        name: 'assistant',
        content: {
          text: 'Submitting evidence with 0.001 ETH stake supporting action...',
        },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, evidenceContentSchema)

    if (!content.caseId || !content.ipfsHash || !content.summary) {
      callback?.({
        text: 'Missing required fields: caseId, ipfsHash, summary',
      })
      return
    }

    const positionValue = content.position === 'against' ? 1 : 0
    const stake = content.stake ? parseEther(content.stake) : undefined

    const result = await sdk.moderation.submitEvidence({
      caseId: content.caseId as Hex,
      ipfsHash: content.ipfsHash,
      summary: content.summary,
      position: positionValue,
      stake,
    })

    callback?.({
      text: `Evidence submitted. ID: ${result.evidenceId}\nTx: ${result.txHash}`,
    })
  },
}

export const supportEvidenceAction: Action = {
  name: 'SUPPORT_EVIDENCE',
  description: 'Support or oppose submitted evidence with stake',
  similes: ['back evidence', 'support proof', 'oppose evidence'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Support evidence 0xabc... with 0.001 ETH' },
      },
      {
        name: 'assistant',
        content: { text: 'Supporting evidence with stake...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, evidenceSupportSchema)

    if (!content.evidenceId) {
      callback?.({ text: 'Evidence ID required' })
      return
    }

    const isSupporting = content.support !== false
    const stake = content.stake ? parseEther(content.stake) : undefined

    const txHash = await sdk.moderation.supportEvidence({
      evidenceId: content.evidenceId as Hex,
      isSupporting,
      comment: content.comment,
      stake,
    })

    callback?.({
      text: `Evidence ${isSupporting ? 'supported' : 'opposed'}. Tx: ${txHash}`,
    })
  },
}

export const getEvidenceAction: Action = {
  name: 'GET_EVIDENCE',
  description: 'Get details about submitted evidence',
  similes: ['view evidence', 'check evidence', 'evidence details'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Get evidence 0xabc...' },
      },
      {
        name: 'assistant',
        content: { text: 'Fetching evidence details...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, evidenceSupportSchema)

    if (!content.evidenceId) {
      callback?.({ text: 'Evidence ID required' })
      return
    }

    const evidence = await sdk.moderation.getEvidence(content.evidenceId as Hex)

    if (!evidence) {
      callback?.({ text: 'Evidence not found' })
      return
    }

    const statusNames = ['ACTIVE', 'REWARDED', 'SLASHED']

    callback?.({
      text: `Evidence ${content.evidenceId}:
- Case: ${evidence.caseId}
- Submitter: ${evidence.submitter}
- Position: ${evidence.position === 0 ? 'FOR_ACTION' : 'AGAINST_ACTION'}
- Stake: ${evidence.stake} wei
- Support: ${evidence.supportStake} wei (${evidence.supporterCount} supporters)
- Oppose: ${evidence.opposeStake} wei (${evidence.opposerCount} opposers)
- Status: ${statusNames[evidence.status]}
- Summary: ${evidence.summary}`,
    })
  },
}

export const listCaseEvidenceAction: Action = {
  name: 'LIST_CASE_EVIDENCE',
  description: 'List all evidence submitted for a moderation case',
  similes: ['case evidence', 'evidence for case', 'show case proofs'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'List evidence for case 0x123...' },
      },
      {
        name: 'assistant',
        content: { text: 'Listing evidence for the case...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, caseIdSchema)

    if (!content.caseId) {
      callback?.({ text: 'Case ID required' })
      return
    }

    const evidence = await sdk.moderation.listCaseEvidence(
      content.caseId as Hex,
    )

    if (evidence.length === 0) {
      callback?.({ text: 'No evidence submitted for this case' })
      return
    }

    const list = formatNumberedList(
      evidence,
      (e: { position: number; stake: bigint | string; summary: string }) =>
        `${e.position === 0 ? 'FOR' : 'AGAINST'} - ${e.stake} wei - ${e.summary.slice(0, 50)}...`,
    )

    callback?.({
      text: `Evidence for case ${content.caseId}:\n${list}`,
    })
  },
}

export const claimEvidenceRewardAction: Action = {
  name: 'CLAIM_EVIDENCE_REWARD',
  description: 'Claim rewards after a case is resolved in your favor',
  similes: ['claim reward', 'get evidence reward', 'collect reward'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Claim reward for evidence 0xabc...' },
      },
      {
        name: 'assistant',
        content: { text: 'Claiming evidence reward...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, evidenceSupportSchema)

    if (!content.evidenceId) {
      callback?.({ text: 'Evidence ID required' })
      return
    }

    const txHash = await sdk.moderation.claimEvidenceReward(
      content.evidenceId as Hex,
    )

    callback?.({ text: `Reward claimed. Tx: ${txHash}` })
  },
}

// ═══════════════════════════════════════════════════════════════════════════
//                          CASE ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const createCaseAction: Action = {
  name: 'CREATE_MODERATION_CASE',
  description: 'Create a new moderation case against an entity with stake',
  similes: ['report entity', 'open case', 'file complaint'],
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Create case against 0x123... for spam with description',
        },
      },
      {
        name: 'assistant',
        content: { text: 'Creating moderation case...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, caseContentSchema)

    if (!content.entity || !content.reportType || !content.description) {
      callback?.({
        text: 'Missing required fields: entity, reportType, description',
      })
      return
    }

    const stake = content.stake ? parseEther(content.stake) : undefined

    const result = await sdk.moderation.createCase({
      reportedEntity: content.entity as Address,
      reportType: content.reportType,
      description: content.description,
      evidence: content.evidence,
      stake,
    })

    callback?.({
      text: `Case created. ID: ${result.caseId}\nTx: ${result.txHash}`,
    })
  },
}

export const getCaseAction: Action = {
  name: 'GET_MODERATION_CASE',
  description: 'Get details about a moderation case',
  similes: ['view case', 'case details', 'check case'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Get case 0x123...' },
      },
      {
        name: 'assistant',
        content: { text: 'Fetching case details...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, caseIdSchema)

    if (!content.caseId) {
      callback?.({ text: 'Case ID required' })
      return
    }

    const caseData = await sdk.moderation.getCase(content.caseId as Hex)

    if (!caseData) {
      callback?.({ text: 'Case not found' })
      return
    }

    const statusNames = [
      'PENDING',
      'UNDER_REVIEW',
      'RESOLVED',
      'APPEALED',
      'CLOSED',
    ]
    const outcomeNames = [
      'NO_ACTION',
      'WARNING',
      'TEMPORARY_BAN',
      'PERMANENT_BAN',
      'SLASH',
    ]

    callback?.({
      text: `Case ${content.caseId}:
- Reporter: ${caseData.reporter}
- Reported: ${caseData.reportedEntity}
- Type: ${caseData.reportType}
- Status: ${statusNames[caseData.status]}
- Outcome: ${outcomeNames[caseData.outcome]}
- Total Stake: ${caseData.totalStake} wei
- Description: ${caseData.description}`,
    })
  },
}

export const listCasesAction: Action = {
  name: 'LIST_MODERATION_CASES',
  description: 'List moderation cases by status',
  similes: ['show cases', 'pending cases', 'all cases'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'List pending moderation cases' },
      },
      {
        name: 'assistant',
        content: { text: 'Listing pending cases...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, caseIdSchema)

    const statusMap: Record<string, 0 | 1 | 2 | 3 | 4> = {
      pending: 0,
      under_review: 1,
      resolved: 2,
      appealed: 3,
      closed: 4,
    }
    const status = content.status ? statusMap[content.status] : undefined

    const cases = await sdk.moderation.listCases(status)

    if (cases.length === 0) {
      callback?.({ text: 'No cases found' })
      return
    }

    const list = formatNumberedList(
      cases,
      (c: {
        reportType: string
        reportedEntity: string
        totalStake: bigint | string
      }) =>
        `${c.reportType} against ${c.reportedEntity.slice(0, 10)}... - ${c.totalStake} wei`,
    )

    callback?.({
      text: `Moderation cases:\n${list}`,
    })
  },
}

export const appealCaseAction: Action = {
  name: 'APPEAL_CASE',
  description: 'Appeal a moderation case decision with stake',
  similes: ['appeal decision', 'contest ruling', 'challenge outcome'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Appeal case 0x123... - unfair decision' },
      },
      {
        name: 'assistant',
        content: { text: 'Submitting appeal...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, appealContentSchema)

    if (!content.caseId || !content.reason) {
      callback?.({ text: 'Case ID and reason required' })
      return
    }

    const stake = content.stake ? parseEther(content.stake) : undefined

    const txHash = await sdk.moderation.appealCase(
      content.caseId as Hex,
      content.reason,
      stake,
    )

    callback?.({ text: `Appeal submitted. Tx: ${txHash}` })
  },
}

// ═══════════════════════════════════════════════════════════════════════════
//                          LABEL ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const issueLabelAction: Action = {
  name: 'ISSUE_REPUTATION_LABEL',
  description:
    'Issue a reputation label to an address (validator role required)',
  similes: ['add label', 'tag address', 'mark reputation'],
  examples: [
    [
      {
        name: 'user',
        content: { text: "Issue 'trusted_developer' label to 0x123..." },
      },
      {
        name: 'assistant',
        content: { text: 'Issuing reputation label...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, labelContentSchema)

    if (
      !content.target ||
      !content.label ||
      content.score === undefined ||
      !content.reason
    ) {
      callback?.({
        text: 'Required: target, label, score (0-10000), reason',
      })
      return
    }

    const txHash = await sdk.moderation.issueLabel({
      target: content.target as Address,
      label: content.label,
      score: content.score,
      reason: content.reason,
      expiresIn: content.expiresIn,
    })

    callback?.({ text: `Label issued. Tx: ${txHash}` })
  },
}

export const getLabelsAction: Action = {
  name: 'GET_REPUTATION_LABELS',
  description: 'Get all reputation labels for an address',
  similes: ['check labels', 'view reputation', 'address labels'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Get reputation labels for 0x123...' },
      },
      {
        name: 'assistant',
        content: { text: 'Fetching reputation labels...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, labelContentSchema)

    if (!content.target) {
      callback?.({ text: 'Target address required' })
      return
    }

    const labels = await sdk.moderation.getLabels(content.target as Address)

    if (labels.length === 0) {
      callback?.({ text: 'No labels found for this address' })
      return
    }

    const list = labels
      .map(
        (l) =>
          `- ${l.label}: ${l.score} (${l.revoked ? 'REVOKED' : 'active'}) - ${l.reason}`,
      )
      .join('\n')

    callback?.({
      text: `Reputation labels for ${content.target}:\n${list}`,
    })
  },
}

export const checkTrustAction: Action = {
  name: 'CHECK_TRUST_STATUS',
  description: 'Check if an address is trusted or suspicious',
  similes: ['is trusted', 'is suspicious', 'trust check'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Is 0x123... trusted?' },
      },
      {
        name: 'assistant',
        content: { text: 'Checking trust status...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const content = parseContent(message, labelContentSchema)

    if (!content.target) {
      callback?.({ text: 'Target address required' })
      return
    }

    const [isTrusted, isSuspicious, score] = await Promise.all([
      sdk.moderation.isTrusted(content.target as Address),
      sdk.moderation.isSuspicious(content.target as Address),
      sdk.moderation.getAggregateScore(content.target as Address),
    ])

    callback?.({
      text: `Trust status for ${content.target}:
- Trusted: ${isTrusted ? 'Yes ✓' : 'No'}
- Suspicious: ${isSuspicious ? 'Yes ⚠' : 'No'}
- Aggregate Score: ${score}/10000`,
    })
  },
}
