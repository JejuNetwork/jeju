import { describe, expect, it } from 'bun:test'
import {
  ContributorProfileSchema,
  SocialLinkSchema,
  RepoClaimSchema,
  DependencyClaimSchema,
  DAOContributionSchema,
  PaymentCategorySchema,
  PaymentRequestSchema,
  PaymentStatusSchema,
  CouncilVoteSchema,
  CEODecisionSchema,
  DAOPaymentConfigSchema,
  FeeDistributionConfigSchema,
  DAOPoolSchema,
  ContributorShareSchema,
  DependencyShareSchema,
  FundingEpochSchema,
  WeightVoteSchema,
} from '../funding'

describe('Funding Types', () => {
  describe('SocialLinkSchema', () => {
    it('validates social link structure', () => {
      const validLink = {
        platform: 'github',
        url: 'https://github.com/user',
        verified: true,
      }
      expect(SocialLinkSchema.parse(validLink)).toEqual(validLink)
    })

    it('validates all platform types', () => {
      const platforms = ['github', 'twitter', 'discord', 'telegram', 'website', 'email']
      for (const platform of platforms) {
        expect(() =>
          SocialLinkSchema.parse({ platform, url: 'https://example.com', verified: false })
        ).not.toThrow()
      }
    })
  })

  describe('ContributorProfileSchema', () => {
    it('validates complete contributor profile', () => {
      const profile = {
        address: '0x1234567890123456789012345678901234567890',
        displayName: 'Test Contributor',
        bio: 'A test contributor',
        socialLinks: [
          { platform: 'github', url: 'https://github.com/test', verified: true },
        ],
        skills: ['typescript', 'solidity'],
        registeredAt: Date.now(),
        totalEarnings: '1000000000000000000',
        activeProposals: 2,
        completedProposals: 5,
      }
      expect(() => ContributorProfileSchema.parse(profile)).not.toThrow()
    })
  })

  describe('RepoClaimSchema', () => {
    it('validates repository claim', () => {
      const claim = {
        id: 'claim-123',
        contributor: '0x1234567890123456789012345678901234567890',
        repoUrl: 'https://github.com/org/repo',
        repoOwner: 'org',
        repoName: 'repo',
        claimType: 'maintainer',
        verified: true,
        verifiedAt: Date.now(),
        proofUrl: 'https://github.com/org/repo/proof.txt',
      }
      expect(() => RepoClaimSchema.parse(claim)).not.toThrow()
    })

    it('validates all claim types', () => {
      const claimTypes = ['maintainer', 'contributor', 'owner']
      for (const claimType of claimTypes) {
        expect(() =>
          RepoClaimSchema.parse({
            id: 'claim-123',
            contributor: '0x1234567890123456789012345678901234567890',
            repoUrl: 'https://github.com/org/repo',
            repoOwner: 'org',
            repoName: 'repo',
            claimType,
            verified: false,
          })
        ).not.toThrow()
      }
    })
  })

  describe('DependencyClaimSchema', () => {
    it('validates dependency claim', () => {
      const claim = {
        id: 'dep-123',
        contributor: '0x1234567890123456789012345678901234567890',
        packageName: 'lodash',
        packageManager: 'npm',
        dependentCount: 10000,
        weeklyDownloads: 5000000,
        verified: true,
        sharePercentage: 0.05,
      }
      expect(() => DependencyClaimSchema.parse(claim)).not.toThrow()
    })

    it('validates all package managers', () => {
      const managers = ['npm', 'cargo', 'pip', 'go', 'maven']
      for (const packageManager of managers) {
        expect(() =>
          DependencyClaimSchema.parse({
            id: 'dep-123',
            contributor: '0x1234567890123456789012345678901234567890',
            packageName: 'test-pkg',
            packageManager,
            dependentCount: 100,
            weeklyDownloads: 1000,
            verified: false,
          })
        ).not.toThrow()
      }
    })
  })

  describe('DAOContributionSchema', () => {
    it('validates DAO contribution', () => {
      const contribution = {
        id: 'contrib-123',
        contributor: '0x1234567890123456789012345678901234567890',
        category: 'development',
        title: 'Implement feature X',
        description: 'A detailed description of the contribution',
        evidenceUrls: ['https://github.com/org/repo/pr/123'],
        requestedAmount: '5000000000000000000',
        approvedAmount: '4000000000000000000',
        status: 'approved',
        submittedAt: Date.now(),
        reviewedAt: Date.now(),
        reviewerComments: 'Good work',
      }
      expect(() => DAOContributionSchema.parse(contribution)).not.toThrow()
    })
  })

  describe('PaymentCategorySchema', () => {
    it('validates all payment categories', () => {
      const categories = ['development', 'security', 'documentation', 'community', 'marketing', 'infrastructure', 'research', 'other']
      for (const category of categories) {
        expect(PaymentCategorySchema.parse(category)).toBe(category)
      }
    })
  })

  describe('PaymentStatusSchema', () => {
    it('validates all payment statuses', () => {
      const statuses = ['pending', 'under_review', 'approved', 'rejected', 'paid', 'cancelled']
      for (const status of statuses) {
        expect(PaymentStatusSchema.parse(status)).toBe(status)
      }
    })
  })

  describe('PaymentRequestSchema', () => {
    it('validates payment request', () => {
      const request = {
        id: 'payment-123',
        requestor: '0x1234567890123456789012345678901234567890',
        category: 'development',
        amount: '10000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        reason: 'Development work for Q1',
        status: 'pending',
        createdAt: Date.now(),
      }
      expect(() => PaymentRequestSchema.parse(request)).not.toThrow()
    })
  })

  describe('CouncilVoteSchema', () => {
    it('validates council vote', () => {
      const vote = {
        voter: '0x1234567890123456789012345678901234567890',
        requestId: 'payment-123',
        approve: true,
        weight: 100,
        comment: 'LGTM',
        votedAt: Date.now(),
      }
      expect(() => CouncilVoteSchema.parse(vote)).not.toThrow()
    })
  })

  describe('CEODecisionSchema', () => {
    it('validates CEO decision', () => {
      const decision = {
        requestId: 'payment-123',
        approved: true,
        reason: 'Approved for community benefit',
        decidedAt: Date.now(),
        txHash: '0xabcd',
      }
      expect(() => CEODecisionSchema.parse(decision)).not.toThrow()
    })
  })

  describe('DAOPaymentConfigSchema', () => {
    it('validates DAO payment configuration', () => {
      const config = {
        councilThreshold: 3,
        votingPeriod: 86400,
        ceoVetoEnabled: true,
        ceoVetoPeriod: 43200,
        maxPaymentWithoutVote: '1000000000000000000',
        paymentToken: '0x0000000000000000000000000000000000000000',
      }
      expect(() => DAOPaymentConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('FeeDistributionConfigSchema', () => {
    it('validates fee distribution configuration', () => {
      const config = {
        contributorSharePercent: 60,
        dependencySharePercent: 30,
        treasurySharePercent: 10,
        minimumPayout: '100000000000000000',
        payoutFrequency: 604800,
      }
      expect(() => FeeDistributionConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('DAOPoolSchema', () => {
    it('validates DAO pool', () => {
      const pool = {
        id: 'pool-1',
        name: 'Main Treasury',
        balance: '100000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        createdAt: Date.now(),
        lastDistribution: Date.now(),
      }
      expect(() => DAOPoolSchema.parse(pool)).not.toThrow()
    })
  })

  describe('ContributorShareSchema', () => {
    it('validates contributor share', () => {
      const share = {
        contributor: '0x1234567890123456789012345678901234567890',
        poolId: 'pool-1',
        sharePercentage: 5.5,
        earnedTotal: '10000000000000000000',
        pendingPayout: '1000000000000000000',
        lastPayout: Date.now(),
      }
      expect(() => ContributorShareSchema.parse(share)).not.toThrow()
    })
  })

  describe('DependencyShareSchema', () => {
    it('validates dependency share', () => {
      const share = {
        packageName: 'lodash',
        packageManager: 'npm',
        maintainer: '0x1234567890123456789012345678901234567890',
        dependentProjects: 15000,
        sharePercentage: 2.5,
        earnedTotal: '5000000000000000000',
        lastUpdated: Date.now(),
      }
      expect(() => DependencyShareSchema.parse(share)).not.toThrow()
    })
  })

  describe('FundingEpochSchema', () => {
    it('validates funding epoch', () => {
      const epoch = {
        id: 1,
        startTime: Date.now() - 86400000,
        endTime: Date.now(),
        totalFees: '1000000000000000000000',
        contributorPayout: '600000000000000000000',
        dependencyPayout: '300000000000000000000',
        treasuryPayout: '100000000000000000000',
        finalized: true,
      }
      expect(() => FundingEpochSchema.parse(epoch)).not.toThrow()
    })
  })

  describe('WeightVoteSchema', () => {
    it('validates weight vote', () => {
      const vote = {
        voter: '0x1234567890123456789012345678901234567890',
        epoch: 1,
        contributorWeights: {
          '0x2345678901234567890123456789012345678901': 50,
          '0x3456789012345678901234567890123456789012': 30,
        },
        dependencyWeights: {
          lodash: 20,
        },
        votedAt: Date.now(),
      }
      expect(() => WeightVoteSchema.parse(vote)).not.toThrow()
    })
  })
})

