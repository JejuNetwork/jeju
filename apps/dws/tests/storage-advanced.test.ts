/**
 * Advanced Storage Component Tests
 *
 * Tests for:
 * - Filecoin backend
 * - Storage proof system
 * - Retrieval market
 * - Signed URLs
 * - Media optimizer
 * - TUS uploads
 * - Storage analytics
 */

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { parseEther } from 'viem'
import { StorageAnalyticsManager } from '../api/storage/analytics'
import {
  buildMerkleTree,
  generateMerkleProof,
  StorageProofManager,
  verifyMerkleProof,
} from '../api/storage/proof-system'
import { RetrievalMarketManager } from '../api/storage/retrieval-market'
import { parseSignedUrl, SignedUrlManager } from '../api/storage/signed-urls'
import {
  handleTusDelete,
  handleTusHead,
  handleTusOptions,
  handleTusPost,
  TusUploadManager,
} from '../api/storage/tus-upload'

setDefaultTimeout(30000)

// ============ Merkle Tree Tests ============

describe('Merkle Tree', () => {
  test('builds tree from chunks', () => {
    const chunks = [
      Buffer.from('chunk1'),
      Buffer.from('chunk2'),
      Buffer.from('chunk3'),
      Buffer.from('chunk4'),
    ]

    const tree = buildMerkleTree(chunks)

    expect(tree.root).toBeDefined()
    expect(tree.root.length).toBe(64) // SHA256 hex
    expect(tree.leaves).toHaveLength(4)
    expect(tree.width).toBe(4)
    expect(tree.depth).toBeGreaterThan(1)
  })

  test('generates and verifies merkle proof', () => {
    const chunks = [
      Buffer.from('chunk1'),
      Buffer.from('chunk2'),
      Buffer.from('chunk3'),
      Buffer.from('chunk4'),
    ]

    const tree = buildMerkleTree(chunks)
    const proof = generateMerkleProof(tree, 2) // Proof for chunk3

    expect(proof.length).toBeGreaterThan(0)

    // Verify the proof
    const isValid = verifyMerkleProof(tree.root, tree.leaves[2], 2, proof)
    expect(isValid).toBe(true)
  })

  test('rejects invalid merkle proof', () => {
    const chunks = [Buffer.from('chunk1'), Buffer.from('chunk2')]

    const tree = buildMerkleTree(chunks)
    const proof = generateMerkleProof(tree, 0)

    // Try to verify with wrong leaf
    const fakeLeaf =
      'fakehash123456789012345678901234567890123456789012345678901234'
    const isValid = verifyMerkleProof(tree.root, fakeLeaf, 0, proof)
    expect(isValid).toBe(false)
  })

  test('handles single chunk', () => {
    const chunks = [Buffer.from('single chunk')]

    const tree = buildMerkleTree(chunks)
    expect(tree.root).toBeDefined()
    expect(tree.leaves).toHaveLength(1)
    expect(tree.root).toBe(tree.leaves[0])
  })

  test('handles empty chunk', () => {
    const chunks = [Buffer.alloc(0)]

    const tree = buildMerkleTree(chunks)
    expect(tree.root).toBeDefined()
    expect(tree.leaves).toHaveLength(1)
  })
})

// ============ Storage Proof Manager Tests ============

