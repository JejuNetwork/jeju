/**
 * @fileoverview Programmatic PaymasterFactory contract tests
 * @module gateway/tests/contracts/paymaster-factory
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { getContractAddresses, getPublicClient } from '../fixtures/contracts'

// Contract result types
interface PaymasterDeployment {
  paymaster: `0x${string}`
  vault: `0x${string}`
  distributor: `0x${string}`
}

describe('PaymasterFactory Contract', () => {
  const publicClient = getPublicClient()
  let addresses: Awaited<ReturnType<typeof getContractAddresses>>
  let hasPaymasterFactory = false

  beforeAll(async () => {
    addresses = await getContractAddresses()
    hasPaymasterFactory =
      !!addresses.paymasterFactory && addresses.paymasterFactory !== '0x'
  })

  test('should get all deployments', async () => {
    if (!hasPaymasterFactory) {
      console.log('⚠️ PaymasterFactory not deployed, skipping test')
      return
    }

    const deployments = await publicClient.readContract({
      address: addresses.paymasterFactory,
      abi: [
        {
          type: 'function',
          name: 'getAllDeployments',
          inputs: [],
          outputs: [{ name: 'tokens', type: 'address[]' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'getAllDeployments',
    })

    expect(Array.isArray(deployments)).toBe(true)
  })

  test('should read deployment details for deployed token', async () => {
    if (!hasPaymasterFactory) {
      console.log('⚠️ PaymasterFactory not deployed, skipping test')
      return
    }

    const deployments = (await publicClient.readContract({
      address: addresses.paymasterFactory,
      abi: [
        {
          type: 'function',
          name: 'getAllDeployments',
          inputs: [],
          outputs: [{ name: 'tokens', type: 'address[]' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'getAllDeployments',
    })) as `0x${string}`[]

    if (deployments.length > 0) {
      const deployment = await publicClient.readContract({
        address: addresses.paymasterFactory,
        abi: [
          {
            type: 'function',
            name: 'getDeployment',
            inputs: [{ name: 'token', type: 'address' }],
            outputs: [
              {
                name: 'deployment',
                type: 'tuple',
                components: [
                  { name: 'paymaster', type: 'address' },
                  { name: 'vault', type: 'address' },
                  { name: 'distributor', type: 'address' },
                  { name: 'token', type: 'address' },
                  { name: 'operator', type: 'address' },
                  { name: 'deployedAt', type: 'uint256' },
                  { name: 'feeMargin', type: 'uint256' },
                ],
              },
            ],
            stateMutability: 'view',
          },
        ],
        functionName: 'getDeployment',
        args: [deployments[0]],
      })

      expect(deployment).toBeDefined()
      const deploy = deployment as {
        paymaster: `0x${string}`
        vault: `0x${string}`
        distributor: `0x${string}`
        feeMargin: bigint
      }

      expect(deploy.paymaster).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(deploy.vault).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(deploy.distributor).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(deploy.feeMargin).toBeGreaterThanOrEqual(0n)
    }
  })

  test('should verify deployment creates all three contracts', async () => {
    if (!hasPaymasterFactory) {
      console.log('⚠️ PaymasterFactory not deployed, skipping test')
      return
    }

    const deployments = (await publicClient.readContract({
      address: addresses.paymasterFactory,
      abi: [
        {
          type: 'function',
          name: 'getAllDeployments',
          inputs: [],
          outputs: [{ name: 'tokens', type: 'address[]' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'getAllDeployments',
    })) as `0x${string}`[]

    if (deployments.length > 0) {
      const deployment = (await publicClient.readContract({
        address: addresses.paymasterFactory,
        abi: [
          {
            type: 'function',
            name: 'getDeployment',
            inputs: [{ name: 'token', type: 'address' }],
            outputs: [
              {
                name: 'deployment',
                type: 'tuple',
                components: [
                  { name: 'paymaster', type: 'address' },
                  { name: 'vault', type: 'address' },
                  { name: 'distributor', type: 'address' },
                ],
              },
            ],
            stateMutability: 'view',
          },
        ],
        functionName: 'getDeployment',
        args: [deployments[0]],
      })) as PaymasterDeployment

      // All three contracts should be deployed (non-zero addresses)
      expect(deployment.paymaster).not.toBe(
        '0x0000000000000000000000000000000000000000',
      )
      expect(deployment.vault).not.toBe(
        '0x0000000000000000000000000000000000000000',
      )
      expect(deployment.distributor).not.toBe(
        '0x0000000000000000000000000000000000000000',
      )

      // All should be unique addresses
      expect(deployment.paymaster).not.toBe(deployment.vault)
      expect(deployment.paymaster).not.toBe(deployment.distributor)
      expect(deployment.vault).not.toBe(deployment.distributor)
    }
  })
})
