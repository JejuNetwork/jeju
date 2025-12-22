/**
 * @fileoverview Programmatic IdentityRegistry contract tests
 * @module gateway/tests/contracts/identity-registry
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { getContractAddresses, getPublicClient } from '../fixtures/contracts'

describe('IdentityRegistry Contract', () => {
  const publicClient = getPublicClient()
  let addresses: Awaited<ReturnType<typeof getContractAddresses>>
  let hasIdentityRegistry = false

  beforeAll(async () => {
    addresses = await getContractAddresses()
    hasIdentityRegistry =
      !!addresses.identityRegistry && addresses.identityRegistry !== '0x'
  })

  test('should get total registered agents count', async () => {
    if (!hasIdentityRegistry) {
      console.log('⚠️ IdentityRegistry not deployed, skipping test')
      return
    }

    const count = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [
        {
          type: 'function',
          name: 'totalAgents',
          inputs: [],
          outputs: [{ name: 'count', type: 'uint256' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'totalAgents',
    })

    expect(count).toBeDefined()
    expect(count).toBeGreaterThanOrEqual(0n)
  })

  test('should get agents by tag', async () => {
    if (!hasIdentityRegistry) {
      console.log('⚠️ IdentityRegistry not deployed, skipping test')
      return
    }

    const gameAgents = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [
        {
          type: 'function',
          name: 'getAgentsByTag',
          inputs: [{ name: 'tag', type: 'string' }],
          outputs: [{ name: 'agentIds', type: 'uint256[]' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'getAgentsByTag',
      args: ['game'],
    })

    expect(Array.isArray(gameAgents)).toBe(true)
  })

  test('should get supported stake tokens', async () => {
    if (!hasIdentityRegistry) {
      console.log('⚠️ IdentityRegistry not deployed, skipping test')
      return
    }

    const tokens = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [
        {
          type: 'function',
          name: 'getSupportedStakeTokens',
          inputs: [],
          outputs: [{ name: 'tokens', type: 'address[]' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'getSupportedStakeTokens',
    })

    expect(Array.isArray(tokens)).toBe(true)
  })

  test('should read agent data if agents exist', async () => {
    if (!hasIdentityRegistry) {
      console.log('⚠️ IdentityRegistry not deployed, skipping test')
      return
    }

    const count = (await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [
        {
          type: 'function',
          name: 'totalAgents',
          inputs: [],
          outputs: [{ name: 'count', type: 'uint256' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'totalAgents',
    })) as bigint

    if (count > 0n) {
      const agent = await publicClient.readContract({
        address: addresses.identityRegistry,
        abi: [
          {
            type: 'function',
            name: 'getAgent',
            inputs: [{ name: 'agentId', type: 'uint256' }],
            outputs: [
              {
                type: 'tuple',
                components: [
                  { name: 'owner', type: 'address' },
                  { name: 'tokenURI', type: 'string' },
                  { name: 'registeredAt', type: 'uint256' },
                  { name: 'stakeTier', type: 'uint8' },
                  { name: 'stakeToken', type: 'address' },
                  { name: 'stakeAmount', type: 'uint256' },
                  { name: 'isBanned', type: 'bool' },
                ],
              },
            ],
            stateMutability: 'view',
          },
        ],
        functionName: 'getAgent',
        args: [1n],
      })

      expect(agent).toBeDefined()
    }
  })

  test('should read agent tags if agents exist', async () => {
    if (!hasIdentityRegistry) {
      console.log('⚠️ IdentityRegistry not deployed, skipping test')
      return
    }

    const count = (await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [
        {
          type: 'function',
          name: 'totalAgents',
          inputs: [],
          outputs: [{ name: 'count', type: 'uint256' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'totalAgents',
    })) as bigint

    if (count > 0n) {
      const tags = await publicClient.readContract({
        address: addresses.identityRegistry,
        abi: [
          {
            type: 'function',
            name: 'getAgentTags',
            inputs: [{ name: 'agentId', type: 'uint256' }],
            outputs: [{ name: 'tags', type: 'string[]' }],
            stateMutability: 'view',
          },
        ],
        functionName: 'getAgentTags',
        args: [1n],
      })

      expect(Array.isArray(tags)).toBe(true)
    }
  })

  test('should verify agent existence', async () => {
    if (!hasIdentityRegistry) {
      console.log('⚠️ IdentityRegistry not deployed, skipping test')
      return
    }

    const exists = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [
        {
          type: 'function',
          name: 'agentExists',
          inputs: [{ name: 'agentId', type: 'uint256' }],
          outputs: [{ name: 'exists', type: 'bool' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'agentExists',
      args: [1n],
    })

    expect(typeof exists).toBe('boolean')
  })

  test('should get contract version', async () => {
    if (!hasIdentityRegistry) {
      console.log('⚠️ IdentityRegistry not deployed, skipping test')
      return
    }

    const version = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [
        {
          type: 'function',
          name: 'version',
          inputs: [],
          outputs: [{ name: '', type: 'string' }],
          stateMutability: 'pure',
        },
      ],
      functionName: 'version',
    })

    expect(version).toBeDefined()
    expect(typeof version).toBe('string')
  })
})