describe('StorageProofManager', () => {
  let manager: StorageProofManager

  beforeEach(() => {
    manager = new StorageProofManager(`test-node-${Date.now()}`)
  })

  test('creates access challenge', async () => {
    const challenge = await manager.createChallenge(
      'test-cid-123',
      'target-node-456',
      'access',
    )

    expect(challenge.challengeId).toBeDefined()
    expect(challenge.cid).toBe('test-cid-123')
    expect(challenge.targetNodeId).toBe('target-node-456')
    expect(challenge.proofType).toBe('access')
    expect(challenge.status).toBe('pending')
    expect(challenge.deadline).toBeGreaterThan(Date.now())
    expect(challenge.challengeData.randomNonce).toBeDefined()
  })

  test('creates merkle challenge', async () => {
    const content = Buffer.from('test content for merkle')
    manager.registerContentMerkleTree('merkle-cid', content)

    const challenge = await manager.createChallenge(
      'merkle-cid',
      'target-node',
      'merkle',
    )

    expect(challenge.challengeData.merkleRoot).toBeDefined()
    expect(challenge.challengeData.chunkIndex).toBeDefined()
  })

  test('generates and verifies access proof', async () => {
    const content = Buffer.from('content to prove access')
    const challenge = await manager.createChallenge(
      'access-cid',
      'target-node',
      'access',
    )

    const proof = await manager.generateProof(challenge, content)

    expect(proof.proofId).toBeDefined()
    expect(proof.challengeId).toBe(challenge.challengeId)
    expect(proof.proofData.contentHash).toBeDefined()
    expect(proof.proofData.responseHash).toBeDefined()
    expect(proof.signature).toBeDefined()

    // Verify the proof
    const result = await manager.verifyProof(proof, challenge, content)
    expect(result.valid).toBe(true)
  })

  test('generates and verifies merkle proof', async () => {
    const content = Buffer.alloc(1024 * 1024) // 1MB content
    for (let i = 0; i < content.length; i++) {
      content[i] = i % 256
    }

    manager.registerContentMerkleTree('large-cid', content)

    const challenge = await manager.createChallenge(
      'large-cid',
      'target-node',
      'merkle',
    )

    const proof = await manager.generateProof(challenge, content)

    expect(proof.proofData.chunkData).toBeDefined()
    expect(proof.proofData.merkleProof).toBeDefined()
    expect(proof.proofData.chunkIndex).toBeDefined()

    const result = await manager.verifyProof(proof, challenge, content)
    expect(result.valid).toBe(true)
  })

  test('generates spacetime proof', async () => {
    const content = Buffer.from('spacetime content')
    const challenge = await manager.createChallenge(
      'spacetime-cid',
      'target-node',
      'spacetime',
    )

    const proof = await manager.generateProof(challenge, content)

    expect(proof.proofData.commitmentHash).toBeDefined()
  })

  test('tracks challenges by CID', async () => {
    await manager.createChallenge('cid-a', 'node-1', 'access')
    await manager.createChallenge('cid-a', 'node-2', 'access')
    await manager.createChallenge('cid-b', 'node-1', 'access')

    const challengesForA = manager.getChallengesForContent('cid-a')
    expect(challengesForA).toHaveLength(2)

    const challengesForB = manager.getChallengesForContent('cid-b')
    expect(challengesForB).toHaveLength(1)
  })

  test('gets pending challenges', async () => {
    await manager.createChallenge('pending-cid', 'node-1', 'access')
    await manager.createChallenge('pending-cid', 'node-2', 'merkle')

    const pending = manager.getPendingChallenges()
    expect(pending.length).toBeGreaterThanOrEqual(2)
    expect(pending.every((c) => c.status === 'pending')).toBe(true)
  })

  test('bulk verification', async () => {
    const contentList = [
      { cid: 'bulk-cid-1', content: Buffer.from('content 1') },
      { cid: 'bulk-cid-2', content: Buffer.from('content 2') },
      { cid: 'bulk-cid-3', content: Buffer.from('content 3') },
    ]

    const results = await manager.verifyNodeStorage(
      'bulk-test-node',
      contentList,
    )

    expect(results.totalChallenges).toBe(3)
    expect(results.passedChallenges).toBe(3)
    expect(results.failedChallenges).toBe(0)
    expect(results.results).toHaveLength(3)
  })
})

// ============ Retrieval Market Tests ============

