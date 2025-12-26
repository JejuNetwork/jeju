import { describe, expect, it } from 'bun:test'
import {
  ProposalTypeSchema,
  ProposalStatusSchema,
  CouncilRoleSchema,
  VoteTypeSchema,
  VetoCategorySchema,
  AgentReputationSchema,
  ProviderReputationSchema,
  VotingPowerSchema,
  ProposalEligibilitySchema,
  ProposalSchema,
  CouncilVoteSchema,
  BackerInfoSchema,
  VetoVoteSchema,
  DelegationSchema,
  SecurityCouncilMemberSchema,
  ModerationFlagSchema,
  ModerationViolationSchema,
  CouncilHealthSchema,
  GovernanceStatsSchema,
  QualityAssessmentSchema,
  GovernanceEventTypeSchema,
} from '../governance'

describe('Governance Types', () => {
  describe('ProposalTypeSchema', () => {
    it('validates all proposal types', () => {
      const types = [
        'AgentOnboarding',
        'AgentOffboarding',
        'ProviderOnboarding',
        'ProviderOffboarding',
        'ParameterChange',
        'ProtocolUpgrade',
        'TreasurySpend',
        'EmergencyAction',
        'SlashAgent',
        'SlashProvider',
      ]
      for (const type of types) {
        expect(ProposalTypeSchema.parse(type)).toBe(type)
      }
    })
  })

  describe('ProposalStatusSchema', () => {
    it('validates all proposal statuses', () => {
      const statuses = [
        'Draft',
        'Pending',
        'Active',
        'Succeeded',
        'Defeated',
        'Queued',
        'Executed',
        'Cancelled',
        'Vetoed',
        'Expired',
      ]
      for (const status of statuses) {
        expect(ProposalStatusSchema.parse(status)).toBe(status)
      }
    })
  })

  describe('CouncilRoleSchema', () => {
    it('validates all council roles', () => {
      const roles = ['Technical', 'Economic', 'Community', 'Security', 'Observer']
      for (const role of roles) {
        expect(CouncilRoleSchema.parse(role)).toBe(role)
      }
    })
  })

  describe('VoteTypeSchema', () => {
    it('validates all vote types', () => {
      const types = ['For', 'Against', 'Abstain']
      for (const type of types) {
        expect(VoteTypeSchema.parse(type)).toBe(type)
      }
    })
  })

  describe('VetoCategorySchema', () => {
    it('validates all veto categories', () => {
      const categories = [
        'SecurityRisk',
        'LegalConcern',
        'TechnicalFlaw',
        'EconomicHarm',
        'CommunityHarm',
      ]
      for (const category of categories) {
        expect(VetoCategorySchema.parse(category)).toBe(category)
      }
    })
  })

  describe('AgentReputationSchema', () => {
    it('validates agent reputation', () => {
      const reputation = {
        agentId: 12345n,
        score: 850,
        totalInteractions: 10000,
        successfulInteractions: 9800,
        failedInteractions: 200,
        totalValueHandled: '1000000000000000000000',
        slashEvents: 0,
        lastUpdated: Date.now(),
      }
      expect(() => AgentReputationSchema.parse(reputation)).not.toThrow()
    })
  })

  describe('ProviderReputationSchema', () => {
    it('validates provider reputation', () => {
      const reputation = {
        provider: '0x1234567890123456789012345678901234567890',
        score: 920,
        totalJobs: 5000,
        successfulJobs: 4950,
        failedJobs: 50,
        totalValueEarned: '500000000000000000000',
        slashEvents: 1,
        uptimePercent: 99.9,
        lastUpdated: Date.now(),
      }
      expect(() => ProviderReputationSchema.parse(reputation)).not.toThrow()
    })
  })

  describe('VotingPowerSchema', () => {
    it('validates voting power', () => {
      const power = {
        voter: '0x1234567890123456789012345678901234567890',
        baseVotingPower: '10000000000000000000000',
        delegatedVotingPower: '5000000000000000000000',
        totalVotingPower: '15000000000000000000000',
        delegatesFrom: [
          '0x2345678901234567890123456789012345678901',
          '0x3456789012345678901234567890123456789012',
        ],
        delegatesTo: undefined,
        lockExpiry: Date.now() + 86400000,
      }
      expect(() => VotingPowerSchema.parse(power)).not.toThrow()
    })
  })

  describe('ProposalEligibilitySchema', () => {
    it('validates proposal eligibility', () => {
      const eligibility = {
        canPropose: true,
        reason: 'Meets all requirements',
        requiredVotingPower: '1000000000000000000000',
        currentVotingPower: '2000000000000000000000',
        cooldownRemaining: 0,
      }
      expect(() => ProposalEligibilitySchema.parse(eligibility)).not.toThrow()
    })

    it('validates ineligible case', () => {
      const eligibility = {
        canPropose: false,
        reason: 'Insufficient voting power',
        requiredVotingPower: '1000000000000000000000',
        currentVotingPower: '500000000000000000000',
      }
      expect(() => ProposalEligibilitySchema.parse(eligibility)).not.toThrow()
    })
  })

  describe('ProposalSchema', () => {
    it('validates complete proposal', () => {
      const proposal = {
        proposalId: 1n,
        proposer: '0x1234567890123456789012345678901234567890',
        type: 'AgentOnboarding',
        title: 'Onboard Agent XYZ',
        description: 'Proposal to onboard a new AI agent',
        targets: ['0x1234567890123456789012345678901234567890'],
        values: ['0'],
        calldatas: ['0x'],
        status: 'Active',
        createdAt: Date.now(),
        startBlock: 1000000n,
        endBlock: 1100000n,
        forVotes: '10000000000000000000000',
        againstVotes: '5000000000000000000000',
        abstainVotes: '1000000000000000000000',
        quorumRequired: '20000000000000000000000',
        councilApprovals: 3,
        councilRejections: 1,
        vetoCount: 0,
      }
      expect(() => ProposalSchema.parse(proposal)).not.toThrow()
    })
  })

  describe('CouncilVoteSchema', () => {
    it('validates council vote', () => {
      const vote = {
        proposalId: 1n,
        councilMember: '0x1234567890123456789012345678901234567890',
        role: 'Technical',
        vote: 'For',
        reason: 'Meets all technical requirements',
        votedAt: Date.now(),
      }
      expect(() => CouncilVoteSchema.parse(vote)).not.toThrow()
    })
  })

  describe('BackerInfoSchema', () => {
    it('validates backer info', () => {
      const backer = {
        address: '0x1234567890123456789012345678901234567890',
        votingPower: '5000000000000000000000',
        voteType: 'For',
        delegatedFrom: [],
        votedAt: Date.now(),
      }
      expect(() => BackerInfoSchema.parse(backer)).not.toThrow()
    })
  })

  describe('VetoVoteSchema', () => {
    it('validates veto vote', () => {
      const veto = {
        proposalId: 1n,
        vetoer: '0x1234567890123456789012345678901234567890',
        category: 'SecurityRisk',
        reason: 'Critical security vulnerability identified',
        vetoedAt: Date.now(),
      }
      expect(() => VetoVoteSchema.parse(veto)).not.toThrow()
    })
  })

  describe('DelegationSchema', () => {
    it('validates delegation', () => {
      const delegation = {
        delegator: '0x1234567890123456789012345678901234567890',
        delegatee: '0x2345678901234567890123456789012345678901',
        amount: '1000000000000000000000',
        delegatedAt: Date.now(),
        expiresAt: Date.now() + 86400000 * 30,
      }
      expect(() => DelegationSchema.parse(delegation)).not.toThrow()
    })
  })

  describe('SecurityCouncilMemberSchema', () => {
    it('validates security council member', () => {
      const member = {
        address: '0x1234567890123456789012345678901234567890',
        role: 'Security',
        name: 'Security Expert',
        addedAt: Date.now(),
        isActive: true,
        votesParticipated: 50,
        proposalsReviewed: 100,
      }
      expect(() => SecurityCouncilMemberSchema.parse(member)).not.toThrow()
    })
  })

  describe('ModerationFlagSchema', () => {
    it('validates moderation flag', () => {
      const flag = {
        targetId: 12345n,
        targetType: 'agent',
        flagger: '0x1234567890123456789012345678901234567890',
        reason: 'Suspicious behavior detected',
        evidence: 'Transaction hash: 0xabc...',
        severity: 'high',
        createdAt: Date.now(),
        status: 'pending',
      }
      expect(() => ModerationFlagSchema.parse(flag)).not.toThrow()
    })
  })

  describe('ModerationViolationSchema', () => {
    it('validates moderation violation', () => {
      const violation = {
        violationId: 1n,
        targetId: 12345n,
        targetType: 'agent',
        violationType: 'TermsOfService',
        description: 'Violated terms by...',
        penalty: 'warning',
        issuedAt: Date.now(),
        issuedBy: '0x1234567890123456789012345678901234567890',
      }
      expect(() => ModerationViolationSchema.parse(violation)).not.toThrow()
    })
  })

  describe('CouncilHealthSchema', () => {
    it('validates council health', () => {
      const health = {
        totalMembers: 9,
        activeMembers: 8,
        quorumMet: true,
        avgResponseTime: 3600,
        participationRate: 95,
        lastActivity: Date.now(),
      }
      expect(() => CouncilHealthSchema.parse(health)).not.toThrow()
    })
  })

  describe('GovernanceStatsSchema', () => {
    it('validates governance stats', () => {
      const stats = {
        totalProposals: 150,
        activeProposals: 5,
        passedProposals: 100,
        failedProposals: 40,
        vetoedProposals: 5,
        totalVoters: 5000,
        totalVotingPower: '1000000000000000000000000',
        avgParticipation: 45,
        avgTimeToPass: 604800,
      }
      expect(() => GovernanceStatsSchema.parse(stats)).not.toThrow()
    })
  })

  describe('QualityAssessmentSchema', () => {
    it('validates quality assessment', () => {
      const assessment = {
        targetId: 12345n,
        targetType: 'agent',
        qualityScore: 85,
        safetyScore: 92,
        reliabilityScore: 88,
        assessedAt: Date.now(),
        assessedBy: '0x1234567890123456789012345678901234567890',
        details: {
          responseQuality: 90,
          errorRate: 2,
          uptime: 99.5,
        },
      }
      expect(() => QualityAssessmentSchema.parse(assessment)).not.toThrow()
    })
  })

  describe('GovernanceEventTypeSchema', () => {
    it('validates all governance event types', () => {
      const eventTypes = [
        'ProposalCreated',
        'ProposalExecuted',
        'ProposalCancelled',
        'ProposalVetoed',
        'VoteCast',
        'CouncilVoteCast',
        'DelegationChanged',
        'QuorumReached',
        'AgentSlashed',
        'ProviderSlashed',
      ]
      for (const eventType of eventTypes) {
        expect(GovernanceEventTypeSchema.parse(eventType)).toBe(eventType)
      }
    })
  })
})

