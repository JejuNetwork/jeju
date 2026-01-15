#!/usr/bin/env bun
/**
 * Bootstrap autonomous agents for localnet.
 * - Registers on-chain agents if missing in SQLit
 * - Inserts autonomous_config/runtime_state in SQLit (enabled=0)
 * - Updates config for existing entries without touching runtime state
 */

import { getCrucibleUrl, getCurrentNetwork } from '@jejunetwork/config'
import { AUTONOMOUS_AGENTS, characters } from '../api/characters'
import { DEFAULT_AUTONOMOUS_CONFIG, type AutonomousAgentConfig } from '../api/autonomous/types'
import { getDatabase, type Agent } from '../api/sdk/database'
import type { AgentCharacter } from '../lib/types'

const DEFAULT_RUNTIME_STATE = {
  previous_tick: 0,
  last_tick: 0,
  last_scheduled_run: 0,
}

function isNumericAgentId(agentId: string): boolean {
  return /^\d+$/.test(agentId)
}

type AutonomousOverrides = Partial<
  Pick<
    AutonomousAgentConfig,
    | 'tickIntervalMs'
    | 'capabilities'
    | 'watchRoom'
    | 'postToRoom'
    | 'schedule'
    | 'urgencyTriggers'
    | 'executionMode'
    | 'codeFirstConfig'
  >
>

function buildAutonomousConfig(overrides: AutonomousOverrides) {
  const { enabled: _ignored, ...defaultConfig } = DEFAULT_AUTONOMOUS_CONFIG
  return {
    ...defaultConfig,
    tickIntervalMs:
      overrides.tickIntervalMs ?? DEFAULT_AUTONOMOUS_CONFIG.tickIntervalMs,
    capabilities: {
      ...DEFAULT_AUTONOMOUS_CONFIG.capabilities,
      ...overrides.capabilities,
    },
    maxActionsPerTick: DEFAULT_AUTONOMOUS_CONFIG.maxActionsPerTick,
    watchRoom: overrides.watchRoom,
    postToRoom: overrides.postToRoom,
    schedule: overrides.schedule,
    urgencyTriggers: overrides.urgencyTriggers,
    executionMode: overrides.executionMode,
    codeFirstConfig: overrides.codeFirstConfig,
  }
}

async function registerOnChainAgent(
  crucibleEndpoint: string,
  character: AgentCharacter,
  capabilities: AutonomousAgentConfig['capabilities'],
): Promise<{
  agentId: string
  characterCid: string
  stateCid: string
  owner: string
}> {
  const registerResponse = await fetch(`${crucibleEndpoint}/api/v1/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: character.name,
      character: {
        name: character.name,
        description: character.description,
        system: character.system,
        bio: character.bio,
        messageExamples: character.messageExamples,
        topics: character.topics,
        adjectives: character.adjectives,
        style: character.style,
      },
      capabilities,
    }),
  })

  if (!registerResponse.ok) {
    const errorText = await registerResponse.text()
    throw new Error(
      `Agent registration failed: ${registerResponse.status} - ${errorText}`,
    )
  }

  const registerResult = (await registerResponse.json()) as {
    agentId: string
    characterCid: string
    stateCid: string
  }

  const agentResponse = await fetch(
    `${crucibleEndpoint}/api/v1/agents/${registerResult.agentId}`,
  )
  if (!agentResponse.ok) {
    const errorText = await agentResponse.text()
    throw new Error(
      `Failed to load agent owner: ${agentResponse.status} - ${errorText}`,
    )
  }

  const agentResult = (await agentResponse.json()) as {
    agent: { owner: string }
  }

  return {
    agentId: registerResult.agentId,
    characterCid: registerResult.characterCid,
    stateCid: registerResult.stateCid,
    owner: agentResult.agent.owner,
  }
}

async function main(): Promise<void> {
  const network = getCurrentNetwork()
  if (network !== 'localnet') {
    console.log('[bootstrap] Skipping: only runs on localnet')
    return
  }

  const crucibleEndpoint = getCrucibleUrl(network)
  const db = getDatabase()
  const connected = await db.connect()
  if (!connected) {
    console.error('[bootstrap] SQLit unavailable; aborting')
    process.exit(1)
  }
  const existingAgents = await db.listAgents({ limit: 500 })

  const existingByName = new Map<string, Agent>()
  for (const agent of existingAgents) {
    const current = existingByName.get(agent.name)
    if (!current || (isNumericAgentId(agent.agent_id) && !isNumericAgentId(current.agent_id))) {
      existingByName.set(agent.name, agent)
    }
  }

  for (const [characterId, overrides] of Object.entries(AUTONOMOUS_AGENTS)) {
    const character = characters[characterId]
    if (!character) {
      console.warn(`[bootstrap] Character not found: ${characterId}`)
      continue
    }

    const autonomousConfig = buildAutonomousConfig(overrides)
    const existing = existingByName.get(character.name)

    if (existing && isNumericAgentId(existing.agent_id)) {
      await db.updateAgent(existing.agent_id, {
        name: character.name,
        autonomousConfig,
      })
      console.log(
        `[bootstrap] Updated config for ${character.name} (agent ${existing.agent_id})`,
      )
      continue
    }

    try {
      const registration = await registerOnChainAgent(
        crucibleEndpoint,
        character,
        autonomousConfig.capabilities,
      )

      await db.createAgent({
        agentId: registration.agentId,
        name: character.name,
        owner: registration.owner,
        characterCid: registration.characterCid,
        stateCid: registration.stateCid,
        autonomousConfig,
        runtimeState: DEFAULT_RUNTIME_STATE,
        enabled: false,
      })

      console.log(
        `[bootstrap] Registered ${character.name} as agent ${registration.agentId}`,
      )
    } catch (error) {
      console.error(
        `[bootstrap] Failed to bootstrap ${character.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

main().catch((error) => {
  console.error(
    `[bootstrap] Fatal error: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
})