describe('RetrievalMarketManager', () => {
  let market: RetrievalMarketManager

  beforeEach(() => {
    market = new RetrievalMarketManager(`provider-${Date.now()}`)
  })

  test('registers provider', () => {
    const provider = market.registerProvider({
      providerId: 'test-provider',
      address: '0x1234567890123456789012345678901234567890',
      region: 'us-east-1',
      bandwidth: {
        maxMbps: 1000,
        currentMbps: 100,
        availableMbps: 900,
        bytesServed24h: 1000000,
        bytesServed7d: 5000000,
        peakHourUtilization: 0.5,
      },
      pricing: {
        model: 'fixed',
        basePricePerGb: parseEther('0.0001'),
        premiumMultiplier: 1.5,
        minimumCharge: parseEther('0.00001'),
        freeQuotaMb: 100,
      },
      reputation: {
        score: 95,
        totalRetrievals: 1000,
        successfulRetrievals: 980,
        failedRetrievals: 20,
        averageLatencyMs: 50,
        uptime: 99.9,
        disputesLost: 1,
        lastUpdated: Date.now(),
      },
      supportedBackends: ['ipfs', 'arweave'],
      contentCids: ['cid-1', 'cid-2', 'cid-3'],
    })

    expect(provider.isOnline).toBe(true)
    expect(provider.lastSeen).toBeGreaterThan(0)
  })

  test('updates provider reputation', () => {
    market.registerProvider({
      providerId: 'rep-test-provider',
      address: '0x1234567890123456789012345678901234567890',
      region: 'us-west-2',
      bandwidth: {
        maxMbps: 500,
        currentMbps: 50,
        availableMbps: 450,
        bytesServed24h: 0,
        bytesServed7d: 0,
        peakHourUtilization: 0,
      },
      pricing: {
        model: 'fixed',
        basePricePerGb: parseEther('0.0001'),
        premiumMultiplier: 1,
        minimumCharge: 0n,
        freeQuotaMb: 0,
      },
      reputation: {
        score: 50,
        totalRetrievals: 0,
        successfulRetrievals: 0,
        failedRetrievals: 0,
        averageLatencyMs: 0,
        uptime: 100,
        disputesLost: 0,
        lastUpdated: Date.now(),
      },
      supportedBackends: ['ipfs'],
      contentCids: [],
    })

    market.updateProviderReputation('rep-test-provider', {
      successful: true,
      latencyMs: 45,
    })

    const provider = market.getProvider('rep-test-provider')
    expect(provider?.reputation.totalRetrievals).toBe(1)
    expect(provider?.reputation.successfulRetrievals).toBe(1)
  })

  test('creates retrieval request', async () => {
    market.registerProvider({
      providerId: 'content-provider',
      address: '0x1234567890123456789012345678901234567890',
      region: 'us-east-1',
      bandwidth: {
        maxMbps: 1000,
        currentMbps: 100,
        availableMbps: 900,
        bytesServed24h: 0,
        bytesServed7d: 0,
        peakHourUtilization: 0,
      },
      pricing: {
        model: 'fixed',
        basePricePerGb: parseEther('0.0001'),
        premiumMultiplier: 1,
        minimumCharge: 0n,
        freeQuotaMb: 0,
      },
      reputation: {
        score: 90,
        totalRetrievals: 100,
        successfulRetrievals: 95,
        failedRetrievals: 5,
        averageLatencyMs: 60,
        uptime: 99,
        disputesLost: 0,
        lastUpdated: Date.now(),
      },
      supportedBackends: ['ipfs'],
      contentCids: ['requested-cid'],
    })

    const request = await market.createRetrievalRequest(
      'requested-cid',
      1024 * 1024, // 1MB
      {
        preferredRegions: ['us-east-1'],
        maxPricePerGb: parseEther('0.001'),
      },
    )

    expect(request.requestId).toBeDefined()
    expect(request.cid).toBe('requested-cid')
    expect(request.contentSize).toBe(1024 * 1024)
    expect(request.status).toBe('pending')
  })

  test('gets market stats', () => {
    market.registerProvider({
      providerId: 'stats-provider',
      address: '0x1234567890123456789012345678901234567890',
      region: 'eu-west-1',
      bandwidth: {
        maxMbps: 500,
        currentMbps: 100,
        availableMbps: 400,
        bytesServed24h: 1000000,
        bytesServed7d: 5000000,
        peakHourUtilization: 0.3,
      },
      pricing: {
        model: 'fixed',
        basePricePerGb: parseEther('0.0002'),
        premiumMultiplier: 1,
        minimumCharge: 0n,
        freeQuotaMb: 50,
      },
      reputation: {
        score: 85,
        totalRetrievals: 50,
        successfulRetrievals: 48,
        failedRetrievals: 2,
        averageLatencyMs: 70,
        uptime: 98,
        disputesLost: 0,
        lastUpdated: Date.now(),
      },
      supportedBackends: ['ipfs', 'filecoin'],
      contentCids: ['cid-a', 'cid-b'],
    })

    const stats = market.getMarketStats()

    expect(stats.totalProviders).toBeGreaterThanOrEqual(1)
    expect(stats.activeProviders).toBeGreaterThanOrEqual(1)
    expect(stats.totalBandwidthMbps).toBeGreaterThan(0)
    expect(stats.availableBandwidthMbps).toBeGreaterThan(0)
  })

  test('gets regional stats', () => {
    market.registerProvider({
      providerId: 'regional-1',
      address: '0x1111111111111111111111111111111111111111',
      region: 'us-east-1',
      bandwidth: {
        maxMbps: 500,
        currentMbps: 50,
        availableMbps: 450,
        bytesServed24h: 0,
        bytesServed7d: 0,
        peakHourUtilization: 0,
      },
      pricing: {
        model: 'fixed',
        basePricePerGb: parseEther('0.0001'),
        premiumMultiplier: 1,
        minimumCharge: 0n,
        freeQuotaMb: 0,
      },
      reputation: {
        score: 80,
        totalRetrievals: 10,
        successfulRetrievals: 10,
        failedRetrievals: 0,
        averageLatencyMs: 40,
        uptime: 100,
        disputesLost: 0,
        lastUpdated: Date.now(),
      },
      supportedBackends: ['ipfs'],
      contentCids: ['cid-1'],
    })

    market.registerProvider({
      providerId: 'regional-2',
      address: '0x2222222222222222222222222222222222222222',
      region: 'eu-west-1',
      bandwidth: {
        maxMbps: 300,
        currentMbps: 30,
        availableMbps: 270,
        bytesServed24h: 0,
        bytesServed7d: 0,
        peakHourUtilization: 0,
      },
      pricing: {
        model: 'fixed',
        basePricePerGb: parseEther('0.00015'),
        premiumMultiplier: 1,
        minimumCharge: 0n,
        freeQuotaMb: 0,
      },
      reputation: {
        score: 75,
        totalRetrievals: 5,
        successfulRetrievals: 5,
        failedRetrievals: 0,
        averageLatencyMs: 60,
        uptime: 99,
        disputesLost: 0,
        lastUpdated: Date.now(),
      },
      supportedBackends: ['ipfs'],
      contentCids: ['cid-2'],
    })

    const regionalStats = market.getRegionalStats()

    expect(regionalStats.length).toBeGreaterThanOrEqual(2)

    const usEast = regionalStats.find((r) => r.region === 'us-east-1')
    const euWest = regionalStats.find((r) => r.region === 'eu-west-1')

    expect(usEast).toBeDefined()
    expect(euWest).toBeDefined()
    expect(usEast?.providerCount).toBeGreaterThanOrEqual(1)
  })
})

