import type {
  AgentRole,
  Room,
  RoomMessage,
  RoomPhase,
  RoomState,
  RoomType,
} from '../../lib/types'

/**
 * Room behavior configuration per room type
 */
export interface RoomBehavior {
  type: RoomType
  label: string
  description: string
  icon: string

  /** Available phases for this room type */
  phases: RoomPhase[]

  /** Whether scoring is enabled */
  scoringEnabled: boolean

  /** Whether turn-based mechanics apply */
  turnBased: boolean

  /** Required roles for this room type */
  requiredRoles?: AgentRole[]

  /** Minimum members to start */
  minMembers: number

  /** Phase transition rules */
  phaseRules: PhaseRules

  /** Scoring rules if enabled */
  scoringRules?: ScoringConfig

  /** Win condition check */
  checkWinCondition?: (state: RoomState, room: Room) => WinResult | null
}

export interface PhaseRules {
  /** Auto-transition to next phase after duration (ms) */
  autoTransition?: Record<RoomPhase, { nextPhase: RoomPhase; afterMs: number }>

  /** Conditions to transition to next phase */
  transitionConditions?: Record<RoomPhase, PhaseCondition>
}

export interface PhaseCondition {
  type: 'message_count' | 'all_voted' | 'quorum' | 'time' | 'manual'
  value?: number
  description: string
}

export interface ScoringConfig {
  /** Points per message */
  messagePoints: number

  /** Points for action execution */
  actionPoints: number

  /** Bonus for winning */
  winBonus: number

  /** Penalty for violations */
  violationPenalty: number

  /** Team-based scoring */
  teamBased: boolean
}

export interface WinResult {
  winner: 'red_team' | 'blue_team' | 'draw' | string
  reason: string
  finalScores: Record<string, number>
}

/**
 * Collaboration Room Behavior
 * - No competition, shared goals
 * - All members work together
 * - No scoring
 */
export const collaborationBehavior: RoomBehavior = {
  type: 'collaboration',
  label: 'Collaboration',
  description:
    'Multi-agent cooperative workspace for shared goals and brainstorming',
  icon: '🤝',

  phases: ['setup', 'active', 'paused', 'completed'],
  scoringEnabled: false,
  turnBased: false,
  minMembers: 1,

  phaseRules: {
    transitionConditions: {
      setup: {
        type: 'manual',
        description: 'Owner starts the session',
      },
      active: {
        type: 'manual',
        description: 'Owner ends the session',
      },
      paused: {
        type: 'manual',
        description: 'Owner resumes or ends',
      },
      completed: {
        type: 'manual',
        description: 'Session ended',
      },
      archived: {
        type: 'manual',
        description: 'Archived',
      },
    },
  },
}

/**
 * Adversarial Room Behavior
 * - Red team vs Blue team
 * - Attack and defense mechanics
 * - Turn-based with scoring
 */
export const adversarialBehavior: RoomBehavior = {
  type: 'adversarial',
  label: 'Adversarial',
  description:
    'Red team vs Blue team security testing with attack/defense mechanics',
  icon: '⚔️',

  phases: ['setup', 'active', 'paused', 'completed'],
  scoringEnabled: true,
  turnBased: true,
  requiredRoles: ['red_team', 'blue_team'],
  minMembers: 2,

  phaseRules: {
    autoTransition: {
      setup: { nextPhase: 'active', afterMs: 5 * 60 * 1000 }, // 5 min setup
      active: { nextPhase: 'completed', afterMs: 30 * 60 * 1000 }, // 30 min rounds
      paused: { nextPhase: 'active', afterMs: 5 * 60 * 1000 },
      completed: { nextPhase: 'archived', afterMs: 24 * 60 * 60 * 1000 },
      archived: { nextPhase: 'archived', afterMs: 0 },
    },
    transitionConditions: {
      setup: {
        type: 'manual',
        description: 'Both teams ready',
      },
      active: {
        type: 'message_count',
        value: 50,
        description: 'Round ends after 50 messages or timeout',
      },
      paused: {
        type: 'manual',
        description: 'Manual resume',
      },
      completed: {
        type: 'manual',
        description: 'Game ended',
      },
      archived: {
        type: 'time',
        description: 'Auto-archive after 24h',
      },
    },
  },

  scoringRules: {
    messagePoints: 1,
    actionPoints: 5,
    winBonus: 100,
    violationPenalty: -10,
    teamBased: true,
  },

  checkWinCondition: (state: RoomState, _room: Room): WinResult | null => {
    // Calculate team scores
    let redScore = 0
    let blueScore = 0

    for (const [agentId, score] of Object.entries(state.scores)) {
      // Determine team by looking at role assignments in metadata
      const agentRole = state.metadata[`role_${agentId}`] as
        | AgentRole
        | undefined
      if (agentRole === 'red_team') {
        redScore += score
      } else if (agentRole === 'blue_team') {
        blueScore += score
      }
    }

    // Only determine winner if game is completed
    if (state.phase !== 'completed') {
      return null
    }

    const winner =
      redScore > blueScore
        ? 'red_team'
        : blueScore > redScore
          ? 'blue_team'
          : 'draw'

    return {
      winner,
      reason:
        winner === 'draw'
          ? 'Scores tied'
          : `${winner === 'red_team' ? 'Red' : 'Blue'} team wins with ${Math.max(redScore, blueScore)} points`,
      finalScores: { red_team: redScore, blue_team: blueScore },
    }
  },
}

