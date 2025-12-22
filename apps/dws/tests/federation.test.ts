/**
 * Federation (ActivityPub) Tests
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import type { Address, Hex } from 'viem'
import { FederationManager } from '../src/git/federation'
import { SocialManager } from '../src/git/social'
import type { GitUser, Repository } from '../src/git/types'

// Mock backend
const mockBackend = {
  upload: async (content: Buffer) => ({
    cid: `mock-cid-${Date.now()}`,
    size: content.length,
  }),
  download: async (_cid: string) => ({ content: Buffer.from('{}'), size: 2 }),
}

// Mock repo manager
const mockRepoManager = {
  getRepository: async (_repoId: Hex) => null,
  getRepositoryByName: async (_owner: Address, _name: string) => null,
  getUserRepositories: async (_address: Address) => [],
  createRepository: async () => ({ repoId: '0x1234' as Hex, name: 'test' }),
  getBranches: async () => [],
  getBranch: async () => null,
  getObjectStore: () => ({
    walkCommits: async () => [],
    getTree: async () => null,
    getCommit: async () => null,
  }),
}

describe('Federation', () => {
  let federation: FederationManager
  let socialManager: SocialManager

  beforeEach(() => {
    socialManager = new SocialManager({
      backend: mockBackend as never,
      repoManager: mockRepoManager as never,
    })

    federation = new FederationManager({
      instanceUrl: 'https://git.jejunetwork.org',
      instanceName: 'Jeju Git',
      instanceDescription: 'Decentralized Git hosting',
      repoManager: mockRepoManager as never,
      socialManager,
    })
  })

  describe('NodeInfo', () => {
    it('should return valid NodeInfo', () => {
      const nodeInfo = federation.getNodeInfo()

      expect(nodeInfo.version).toBe('2.1')
      expect(nodeInfo.software.name).toBe('jeju-git')
      expect(nodeInfo.protocols).toContain('activitypub')
      expect(nodeInfo.metadata.nodeName).toBe('Jeju Git')
    })

    it('should return NodeInfo links', () => {
      const links = federation.getNodeInfoLinks()

      expect(links.links).toHaveLength(1)
      expect(links.links[0].rel).toContain('nodeinfo')
    })
  })

  describe('WebFinger', () => {
    it('should resolve acct: format', () => {
      const result = federation.getWebFinger(
        'acct:testuser@git.jejunetwork.org',
      )

      expect(result).not.toBeNull()
      expect(result?.subject).toBe('acct:testuser@git.jejunetwork.org')
      expect(result?.links?.length).toBeGreaterThan(0)
    })

    it('should resolve user URL format', () => {
      const result = federation.getWebFinger(
        'https://git.jejunetwork.org/users/testuser',
      )

      expect(result).not.toBeNull()
      expect(result?.subject).toContain('testuser')
    })

    it('should return null for invalid resources', () => {
      const result = federation.getWebFinger('acct:user@other.domain')
      expect(result).toBeNull()
    })
  })

  describe('Actor Generation', () => {
    it('should generate user actor', async () => {
      const user: GitUser = {
        address: '0x1234567890123456789012345678901234567890' as Address,
        username: 'testuser',
        repositories: [],
        starredRepos: [],
        balance: 0n,
        stakedAmount: 0n,
        tier: 'free',
        reputationScore: 0,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      }

      const actor = federation.getUserActor(user)

      expect(actor.type).toBe('Person')
      expect(actor.preferredUsername).toBe('testuser')
      expect(actor.inbox).toContain('/inbox')
      expect(actor.outbox).toContain('/outbox')
      expect(actor.publicKey).toBeDefined()
    })

    it('should generate repo actor', () => {
      const repo: Repository = {
        repoId: '0x1234' as Hex,
        owner: '0x1234567890123456789012345678901234567890' as Address,
        agentId: 0n,
        name: 'test-repo',
        description: 'A test repository',
        jnsNode: '0x0' as Hex,
        headCommitCid: '0x0' as Hex,
        metadataCid: '0x0' as Hex,
        createdAt: 0n,
        updatedAt: 0n,
        visibility: 0,
        archived: false,
        starCount: 0n,
        forkCount: 0n,
        forkedFrom: '0x0' as Hex,
      }

      const actor = federation.getRepoActor(repo, 'testuser')

      expect(actor.type).toBe('Application')
      expect(actor.name).toBe('test-repo')
      expect(actor.summary).toBe('A test repository')
    })
  })

  describe('Activity Creation', () => {
    const mockRepo: Repository = {
      repoId: '0x1234' as Hex,
      owner: '0x1234567890123456789012345678901234567890' as Address,
      agentId: 0n,
      name: 'test-repo',
      description: 'Test',
      jnsNode: '0x0' as Hex,
      headCommitCid: '0x0' as Hex,
      metadataCid: '0x0' as Hex,
      createdAt: 0n,
      updatedAt: 0n,
      visibility: 0,
      archived: false,
      starCount: 0n,
      forkCount: 0n,
      forkedFrom: '0x0' as Hex,
    }

    it('should create Push activity', () => {
      const activity = federation.createPushActivity(
        mockRepo,
        'testuser',
        'main',
        ['abc123'],
        '0x1234' as Address,
      )

      expect(activity.type).toBe('Push')
      expect(activity.actor).toContain('/users/')
      expect((activity.object as { name: string }).name).toBe('main')
    })

    it('should create Star activity (Like)', () => {
      const activity = federation.createStarActivity(
        mockRepo,
        'testuser',
        '0x1234' as Address,
      )

      expect(activity.type).toBe('Like')
      expect(activity.actor).toContain('/users/')
    })

    it('should create Fork activity', () => {
      const forkedRepo = { ...mockRepo, repoId: '0x5678' as Hex }
      const activity = federation.createForkActivity(
        mockRepo,
        forkedRepo,
        'testuser',
        '0x5678' as Address,
      )

      expect(activity.type).toBe('Fork')
    })

    it('should create Follow activity', () => {
      const activity = federation.createFollowActivity(
        'https://git.jejunetwork.org/users/alice',
        'https://git.jejunetwork.org/users/bob',
      )

      expect(activity.type).toBe('Follow')
      expect(activity.actor).toContain('alice')
      expect(activity.object).toContain('bob')
    })
  })

  describe('Inbox Handling', () => {
    it('should accept Follow activity', async () => {
      const followActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://other.instance/activities/123',
        type: 'Follow' as const,
        actor: 'https://other.instance/users/alice',
        object: 'https://git.jejunetwork.org/users/testuser',
      }

      const result = await federation.handleInboxActivity(
        'https://git.jejunetwork.org/users/testuser',
        followActivity,
      )

      expect(result.accepted).toBe(true)
      expect(result.response?.type).toBe('Accept')
    })

    it('should accept Like activity', async () => {
      const likeActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://other.instance/activities/456',
        type: 'Like' as const,
        actor: 'https://other.instance/users/bob',
        object: 'https://git.jejunetwork.org/repos/testuser/test-repo',
      }

      const result = await federation.handleInboxActivity(
        'https://git.jejunetwork.org/repos/testuser/test-repo',
        likeActivity,
      )

      expect(result.accepted).toBe(true)
    })
  })

  describe('Outbox', () => {
    it('should return empty outbox for new actor', () => {
      const outbox = federation.getOutboxActivities(
        'https://git.jejunetwork.org/users/testuser',
      )

      expect(outbox.type).toBe('OrderedCollection')
      expect(outbox.totalItems).toBe(0)
      expect(outbox.orderedItems).toHaveLength(0)
    })
  })

  describe('Stats', () => {
    it('should return initial stats', () => {
      const stats = federation.getStats()

      expect(stats.followers).toBe(0)
      expect(stats.following).toBe(0)
      expect(stats.activities).toBe(0)
    })
  })
})