// ============ Signed URL Tests ============

describe('SignedUrlManager', () => {
  let manager: SignedUrlManager

  beforeEach(() => {
    manager = new SignedUrlManager({
      signingSecret: 'test-secret-key',
      baseUrl: 'https://storage.example.com',
      defaultExpirySeconds: 3600,
    })
  })

  test('creates signed download URL', () => {
    const url = manager.createSignedUrl('test-cid-123', 'download')

    expect(url.urlId).toBeDefined()
    expect(url.fullUrl).toContain('test-cid-123')
    expect(url.fullUrl).toContain('signature=')
    expect(url.signature).toBeDefined()
    expect(url.action).toBe('download')
    expect(url.policy.expiresAt).toBeGreaterThan(Date.now())
  })

  test('creates signed upload URL', () => {
    const uploadUrl = manager.createUploadUrl({
      maxSizeBytes: 100 * 1024 * 1024,
      allowedContentTypes: ['image/png', 'image/jpeg'],
      metadata: { userId: 'user-123' },
    })

    expect(uploadUrl.url).toContain('/storage/upload')
    expect(uploadUrl.fields['x-url-id']).toBeDefined()
    expect(uploadUrl.fields['x-signature']).toBeDefined()
    expect(uploadUrl.fields['x-max-size']).toBe(String(100 * 1024 * 1024))
    expect(uploadUrl.expiresAt).toBeGreaterThan(Date.now())
  })

  test('validates signed URL', () => {
    const url = manager.createSignedUrl('valid-cid', 'download')

    const result = manager.validateSignedUrl(
      url.urlId,
      'download',
      url.signature,
    )

    expect(result.valid).toBe(true)
    expect(result.url).toBeDefined()
    expect(result.errors).toHaveLength(0)
  })

  test('rejects expired URL', () => {
    const url = manager.createSignedUrl('expire-cid', 'download', {
      expirySeconds: -1, // Already expired
    })

    const result = manager.validateSignedUrl(
      url.urlId,
      'download',
      url.signature,
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('URL has expired')
  })

  test('rejects wrong action', () => {
    const url = manager.createSignedUrl('action-cid', 'download')

    const result = manager.validateSignedUrl(
      url.urlId,
      'upload', // Wrong action
      url.signature,
    )

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('not allowed'))).toBe(true)
  })

  test('rejects invalid signature', () => {
    const url = manager.createSignedUrl('sig-cid', 'download')

    const result = manager.validateSignedUrl(
      url.urlId,
      'download',
      'invalid-signature',
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Invalid signature')
  })

  test('enforces max uses', () => {
    const url = manager.createSignedUrl('uses-cid', 'download', {
      policy: { maxUses: 2 },
    })

    // First use
    manager.recordUsage(url.urlId, '192.168.1.1')
    let result = manager.validateSignedUrl(url.urlId, 'download', url.signature)
    expect(result.valid).toBe(true)

    // Second use
    manager.recordUsage(url.urlId, '192.168.1.1')
    result = manager.validateSignedUrl(url.urlId, 'download', url.signature)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Maximum uses exceeded')
  })

  test('revokes URL', () => {
    const url = manager.createSignedUrl('revoke-cid', 'download')

    // URL should be valid
    let result = manager.validateSignedUrl(url.urlId, 'download', url.signature)
    expect(result.valid).toBe(true)

    // Revoke
    const revoked = manager.revokeUrl(url.urlId)
    expect(revoked).toBe(true)

    // URL should now be invalid
    result = manager.validateSignedUrl(url.urlId, 'download', url.signature)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('URL has been revoked')
  })

  test('revokes all URLs for CID', () => {
    manager.createSignedUrl('multi-cid', 'download')
    manager.createSignedUrl('multi-cid', 'download')
    manager.createSignedUrl('other-cid', 'download')

    const count = manager.revokeAllForCid('multi-cid')
    expect(count).toBe(2)
  })

  test('parses signed URL', () => {
    const url = manager.createSignedUrl('parse-cid', 'download')
    const parsed = parseSignedUrl(url.fullUrl)

    expect(parsed).not.toBeNull()
    expect(parsed?.urlId).toBe(url.urlId)
    expect(parsed?.cid).toBe('parse-cid')
    expect(parsed?.action).toBe('download')
    expect(parsed?.signature).toBe(url.signature)
  })

  test('gets stats', () => {
    manager.createSignedUrl('stats-1', 'download')
    manager.createSignedUrl('stats-2', 'upload')

    const stats = manager.getStats()

    expect(stats.totalCreated).toBeGreaterThanOrEqual(2)
    expect(stats.activeUrls).toBeGreaterThanOrEqual(2)
  })

  test('cleans up expired URLs', () => {
    // Create an expired URL
    manager.createSignedUrl('cleanup-cid', 'download', {
      expirySeconds: -1,
    })

    const cleaned = manager.cleanupExpired()
    expect(cleaned).toBeGreaterThanOrEqual(1)
  })
})