/**
 * Debate Room Behavior
 * - Structured argumentation
 * - Turn-based with time limits
 * - Voting to determine winner
 */
export const debateBehavior: RoomBehavior = {
  type: 'debate',
  label: 'Debate',
  description:
    'Structured argumentation with turn-based speaking and voting to determine winner',
  icon: '💬',

  phases: ['setup', 'active', 'paused', 'completed'],
  scoringEnabled: true,
  turnBased: true,
  minMembers: 2,

  phaseRules: {
    autoTransition: {
      setup: { nextPhase: 'active', afterMs: 2 * 60 * 1000 }, // 2 min setup
      active: { nextPhase: 'completed', afterMs: 20 * 60 * 1000 }, // 20 min debate
      paused: { nextPhase: 'active', afterMs: 5 * 60 * 1000 },
      completed: { nextPhase: 'archived', afterMs: 24 * 60 * 60 * 1000 },
      archived: { nextPhase: 'archived', afterMs: 0 },
    },
    transitionConditions: {
      setup: {
        type: 'manual',
        description: 'Moderator starts debate',
      },
      active: {
        type: 'all_voted',
        description: 'All participants have voted',
      },
      paused: {
        type: 'manual',
        description: 'Moderator resumes',
      },
      completed: {
        type: 'manual',
        description: 'Voting complete',
      },
      archived: {
        type: 'time',
        description: 'Auto-archive',
      },
    },
  },

  scoringRules: {
    messagePoints: 2,
    actionPoints: 0,
    winBonus: 50,
    violationPenalty: -5,
    teamBased: false,
  },

  checkWinCondition: (state: RoomState, _room: Room): WinResult | null => {
    if (state.phase !== 'completed') return null

    // Find highest scorer
    let maxScore = 0
    let winner = ''
    const tied: string[] = []

    for (const [agentId, score] of Object.entries(state.scores)) {
      if (score > maxScore) {
        maxScore = score
        winner = agentId
        tied.length = 0
      } else if (score === maxScore) {
        tied.push(agentId)
      }
    }

    if (tied.length > 0) {
      return {
        winner: 'draw',
        reason: 'Multiple participants tied for first place',
        finalScores: state.scores,
      }
    }

    return {
      winner,
      reason: `Agent ${winner} wins with ${maxScore} points`,
      finalScores: state.scores,
    }
  },
}

/**
 * Council Room Behavior
 * - Governance/proposal mechanics
 * - Quorum requirements
 * - Voting with stake-weighted options
 */
export const councilBehavior: RoomBehavior = {
  type: 'council',
  label: 'Council',
  description:
    'Governance workspace with proposal creation, quorum requirements, and voting',
  icon: '🏛️',

  phases: ['setup', 'active', 'paused', 'completed'],
  scoringEnabled: false,
  turnBased: false,
  minMembers: 3, // Need quorum
  requiredRoles: ['moderator'],

  phaseRules: {
    autoTransition: {
      setup: { nextPhase: 'active', afterMs: 10 * 60 * 1000 }, // 10 min setup
      active: { nextPhase: 'completed', afterMs: 60 * 60 * 1000 }, // 1 hour voting
      paused: { nextPhase: 'active', afterMs: 5 * 60 * 1000 },
      completed: { nextPhase: 'archived', afterMs: 7 * 24 * 60 * 60 * 1000 },
      archived: { nextPhase: 'archived', afterMs: 0 },
    },
    transitionConditions: {
      setup: {
        type: 'manual',
        description: 'Moderator opens voting',
      },
      active: {
        type: 'quorum',
        value: 66, // 66% quorum
        description: 'Quorum reached (66% voted)',
      },
      paused: {
        type: 'manual',
        description: 'Moderator resumes',
      },
      completed: {
        type: 'manual',
        description: 'Voting ended',
      },
      archived: {
        type: 'time',
        description: 'Auto-archive after 7 days',
      },
    },
  },

  checkWinCondition: (state: RoomState, room: Room): WinResult | null => {
    if (state.phase !== 'completed') return null

    // Count votes from metadata
    const votes = state.metadata.votes as
      | Record<string, 'for' | 'against' | 'abstain'>
      | undefined
    if (!votes) {
      return {
        winner: 'no_quorum',
        reason: 'No votes recorded',
        finalScores: {},
      }
    }

    let forCount = 0
    let againstCount = 0
    let abstainCount = 0

    for (const vote of Object.values(votes)) {
      if (vote === 'for') forCount++
      else if (vote === 'against') againstCount++
      else abstainCount++
    }

    const totalVoters = room.members.length
    const quorumMet = (forCount + againstCount) / totalVoters >= 0.66

    if (!quorumMet) {
      return {
        winner: 'no_quorum',
        reason: `Quorum not met (${Math.round(((forCount + againstCount) / totalVoters) * 100)}% voted)`,
        finalScores: {
          for: forCount,
          against: againstCount,
          abstain: abstainCount,
        },
      }
    }

    const winner = forCount > againstCount ? 'approved' : 'rejected'

    return {
      winner,
      reason: `Proposal ${winner} with ${forCount} for, ${againstCount} against`,
      finalScores: {
        for: forCount,
        against: againstCount,
        abstain: abstainCount,
      },
    }
  },
}

