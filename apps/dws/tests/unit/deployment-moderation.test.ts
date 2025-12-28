/**
 * Tests for Deployment Moderation Service
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Address } from 'viem'

// Mock EQLite before importing
const mockQuery = mock(() => Promise.resolve({ rows: [] }))
const mockExec = mock(() => Promise.resolve())

mock.module('@jejunetwork/db', () => ({
  getEQLite: () => ({
    query: mockQuery,
    exec: mockExec,
  }),
}))

// Mock fetch for AI API calls
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        choices: [
          {
            message: {
              content: JSON.stringify({ safe: true, confidence: 0.95 }),
            },
          },
        ],
      }),
  }),
)

globalThis.fetch = mockFetch as typeof fetch

// Import after mocking
const { DeploymentModerationService } = await import(
  '../../api/containers/deployment-moderation'
)

describe('Deployment Moderation Service', () => {
  let service: DeploymentModerationService
  const testAddress = '0x1234567890123456789012345678901234567890' as Address

  beforeEach(() => {
    service = new DeploymentModerationService()
    mockQuery.mockClear()
    mockExec.mockClear()
    mockFetch.mockClear()
  })

  describe('scanDeployment', () => {
    test('scans and approves clean deployment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    safe: true,
                    confidence: 0.98,
                    categories: [],
                    explanation: 'Content appears safe',
                  }),
                },
              },
            ],
          }),
      } as Response)

      const result = await service.scanDeployment({
        deploymentId: 'dep-123',
        userAddress: testAddress,
        contentType: 'container',
        files: [
          {
            path: 'Dockerfile',
            content: 'FROM node:18\nCOPY . .\nRUN npm install',
          },
          { path: 'index.js', content: 'console.log("Hello")' },
        ],
      })

      expect(result.approved).toBe(true)
      expect(result.confidence).toBeGreaterThan(0.9)
    })

    test('rejects deployment with prohibited content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    safe: false,
                    confidence: 0.95,
                    categories: ['malware', 'crypto-mining'],
                    explanation: 'Detected cryptocurrency mining code',
                  }),
                },
              },
            ],
          }),
      } as Response)

      const result = await service.scanDeployment({
        deploymentId: 'dep-124',
        userAddress: testAddress,
        contentType: 'container',
        files: [
          {
            path: 'miner.py',
            content: 'import cryptominer\ncryptominer.start()',
          },
        ],
      })

      expect(result.approved).toBe(false)
      expect(result.categories).toContain('crypto-mining')
    })

    test('flags low confidence results for review', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    safe: true,
                    confidence: 0.65,
                    categories: ['unclear'],
                    explanation: 'Uncertain about some content',
                  }),
                },
              },
            ],
          }),
      } as Response)

      const result = await service.scanDeployment({
        deploymentId: 'dep-125',
        userAddress: testAddress,
        contentType: 'worker',
        files: [{ path: 'script.js', content: 'complex obfuscated code...' }],
      })

      expect(result.approved).toBe(false)
      expect(result.requiresManualReview).toBe(true)
    })
  })

  describe('scanImage', () => {
    test('scans container image', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    safe: true,
                    confidence: 0.92,
                    vulnerabilities: [],
                    malwareDetected: false,
                  }),
                },
              },
            ],
          }),
      } as Response)

      const result = await service.scanImage({
        imageId: 'sha256:abc123',
        registry: 'docker.io',
        repository: 'library/node',
        tag: '18-alpine',
      })

      expect(result.safe).toBe(true)
      expect(result.vulnerabilities).toHaveLength(0)
    })

    test('detects vulnerabilities in image', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    safe: false,
                    confidence: 0.88,
                    vulnerabilities: [
                      {
                        id: 'CVE-2024-1234',
                        severity: 'high',
                        package: 'openssl',
                      },
                    ],
                    malwareDetected: false,
                  }),
                },
              },
            ],
          }),
      } as Response)

      const result = await service.scanImage({
        imageId: 'sha256:def456',
        registry: 'docker.io',
        repository: 'custom/app',
        tag: 'latest',
      })

      expect(result.safe).toBe(false)
      expect(result.vulnerabilities).toHaveLength(1)
      expect(result.vulnerabilities[0].severity).toBe('high')
    })
  })

  describe('checkContentPolicy', () => {
    test('allows permitted content', () => {
      const result = service.checkContentPolicy({
        contentType: 'text/html',
        features: ['fetch', 'websockets'],
        trustLevel: 'basic',
      })

      expect(result.allowed).toBe(true)
    })

    test('blocks restricted features for new users', () => {
      const result = service.checkContentPolicy({
        contentType: 'application/octet-stream',
        features: ['outbound-http', 'crypto-mining'],
        trustLevel: 'new',
      })

      expect(result.allowed).toBe(false)
      expect(result.blockedFeatures).toContain('crypto-mining')
    })

    test('allows more features for trusted users', () => {
      const result = service.checkContentPolicy({
        contentType: 'application/octet-stream',
        features: ['outbound-http', 'websockets', 'raw-sockets'],
        trustLevel: 'trusted',
      })

      expect(result.allowed).toBe(true)
    })
  })

  describe('getModerationHistory', () => {
    test('returns moderation history for deployment', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'mod-1',
            deployment_id: 'dep-123',
            action: 'approved',
            confidence: 0.95,
            categories: null,
            created_at: Date.now() - 3600000,
          },
          {
            id: 'mod-2',
            deployment_id: 'dep-123',
            action: 'rescan',
            confidence: 0.98,
            categories: null,
            created_at: Date.now(),
          },
        ],
      })

      const history = await service.getModerationHistory('dep-123')

      expect(history).toHaveLength(2)
      expect(history[0].action).toBe('approved')
    })
  })

  describe('requestManualReview', () => {
    test('submits deployment for manual review', async () => {
      const result = await service.requestManualReview({
        deploymentId: 'dep-126',
        reason: 'AI scan inconclusive',
        priority: 'normal',
      })

      expect(result.reviewId).toBeDefined()
      expect(result.status).toBe('pending')
      expect(mockExec).toHaveBeenCalled()
    })
  })

  describe('submitReviewDecision', () => {
    test('approves deployment after manual review', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'rev-1',
            deployment_id: 'dep-126',
            status: 'pending',
          },
        ],
      })

      await service.submitReviewDecision({
        reviewId: 'rev-1',
        decision: 'approve',
        reviewer: '0x9999999999999999999999999999999999999999' as Address,
        notes: 'Content verified as safe',
      })

      expect(mockExec).toHaveBeenCalled()
    })

    test('rejects deployment after manual review', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'rev-2',
            deployment_id: 'dep-127',
            status: 'pending',
          },
        ],
      })

      await service.submitReviewDecision({
        reviewId: 'rev-2',
        decision: 'reject',
        reviewer: '0x9999999999999999999999999999999999999999' as Address,
        notes: 'Violates terms of service',
        violationType: 'tos',
        violationSeverity: 'medium',
      })

      expect(mockExec).toHaveBeenCalled()
    })
  })

  describe('getQueuedReviews', () => {
    test('returns pending reviews', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'rev-1',
            deployment_id: 'dep-126',
            reason: 'AI scan inconclusive',
            priority: 'normal',
            status: 'pending',
            created_at: Date.now() - 3600000,
          },
          {
            id: 'rev-2',
            deployment_id: 'dep-127',
            reason: 'Suspicious patterns',
            priority: 'high',
            status: 'pending',
            created_at: Date.now() - 1800000,
          },
        ],
      })

      const reviews = await service.getQueuedReviews()

      expect(reviews).toHaveLength(2)
      // High priority should be first
      expect(reviews[0].priority).toBe('high')
    })
  })

  describe('applyAutoBan', () => {
    test('auto-bans for high-confidence violations', async () => {
      const result = await service.applyAutoBan({
        userAddress: testAddress,
        deploymentId: 'dep-128',
        violationType: 'malware',
        confidence: 0.99,
        evidence: 'Detected known malware signature',
      })

      expect(result.banned).toBe(true)
      expect(result.duration).toBeGreaterThan(0)
      expect(mockExec).toHaveBeenCalled()
    })

    test('does not auto-ban for low confidence', async () => {
      const result = await service.applyAutoBan({
        userAddress: testAddress,
        deploymentId: 'dep-129',
        violationType: 'spam',
        confidence: 0.7,
        evidence: 'Possible spam content',
      })

      expect(result.banned).toBe(false)
      expect(result.requiresManualReview).toBe(true)
    })
  })
})