// ============ TUS Upload Tests ============

describe('TusUploadManager', () => {
  let tus: TusUploadManager

  beforeEach(() => {
    tus = new TusUploadManager({
      baseUrl: 'https://upload.example.com',
      maxFileSize: 1024 * 1024 * 100, // 100MB
      defaultExpiryHours: 24,
      chunkSize: 1024 * 1024, // 1MB chunks
    })
  })

  test('creates upload session', () => {
    const upload = tus.createUpload({
      uploadLength: 1024 * 1024 * 10, // 10MB
      uploadMetadata: `${Buffer.from('filename').toString('base64')} ${Buffer.from('test.txt').toString('base64')}`,
    })

    expect(upload.uploadId).toBeDefined()
    expect(upload.uploadUrl).toContain(upload.uploadId)
    expect(upload.fileSize).toBe(1024 * 1024 * 10)
    expect(upload.uploadOffset).toBe(0)
    expect(upload.status).toBe('created')
    expect(upload.expiresAt).toBeGreaterThan(Date.now())
  })

  test('uploads chunks', () => {
    const upload = tus.createUpload({ uploadLength: 1024 * 3 })

    // Upload first chunk
    const chunk1 = Buffer.alloc(1024, 'a')
    const updated1 = tus.patchUpload(upload.uploadId, {
      uploadOffset: 0,
      contentLength: 1024,
      contentType: 'application/offset+octet-stream',
      chunk: chunk1,
    })

    expect(updated1.uploadOffset).toBe(1024)
    expect(updated1.status).toBe('uploading')

    // Upload second chunk
    const chunk2 = Buffer.alloc(1024, 'b')
    const updated2 = tus.patchUpload(upload.uploadId, {
      uploadOffset: 1024,
      contentLength: 1024,
      contentType: 'application/offset+octet-stream',
      chunk: chunk2,
    })

    expect(updated2.uploadOffset).toBe(2048)

    // Upload final chunk
    const chunk3 = Buffer.alloc(1024, 'c')
    const updated3 = tus.patchUpload(upload.uploadId, {
      uploadOffset: 2048,
      contentLength: 1024,
      contentType: 'application/offset+octet-stream',
      chunk: chunk3,
    })

    expect(updated3.uploadOffset).toBe(3072)
    // Status could be 'finalizing' or 'completed' depending on processing speed
    expect(['finalizing', 'completed']).toContain(updated3.status)
  })

  test('rejects offset mismatch', () => {
    const upload = tus.createUpload({ uploadLength: 2048 })

    expect(() => {
      tus.patchUpload(upload.uploadId, {
        uploadOffset: 1024, // Wrong offset - should be 0
        contentLength: 1024,
        contentType: 'application/offset+octet-stream',
        chunk: Buffer.alloc(1024),
      })
    }).toThrow('Offset mismatch')
  })

  test('gets upload progress', () => {
    const upload = tus.createUpload({ uploadLength: 4096 })

    // Upload some chunks
    tus.patchUpload(upload.uploadId, {
      uploadOffset: 0,
      contentLength: 1024,
      contentType: 'application/offset+octet-stream',
      chunk: Buffer.alloc(1024),
    })

    tus.patchUpload(upload.uploadId, {
      uploadOffset: 1024,
      contentLength: 1024,
      contentType: 'application/offset+octet-stream',
      chunk: Buffer.alloc(1024),
    })

    const progress = tus.getUploadProgress(upload.uploadId)

    expect(progress.percent).toBe(50)
    expect(progress.uploadedBytes).toBe(2048)
    expect(progress.totalBytes).toBe(4096)
    expect(progress.chunksUploaded).toBe(2)
  })

  test('terminates upload', () => {
    const upload = tus.createUpload({ uploadLength: 1024 })

    const terminated = tus.terminateUpload(upload.uploadId)
    expect(terminated).toBe(true)

    const notFound = tus.getUpload(upload.uploadId)
    expect(notFound).toBeUndefined()
  })

  test('gets chunk upload URLs', () => {
    const upload = tus.createUpload({ uploadLength: 5 * 1024 * 1024 }) // 5MB

    const chunkUrls = tus.getChunkUploadUrls(upload.uploadId)

    expect(chunkUrls.length).toBe(5) // 5 chunks of 1MB each
    expect(chunkUrls[0].offset).toBe(0)
    expect(chunkUrls[0].size).toBe(1024 * 1024)
    expect(chunkUrls[4].offset).toBe(4 * 1024 * 1024)
  })

  test('TUS handlers return correct headers', () => {
    const optionsResult = handleTusOptions()
    expect(optionsResult.status).toBe(204)
    expect(optionsResult.headers['Tus-Resumable']).toBe('1.0.0')
    expect(optionsResult.headers['Tus-Extension']).toContain('creation')

    const postResult = handleTusPost({ uploadLength: 1024 })
    expect(postResult.status).toBe(201)
    expect(postResult.headers.Location).toBeDefined()
    expect(postResult.upload.uploadId).toBeDefined()

    const headResult = handleTusHead(postResult.upload.uploadId)
    expect(headResult.status).toBe(200)
    expect(headResult.headers['Upload-Offset']).toBe('0')
    expect(headResult.headers['Upload-Length']).toBe('1024')

    const deleteResult = handleTusDelete(postResult.upload.uploadId)
    expect(deleteResult.status).toBe(204)
  })

  test('gets active uploads', () => {
    tus.createUpload({ uploadLength: 1024 })
    tus.createUpload({ uploadLength: 2048 })

    const active = tus.getActiveUploads()
    expect(active.length).toBeGreaterThanOrEqual(2)
    expect(
      active.every((u) => u.status === 'created' || u.status === 'uploading'),
    ).toBe(true)
  })
})

