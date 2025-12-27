/**
 * Governance Types Tests
 *
 * Tests for governance-related type definitions.
 */

import { describe, expect, it } from 'bun:test'

// Proposal state
type ProposalState =
  | 'pending'
  | 'active'
  | 'canceled'
  | 'defeated'
  | 'succeeded'
  | 'queued'
  | 'expired'
  | 'executed'

// Vote type
type VoteType = 'for' | 'against' | 'abstain'

// Proposal structure
interface Proposal {
  id: bigint
  proposer: string
  title: string
  description: string
  targets: string[]
  values: bigint[]
  calldatas: string[]
  startBlock: bigint
  endBlock: bigint
  forVotes: bigint
  againstVotes: bigint
  abstainVotes: bigint
  state: ProposalState
  eta?: bigint
}

// Vote structure
interface Vote {
  proposalId: bigint
  voter: string
  support: VoteType
  weight: bigint
  reason?: string
}

describe('ProposalState', () => {
  it('validates all proposal states', () => {
    const states: ProposalState[] = [
      'pending',
      'active',
      'canceled',
      'defeated',
      'succeeded',
      'queued',
      'expired',
      'executed',
    ]

    expect(states).toHaveLength(8)
    expect(states).toContain('pending')
    expect(states).toContain('executed')
  })

  it('state transitions are valid', () => {
    const validTransitions: Record<ProposalState, ProposalState[]> = {
      pending: ['active', 'canceled'],
      active: ['canceled', 'defeated', 'succeeded'],
      canceled: [],
      defeated: [],
      succeeded: ['queued', 'expired'],
      queued: ['executed', 'expired'],
      expired: [],
      executed: [],
    }

    // Pending can transition to active or canceled
    expect(validTransitions.pending).toContain('active')
    expect(validTransitions.pending).toContain('canceled')

    // Terminal states have no transitions
    expect(validTransitions.executed).toHaveLength(0)
    expect(validTransitions.defeated).toHaveLength(0)
    expect(validTransitions.expired).toHaveLength(0)
  })
})

describe('VoteType', () => {
  it('validates vote types', () => {
    const voteTypes: VoteType[] = ['for', 'against', 'abstain']
    expect(voteTypes).toHaveLength(3)
  })

  it('maps to numeric values', () => {
    const voteMapping: Record<VoteType, number> = {
      against: 0,
      for: 1,
      abstain: 2,
    }

    expect(voteMapping.against).toBe(0)
    expect(voteMapping.for).toBe(1)
    expect(voteMapping.abstain).toBe(2)
  })
})

describe('Proposal type', () => {
  it('validates complete proposal', () => {
    const proposal: Proposal = {
      id: 1n,
      proposer: '0x1234567890123456789012345678901234567890',
      title: 'Upgrade Treasury',
      description: 'Proposal to upgrade the treasury contract',
      targets: ['0xTreasury1234567890123456789012345678901'],
      values: [0n],
      calldatas: ['0x12345678'],
      startBlock: 1000000n,
      endBlock: 1050000n,
      forVotes: 1000000000000000000000n,
      againstVotes: 500000000000000000000n,
      abstainVotes: 100000000000000000000n,
      state: 'active',
    }

    expect(proposal.id).toBe(1n)
    expect(proposal.targets.length).toBe(proposal.values.length)
    expect(proposal.targets.length).toBe(proposal.calldatas.length)
    expect(proposal.endBlock).toBeGreaterThan(proposal.startBlock)
    expect(proposal.forVotes).toBeGreaterThan(proposal.againstVotes)
  })

  it('validates proposal with multiple actions', () => {
    const proposal: Proposal = {
      id: 2n,
      proposer: '0xProposer',
      title: 'Multi-action Proposal',
      description: 'Execute multiple contract calls',
      targets: ['0xContract1', '0xContract2', '0xContract3'],
      values: [0n, 1000000000000000000n, 0n],
      calldatas: ['0xfunc1', '0xfunc2', '0xfunc3'],
      startBlock: 2000000n,
      endBlock: 2100000n,
      forVotes: 0n,
      againstVotes: 0n,
      abstainVotes: 0n,
      state: 'pending',
    }

    expect(proposal.targets).toHaveLength(3)
    expect(proposal.values.some((v) => v > 0n)).toBe(true) // Has ETH transfer
  })

  it('validates queued proposal with eta', () => {
    const proposal: Proposal = {
      id: 3n,
      proposer: '0xProposer',
      title: 'Queued Proposal',
      description: 'Waiting for timelock',
      targets: ['0xTarget'],
      values: [0n],
      calldatas: ['0xdata'],
      startBlock: 1000000n,
      endBlock: 1050000n,
      forVotes: 2000000000000000000000n,
      againstVotes: 500000000000000000000n,
      abstainVotes: 0n,
      state: 'queued',
      eta: 1700000000n,
    }

    expect(proposal.state).toBe('queued')
    expect(proposal.eta).toBeDefined()
    expect(proposal.eta).toBeGreaterThan(0n)
  })
})

