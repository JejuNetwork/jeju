/**
 * @fileoverview Governance A2A agent tests
 * @module gateway/tests/a2a/governance-agent
 */

import { describe, expect, test } from 'bun:test'
import { getCoreAppUrl, getNetworkName } from '@jejunetwork/config'

const GOVERNANCE_CARD_URL = `${getCoreAppUrl('NODE_EXPLORER_UI')}/.well-known/governance-agent-card.json`

describe('Governance Agent Card', () => {
  test('should serve governance agent card', async () => {
    const response = await fetch(GOVERNANCE_CARD_URL)

    expect(response.status).toBe(200)
    const card = await response.json()

    expect(card.id).toBe('jeju-futarchy-governance')
    expect(card.name).toBe(`${getNetworkName()} Futarchy Governance`)
  })

  test('should list futarchy-specific capabilities', async () => {
    const response = await fetch(GOVERNANCE_CARD_URL)
    const card = await response.json()

    expect(card.capabilities.governance).toBe(true)
    expect(card.capabilities.futarchy).toBe(true)
    expect(card.capabilities.predictionMarkets).toBe(true)
  })

  test('should list governance skills', async () => {
    const response = await fetch(GOVERNANCE_CARD_URL)
    const card = await response.json()

    const skillIds = card.skills.map((s: { id: string }) => s.id)

    expect(skillIds).toContain('get-active-quests')
    expect(skillIds).toContain('get-voting-power')
    expect(skillIds).toContain('create-quest')
  })

  test('should specify governance metadata', async () => {
    const response = await fetch(GOVERNANCE_CARD_URL)
    const card = await response.json()

    expect(card.metadata.governance_type).toBe('futarchy')
    expect(card.metadata.voting_mechanism).toBe('stake_weighted')
  })
})