// ============ Storage Analytics Tests ============

describe('StorageAnalyticsManager', () => {
  let analytics: StorageAnalyticsManager

  beforeEach(() => {
    analytics = new StorageAnalyticsManager({
      retentionDays: 7,
      aggregationIntervalMs: 1000,
      enableRealTime: false,
      enablePersistence: false,
      maxEventsInMemory: 1000,
    })
  })

  test('records upload event', () => {
    analytics.recordUpload(
      'upload-cid-1',
      1024 * 1024,
      'ipfs',
      'us-east-1',
      45,
      '0x1234567890123456789012345678901234567890',
    )

    const stats = analytics.getAnalytics()
    expect(stats.global.totalUploads24h).toBeGreaterThanOrEqual(1)
  })

  test('records download event', () => {
    analytics.recordDownload(
      'download-cid-1',
      512 * 1024,
      'ipfs',
      'eu-west-1',
      35,
    )

    const stats = analytics.getAnalytics()
    expect(stats.global.totalDownloads24h).toBeGreaterThanOrEqual(1)
  })

  test('records error event', () => {
    analytics.recordError(
      'error-cid',
      'ipfs',
      'us-east-1',
      'NOT_FOUND',
      'Content not found',
    )

    const stats = analytics.getAnalytics()
    expect(stats.global.errorRate).toBeGreaterThan(0)
  })

  test('calculates performance metrics', () => {
    // Record events with varying latencies
    for (let i = 0; i < 100; i++) {
      analytics.recordDownload(
        `perf-cid-${i}`,
        1024,
        'ipfs',
        'us-east-1',
        10 + i, // 10-109ms latency
      )
    }

    const stats = analytics.getAnalytics()

    expect(stats.performance.p50LatencyMs).toBeGreaterThan(0)
    expect(stats.performance.p95LatencyMs).toBeGreaterThan(
      stats.performance.p50LatencyMs,
    )
    expect(stats.performance.p99LatencyMs).toBeGreaterThanOrEqual(
      stats.performance.p95LatencyMs,
    )
  })

  test('tracks user analytics', () => {
    const userAddress = '0xabcdef1234567890abcdef1234567890abcdef12'

    analytics.recordUpload(
      'user-upload-1',
      1024,
      'ipfs',
      'us-east-1',
      30,
      userAddress,
    )
    analytics.recordUpload(
      'user-upload-2',
      2048,
      'ipfs',
      'us-east-1',
      40,
      userAddress,
    )
    analytics.recordDownload(
      'user-download-1',
      512,
      'ipfs',
      'us-east-1',
      20,
      userAddress,
    )

    const userStats = analytics.getUserAnalytics(userAddress)

    expect(userStats).toBeDefined()
    expect(userStats?.totalUploads).toBe(2)
    expect(userStats?.totalDownloads).toBe(1)
    expect(userStats?.storageUsed).toBe(3072)
  })

  test('gets top content', () => {
    // Record multiple accesses to different content
    for (let i = 0; i < 10; i++) {
      analytics.recordDownload(
        `popular-cid-${i % 3}`,
        1024,
        'ipfs',
        'us-east-1',
        30,
      )
    }

    const topContent = analytics.getTopContent(5)

    expect(topContent.length).toBeLessThanOrEqual(5)
    expect(topContent.length).toBeGreaterThan(0)
    expect(topContent[0].requests24h).toBeGreaterThanOrEqual(
      topContent[topContent.length - 1].requests24h,
    )
  })

  test('gets time series data', () => {
    // Record events
    analytics.recordUpload('ts-cid-1', 1024, 'ipfs', 'us-east-1', 30)
    analytics.recordDownload('ts-cid-2', 2048, 'ipfs', 'us-east-1', 40)

    const bandwidth = analytics.getTimeSeries('bandwidth', 24)
    const requests = analytics.getTimeSeries('requests', 24)

    expect(bandwidth.length).toBe(24)
    expect(requests.length).toBe(24)
    expect(bandwidth.every((p) => p.timestamp > 0)).toBe(true)
  })

  test('gets backend metrics', () => {
    analytics.recordUpload('backend-cid-1', 1024, 'ipfs', 'us-east-1', 30)
    analytics.recordUpload('backend-cid-2', 2048, 'arweave', 'us-east-1', 80)
    analytics.recordDownload('backend-cid-3', 512, 'ipfs', 'us-east-1', 25)

    const stats = analytics.getAnalytics()

    expect(stats.backends.length).toBeGreaterThan(0)

    const ipfsBackend = stats.backends.find((b) => b.backend === 'ipfs')
    expect(ipfsBackend).toBeDefined()
    expect(ipfsBackend?.requests24h).toBeGreaterThan(0)
  })

  test('gets regional metrics', () => {
    analytics.recordUpload('region-cid-1', 1024, 'ipfs', 'us-east-1', 30)
    analytics.recordUpload('region-cid-2', 2048, 'ipfs', 'eu-west-1', 50)
    analytics.recordDownload('region-cid-3', 512, 'ipfs', 'us-east-1', 25)
    analytics.recordDownload('region-cid-4', 1024, 'ipfs', 'ap-northeast-1', 80)

    const stats = analytics.getAnalytics()

    expect(stats.regions.length).toBeGreaterThan(0)

    const usEast = stats.regions.find((r) => r.region === 'us-east-1')
    expect(usEast).toBeDefined()
    expect(usEast?.requests24h).toBeGreaterThan(0)
  })

  test('gets top users', () => {
    const users = [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
    ]

    // Record activity for each user
    for (let i = 0; i < users.length; i++) {
      for (let j = 0; j < (i + 1) * 2; j++) {
        analytics.recordDownload(
          `user-${i}-cid-${j}`,
          1024 * (i + 1),
          'ipfs',
          'us-east-1',
          30,
          users[i],
        )
      }
    }

    const topUsers = analytics.getTopUsers(10)

    expect(topUsers.length).toBe(3)
    expect(topUsers[0].bandwidth24h).toBeGreaterThanOrEqual(
      topUsers[1].bandwidth24h,
    )
    expect(topUsers[1].bandwidth24h).toBeGreaterThanOrEqual(
      topUsers[2].bandwidth24h,
    )
  })
})
