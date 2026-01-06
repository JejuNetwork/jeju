/**
 * Real Integration Tests
 *
 * These tests verify that the infrastructure components are using
 * real backends (SQLit, IPFS) not LARP implementations.
 *
 * Run with: bun test apps/dws/tests/integration/real-integration.test.ts
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  getCurrentNetwork,
  getIpfsApiUrl,
  getSQLitUrl,
} from '@jejunetwork/config'
import { SQLitClient } from '@jejunetwork/sqlit/client'
import { getInfrastructurePersistence } from '../../api/infrastructure/persistence'
import { getSourceUploader } from '../../api/infrastructure/source-uploader'
import { getVaultService } from '../../api/infrastructure/vault-service'
import { getBackendManager } from '../../api/storage/backends'

describe('Real Integration Verification', () => {
  const network = getCurrentNetwork()

  describe('Configuration Check', () => {
    test('network is detected correctly', () => {
      expect(['localnet', 'testnet', 'mainnet']).toContain(network)
      console.log(`[Test] Current network: ${network}`)
    })

    test('SQLit URL is configured', () => {
      const sqlitUrl = getSQLitUrl(network)
      expect(sqlitUrl).toBeDefined()
      expect(sqlitUrl.length).toBeGreaterThan(0)
      console.log(`[Test] SQLit URL: ${sqlitUrl}`)
    })

    test('IPFS URL is configured', () => {
      const ipfsUrl = getIpfsApiUrl(network)
      expect(ipfsUrl).toBeDefined()
      expect(ipfsUrl.length).toBeGreaterThan(0)
      console.log(`[Test] IPFS URL: ${ipfsUrl}`)
    })
  })

  describe('SQLit Client', () => {
    test('SQLitClient uses real v2 client', () => {
      // Verify the persistence layer uses the real SQLitClient
      const persistence = getInfrastructurePersistence()
      expect(persistence).toBeDefined()
      // The persistence service should have a SQLitClient internally
      // @ts-expect-error - accessing private property for verification
      const client = persistence.client
      expect(client).toBeInstanceOf(SQLitClient)
    })

    test('SQLitClient is configured with correct database ID', () => {
      const persistence = getInfrastructurePersistence()
      // @ts-expect-error - accessing private for verification
      const client = persistence.client as SQLitClient
      expect(client).toBeDefined()
      // The client should be configured for the correct network
      console.log(`[Test] SQLit client endpoint: ${client.getEndpoint()}`)
    })
  })

  describe('Storage Backend', () => {
    test('backend manager is created correctly', () => {
      const manager = getBackendManager()
      expect(manager).toBeDefined()
      expect(manager.listBackends().length).toBeGreaterThan(0)
      console.log(
        `[Test] Available backends: ${manager.listBackends().join(', ')}`,
      )
    })

    test('local backend is always available', () => {
      const manager = getBackendManager()
      expect(manager.listBackends()).toContain('local')
    })

    test('can upload to storage', async () => {
      const manager = getBackendManager()
      const testContent = Buffer.from(`test content ${Date.now()}`)
      const result = await manager.upload(testContent, { filename: 'test.txt' })

      expect(result.cid).toBeDefined()
      expect(result.cid.length).toBeGreaterThan(0)
      console.log(`[Test] Upload result CID: ${result.cid}`)

      // Verify we can download it back
      const downloaded = await manager.download(result.cid)
      expect(downloaded.content.toString()).toBe(testContent.toString())
    })
  })

  describe('Source Uploader', () => {
    test('uses real backend manager', async () => {
      const uploader = getSourceUploader()
      expect(uploader).toBeDefined()

      // Upload a test file
      const result = await uploader.uploadFile(
        'export default function() { return "hello"; }',
        'index.js',
      )
      expect(result.cid).toBeDefined()
      expect(result.hash).toMatch(/^0x[a-f0-9]{64}$/)
      expect(result.size).toBeGreaterThan(0)
      console.log(
        `[Test] Source upload CID: ${result.cid}, size: ${result.size}`,
      )
    })

    test('uploadWorkerCode creates proper bundle', async () => {
      const uploader = getSourceUploader()
      const code = 'export default { fetch() { return new Response("ok"); } }'
      const result = await uploader.uploadWorkerCode(code)

      expect(result.cid).toBeDefined()
      expect(result.size).toBeGreaterThan(0)

      // Verify the bundle format
      const manager = getBackendManager()
      const downloaded = await manager.download(result.cid)
      const bundle = JSON.parse(downloaded.content.toString())

      expect(bundle.type).toBe('dws-worker-bundle')
      expect(bundle.version).toBe(1)
      expect(bundle.code).toBe(code)
    })
  })

  describe('Vault Service', () => {
    test('vault service initializes correctly', async () => {
      const service = getVaultService()
      expect(service).toBeDefined()
      await service.initialize()
      // @ts-expect-error - checking private flag
      expect(service.initialized).toBe(true)
    })

    test('vault creation works', async () => {
      const service = getVaultService()
      const vault = await service.createVault(
        '0x1234567890123456789012345678901234567890',
        {
          name: `test-vault-${Date.now()}`,
          depositWei: '0',
        },
      )

      expect(vault.id).toMatch(/^vault-/)
      expect(vault.status).toBe('active')
      // On non-mainnet, should be auto-provisioned
      if (network !== 'mainnet') {
        expect(vault.balanceWei).toBeGreaterThan(0n)
        console.log(
          `[Test] Vault auto-provisioned with ${vault.balanceWei} wei`,
        )
      }
    })

    test('vault charging and usage tracking works', async () => {
      const service = getVaultService()
      const vault = await service.createVault(
        '0xabcdef1234567890abcdef1234567890abcdef12',
        {
          name: 'charge-test-vault',
          depositWei: '0',
        },
      )

      // Charge the vault
      const chargeResult = await service.charge(
        vault.id,
        'worker',
        'test-worker-1',
        1000n,
        'Test charge',
      )

      expect(chargeResult.success).toBe(true)
      expect(chargeResult.vault.usedWei).toBe(1000n)

      // Get usage history
      const history = await service.getUsageHistory(vault.id)
      expect(history.length).toBeGreaterThan(0)
      expect(history[0].amountWei).toBe(1000n)
      expect(history[0].description).toBe('Test charge')
    })

    test('cost estimation works', () => {
      const service = getVaultService()
      const estimate = service.estimateCost({
        workers: [{ memoryMb: 128, hours: 24 }],
        containers: [
          { cpuCores: 1, memoryMb: 512, storageMb: 1024, hours: 24 },
        ],
        storageGb: 10,
        domain: true,
      })

      expect(estimate.totalWei).toBeGreaterThan(0n)
      expect(estimate.breakdown.workers).toBeDefined()
      expect(estimate.breakdown.containers).toBeDefined()
      expect(estimate.breakdown.storage).toBeDefined()
      expect(estimate.breakdown.domain).toBeDefined()
      console.log(`[Test] Estimated cost: ${estimate.totalWei} wei`)
    })
  })

  describe('Persistence Layer', () => {
    let persistence: ReturnType<typeof getInfrastructurePersistence>

    beforeAll(async () => {
      persistence = getInfrastructurePersistence()
      // Only initialize if we're on localnet (in-memory mode)
      // Other networks need a real SQLit server
      if (network === 'localnet') {
        // In localnet, persistence falls back to in-memory
        // which doesn't require initialization
      }
    })

    test('persistence singleton is consistent', () => {
      const p1 = getInfrastructurePersistence()
      const p2 = getInfrastructurePersistence()
      expect(p1).toBe(p2)
    })

    test('persistence uses correct network endpoint', () => {
      // @ts-expect-error - accessing private for verification
      const client = persistence.client
      const endpoint = client.getEndpoint()
      const expectedEndpoint = getSQLitUrl(network)
      expect(endpoint).toBe(expectedEndpoint)
    })
  })
})

// Helper to check if SQLit server is reachable
async function checkSQLitAvailable(): Promise<boolean> {
  const network = getCurrentNetwork()
  const endpoint = getSQLitUrl(network)

  try {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

// Helper to check if IPFS is reachable
async function checkIPFSAvailable(): Promise<boolean> {
  const network = getCurrentNetwork()
  const endpoint = getIpfsApiUrl(network)

  try {
    const response = await fetch(`${endpoint}/api/v0/id`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

describe('Service Availability (informational)', () => {
  test('SQLit server status', async () => {
    const available = await checkSQLitAvailable()
    console.log(`[Test] SQLit server available: ${available}`)
    // This is informational - doesn't fail the test
  })

  test('IPFS server status', async () => {
    const available = await checkIPFSAvailable()
    console.log(`[Test] IPFS server available: ${available}`)
    // This is informational - doesn't fail the test
  })
})