describe('Vote type', () => {
  it('validates for vote', () => {
    const vote: Vote = {
      proposalId: 1n,
      voter: '0x1234567890123456789012345678901234567890',
      support: 'for',
      weight: 1000000000000000000n,
    }

    expect(vote.support).toBe('for')
    expect(vote.weight).toBeGreaterThan(0n)
    expect(vote.reason).toBeUndefined()
  })

  it('validates vote with reason', () => {
    const vote: Vote = {
      proposalId: 1n,
      voter: '0xVoter',
      support: 'against',
      weight: 500000000000000000n,
      reason: 'The proposal does not adequately address security concerns.',
    }

    expect(vote.reason).toBeDefined()
    expect(vote.reason?.length).toBeGreaterThan(0)
  })

  it('validates abstain vote', () => {
    const vote: Vote = {
      proposalId: 1n,
      voter: '0xVoter',
      support: 'abstain',
      weight: 100000000000000000n,
      reason: 'Conflict of interest',
    }

    expect(vote.support).toBe('abstain')
  })
})

describe('Governance calculations', () => {
  it('calculates quorum', () => {
    const totalSupply = 100000000000000000000000000n // 100M tokens
    const quorumPercentage = 4n // 4%
    const quorum = (totalSupply * quorumPercentage) / 100n

    expect(quorum).toBe(4000000000000000000000000n) // 4M tokens
  })

  it('determines proposal success', () => {
    const proposal: Proposal = {
      id: 1n,
      proposer: '0xProposer',
      title: 'Test',
      description: 'Test',
      targets: [],
      values: [],
      calldatas: [],
      startBlock: 0n,
      endBlock: 0n,
      forVotes: 6000000000000000000000000n, // 6M
      againstVotes: 3000000000000000000000000n, // 3M
      abstainVotes: 1000000000000000000000000n, // 1M
      state: 'active',
    }

    const quorum = 4000000000000000000000000n // 4M
    const _totalVotes = proposal.forVotes + proposal.againstVotes
    const forRatio = proposal.forVotes > proposal.againstVotes
    const quorumMet = proposal.forVotes + proposal.abstainVotes >= quorum

    expect(forRatio).toBe(true)
    expect(quorumMet).toBe(true)
  })

  it('calculates voting power from staked tokens', () => {
    const stakedAmount = 1000000000000000000n // 1 token
    const stakeDuration = 365 * 24 * 60 * 60 // 1 year in seconds
    const maxDuration = 4 * 365 * 24 * 60 * 60 // 4 years

    // veToken style: voting power = amount * (duration / maxDuration)
    const votingPower =
      (stakedAmount * BigInt(stakeDuration)) / BigInt(maxDuration)

    expect(votingPower).toBe(250000000000000000n) // 0.25 voting power for 1 year lock
  })
})
