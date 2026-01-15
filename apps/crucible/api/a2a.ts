import { getNetworkName } from '@jejunetwork/config'
import { createA2AServer, type A2ASkill, type ProtocolData } from '@jejunetwork/shared'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { getCharacter } from './characters'
import { type RuntimeMessage, runtimeManager } from './sdk/eliza-runtime'
import { createLogger } from './sdk/logger'

const log = createLogger('A2A')

const SECURITY_ANALYST_ID = 'security-analyst'
const AUDIT_SKILL_ID = 'audit-contract'
const DEFAULT_AUDIT_ROOM = 'base-contract-reviews'

const AUDIT_SKILLS: A2ASkill[] = [
  {
    id: AUDIT_SKILL_ID,
    name: 'Audit Contract',
    description: 'Run a security audit on a smart contract URL',
    tags: ['security', 'audit', 'contracts'],
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Blockscout or GitHub raw URL for the contract',
        },
        message: {
          type: 'string',
          description: 'Optional caller message (CALL_AGENT payload)',
        },
        room: {
          type: 'string',
          description: 'Optional room to post the audit summary',
        },
      },
    },
  },
]

function asRecord(value: ProtocolData | undefined): Record<string, ProtocolData[keyof ProtocolData]> {
  return value && typeof value === 'object' ? (value as Record<string, ProtocolData[keyof ProtocolData]>) : {}
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s]+/i)
  if (!match) return undefined
  return match[0].replace(/[),.]+$/g, '')
}

function extractRoom(text: string): string | undefined {
  const match = text.match(/room=([^\s]+)/i)
  return match ? match[1] : undefined
}

function normalizeParams(params: ProtocolData): {
  url?: string
  message?: string
  room?: string
  context?: string
} {
  const record = asRecord(params)
  const nested = asRecord(record.params as ProtocolData | undefined)

  return {
    url: getString(nested.url) ?? getString(record.url),
    message: getString(nested.message) ?? getString(record.message),
    room: getString(nested.room) ?? getString(record.room),
    context: getString(nested.context) ?? getString(record.context),
  }
}

function buildAuditPrompt(url: string, context?: string): string {
  const lines = [`Audit ${url}`]
  if (context) {
    lines.push(`Context: ${context}`)
  }
  return lines.join('\n')
}

function trimForRoom(content: string): string {
  if (content.length <= 10000) return content
  return `${content.slice(0, 9970)}\n\n[truncated]`
}

async function getSecurityAnalystRuntime() {
  let runtime = runtimeManager.getRuntime(SECURITY_ANALYST_ID)
  if (runtime) return runtime

  const character = getCharacter(SECURITY_ANALYST_ID)
  if (!character) {
    throw new Error('security-analyst character not found')
  }

  runtime = await runtimeManager.createRuntime({
    agentId: SECURITY_ANALYST_ID,
    character,
  })
  return runtime
}

const a2aServer = createA2AServer({
  name: `${getNetworkName()} Crucible`,
  description: 'Crucible A2A skill router',
  skills: AUDIT_SKILLS,
  executeSkill: async (
    skillId: string,
    params: ProtocolData,
    address: Address,
  ) => {
    if (skillId !== AUDIT_SKILL_ID) {
      return {
        message: `Unknown skill: ${skillId}`,
        data: { error: 'unknown_skill', skillId },
      }
    }

    const normalized = normalizeParams(params)
    const url =
      normalized.url ?? (normalized.message ? extractUrl(normalized.message) : undefined)
    const room =
      normalized.room ??
      (normalized.message ? extractRoom(normalized.message) : undefined) ??
      DEFAULT_AUDIT_ROOM

    if (!url) {
      return {
        message: 'audit-contract requires a contract URL',
        data: { error: 'missing_url' },
      }
    }

    try {
      const runtime = await getSecurityAnalystRuntime()
      const prompt = buildAuditPrompt(url, normalized.context)

      const message: RuntimeMessage = {
        id: crypto.randomUUID(),
        userId: address ?? 'a2a-caller',
        roomId: room,
        content: { text: prompt, source: 'a2a' },
        createdAt: Date.now(),
      }

      const response = await runtime.processMessage(message)

      const postResult = await runtime.executeAction('POST_TO_ROOM', {
        room,
        content: trimForRoom(response.text),
      })

      if (!postResult.success) {
        log.warn('Failed to post audit result to room', {
          room,
          error: postResult.error ?? 'unknown error',
        })
      }

      return {
        message: response.text,
        data: {
          url,
          room,
          posted: postResult.success,
        },
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.error('A2A audit-contract failed', { error: errorMsg })
      return {
        message: `Audit failed: ${errorMsg}`,
        data: { error: 'audit_failed' },
      }
    }
  },
})

export const a2aRoutes = new Elysia({ prefix: '/a2a' })
  .get('/', () => ({
    service: 'crucible-a2a',
    protocol: 'A2A (Agent-to-Agent)',
    version: '1.0.0',
    endpoints: {
      agentCard: '/.well-known/agent-card.json',
      message: 'POST /',
    },
    skills: AUDIT_SKILLS.map((skill) => ({
      id: skill.id,
      name: skill.name,
    })),
  }))
  .use(a2aServer)