/**
 * Get behavior configuration for a room type
 */
export function getRoomBehavior(type: RoomType): RoomBehavior {
  const behaviors: Record<RoomType, RoomBehavior> = {
    collaboration: collaborationBehavior,
    adversarial: adversarialBehavior,
    debate: debateBehavior,
    council: councilBehavior,
  }
  return behaviors[type]
}

/**
 * All room behaviors
 */
export const ROOM_BEHAVIORS: Record<RoomType, RoomBehavior> = {
  collaboration: collaborationBehavior,
  adversarial: adversarialBehavior,
  debate: debateBehavior,
  council: councilBehavior,
}

/**
 * Calculate score delta for a message based on room behavior
 */
export function calculateMessageScore(
  behavior: RoomBehavior,
  message: RoomMessage,
): number {
  if (!behavior.scoringEnabled || !behavior.scoringRules) return 0

  let score = behavior.scoringRules.messagePoints

  // Bonus for actions
  if (message.action) {
    score += behavior.scoringRules.actionPoints
  }

  return score
}

/**
 * Check if phase transition is allowed
 */
export function canTransitionPhase(
  behavior: RoomBehavior,
  currentPhase: RoomPhase,
  _targetPhase: RoomPhase,
  state: RoomState,
  room: Room,
): { allowed: boolean; reason: string } {
  const condition = behavior.phaseRules.transitionConditions?.[currentPhase]

  if (!condition) {
    return { allowed: true, reason: 'No conditions defined' }
  }

  switch (condition.type) {
    case 'manual':
      return { allowed: true, reason: condition.description }

    case 'message_count': {
      const messageCount = state.messages.length
      const required = condition.value ?? 0
      if (messageCount >= required) {
        return {
          allowed: true,
          reason: `Message count reached (${messageCount}/${required})`,
        }
      }
      return {
        allowed: false,
        reason: `Need ${required - messageCount} more messages`,
      }
    }

    case 'all_voted': {
      const votes = state.metadata.votes as Record<string, string> | undefined
      const votedCount = votes ? Object.keys(votes).length : 0
      if (votedCount >= room.members.length) {
        return { allowed: true, reason: 'All members voted' }
      }
      return {
        allowed: false,
        reason: `${room.members.length - votedCount} members haven't voted`,
      }
    }

    case 'quorum': {
      const quorumVotes = state.metadata.votes as
        | Record<string, string>
        | undefined
      const quorumVotedCount = quorumVotes ? Object.keys(quorumVotes).length : 0
      const quorumPercent = (quorumVotedCount / room.members.length) * 100
      const requiredQuorum = condition.value ?? 50
      if (quorumPercent >= requiredQuorum) {
        return {
          allowed: true,
          reason: `Quorum met (${Math.round(quorumPercent)}%)`,
        }
      }
      return {
        allowed: false,
        reason: `Need ${requiredQuorum}% quorum, have ${Math.round(quorumPercent)}%`,
      }
    }

    case 'time':
      // Time-based transitions handled by auto-transition
      return { allowed: true, reason: condition.description }

    default:
      return { allowed: true, reason: 'Unknown condition type' }
  }
}

/**
 * Get next turn holder for turn-based rooms
 */
export function getNextTurnHolder(
  state: RoomState,
  room: Room,
  behavior: RoomBehavior,
): string | null {
  if (!behavior.turnBased) return null

  const currentTurn = state.currentTurn
  const memberIds = room.members.map((m) => m.agentId.toString())

  if (!currentTurn || !memberIds.includes(currentTurn)) {
    // Start with first member
    return memberIds[0] ?? null
  }

  const currentIndex = memberIds.indexOf(currentTurn)
  const nextIndex = (currentIndex + 1) % memberIds.length
  return memberIds[nextIndex] ?? null
}

/**
 * Validate message against room rules
 */
export function validateMessage(
  message: RoomMessage,
  state: RoomState,
  room: Room,
  behavior: RoomBehavior,
): { valid: boolean; error?: string } {
  // Check if room is active
  if (state.phase !== 'active') {
    return { valid: false, error: `Room is in ${state.phase} phase` }
  }

  // Check turn-based rules
  if (behavior.turnBased && state.currentTurn) {
    if (message.agentId !== state.currentTurn) {
      return {
        valid: false,
        error: `Not your turn. Current turn: ${state.currentTurn}`,
      }
    }
  }

  // Check if agent is member
  const isMember = room.members.some(
    (m) => m.agentId.toString() === message.agentId,
  )
  if (!isMember) {
    return { valid: false, error: 'Agent is not a member of this room' }
  }

  return { valid: true }
}
