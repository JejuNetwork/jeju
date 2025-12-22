/**
 * Tic-Tac-Toe Environment Tests
 *
 * Tests the training environment for tic-tac-toe games
 */

import { describe, expect, it, beforeEach } from 'bun:test'
import {
  createTicTacToeEnv,
  TicTacToeEnv,
  trajectoryToTrainingFormat,
} from '../environments/tic-tac-toe'

describe('TicTacToeEnv', () => {
  let env: TicTacToeEnv

  beforeEach(() => {
    env = createTicTacToeEnv()
  })

  describe('initialization', () => {
    it('should start with empty board', () => {
      const state = env.getState()
      expect(state.board.every((cell) => cell === null)).toBe(true)
    })

    it('should start with X as current player', () => {
      const state = env.getState()
      expect(state.currentPlayer).toBe('X')
    })

    it('should start with no winner', () => {
      const state = env.getState()
      expect(state.winner).toBeNull()
    })

    it('should start with move number 0', () => {
      const state = env.getState()
      expect(state.moveNumber).toBe(0)
    })
  })

  describe('makeMove', () => {
    it('should place X on first move', () => {
      const result = env.makeMove(0)
      expect(result.valid).toBe(true)

      const state = env.getState()
      expect(state.board[0]).toBe('X')
    })

    it('should switch players after move', () => {
      env.makeMove(0)
      const state = env.getState()
      expect(state.currentPlayer).toBe('O')
    })

    it('should increment move number', () => {
      env.makeMove(0)
      const state = env.getState()
      expect(state.moveNumber).toBe(1)
    })

    it('should reject invalid move on occupied cell', () => {
      env.makeMove(0)
      const result = env.makeMove(0)
      expect(result.valid).toBe(false)
      expect(result.reward).toBe(-0.5)
    })

    it('should reject move after game is over', () => {
      // X wins: 0, 1, 2
      env.makeMove(0) // X
      env.makeMove(3) // O
      env.makeMove(1) // X
      env.makeMove(4) // O
      env.makeMove(2) // X wins

      const result = env.makeMove(5)
      expect(result.valid).toBe(false)
      expect(result.done).toBe(true)
    })

    it('should detect X winning', () => {
      env.makeMove(0) // X
      env.makeMove(3) // O
      env.makeMove(1) // X
      env.makeMove(4) // O
      const result = env.makeMove(2) // X wins

      expect(result.reward).toBe(1)
      expect(result.done).toBe(true)

      const state = env.getState()
      expect(state.winner).toBe('X')
    })

    it('should detect O winning', () => {
      env.makeMove(0) // X
      env.makeMove(3) // O
      env.makeMove(1) // X
      env.makeMove(4) // O
      env.makeMove(8) // X (not winning)
      const result = env.makeMove(5) // O wins

      expect(result.reward).toBe(1)
      expect(result.done).toBe(true)

      const state = env.getState()
      expect(state.winner).toBe('O')
    })

    it('should detect draw', () => {
      // Play a game that ends in draw
      env.makeMove(0) // X
      env.makeMove(1) // O
      env.makeMove(2) // X
      env.makeMove(4) // O
      env.makeMove(3) // X
      env.makeMove(5) // O
      env.makeMove(7) // X
      env.makeMove(6) // O
      const result = env.makeMove(8) // X - draw

      expect(result.done).toBe(true)
      expect(result.reward).toBe(0.3)

      const state = env.getState()
      expect(state.winner).toBe('draw')
    })
  })

  describe('getObservation', () => {
    it('should return valid moves', () => {
      const obs = env.getObservation()
      expect(obs.validMoves).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    })

    it('should update valid moves after move', () => {
      env.makeMove(4)
      const obs = env.getObservation()
      expect(obs.validMoves).toEqual([0, 1, 2, 3, 5, 6, 7, 8])
    })

    it('should return board as string', () => {
      env.makeMove(4) // X in center
      const obs = env.getObservation()
      expect(obs.board).toContain('X')
      expect(obs.board).toContain('.')
    })
  })

  describe('reset', () => {
    it('should reset board after game', () => {
      env.makeMove(0)
      env.makeMove(1)
      env.reset()

      const state = env.getState()
      expect(state.board.every((cell) => cell === null)).toBe(true)
      expect(state.currentPlayer).toBe('X')
      expect(state.moveNumber).toBe(0)
    })
  })

  describe('generateRandomTrajectory', () => {
    it('should generate complete trajectory', () => {
      const trajectory = env.generateRandomTrajectory('test-agent')

      expect(trajectory.agentId).toBe('test-agent')
      expect(trajectory.trajectoryId).toMatch(/^ttt-/)
      expect(trajectory.steps.length).toBeGreaterThan(0)
      expect(trajectory.metadata.winner).toBeDefined()
    })

    it('should end with a winner or draw', () => {
      const trajectory = env.generateRandomTrajectory('test-agent')
      const winner = trajectory.metadata.winner
      expect(winner !== null).toBe(true)
      expect(['X', 'O', 'draw']).toContain(winner!)
    })

    it('should have valid step structure', () => {
      const trajectory = env.generateRandomTrajectory('test-agent')
      const step = trajectory.steps[0]

      expect(step).toBeDefined()
      expect(step?.observation).toBeDefined()
      expect(step?.action).toBeDefined()
      expect(step?.action.type).toBe('move')
      expect(typeof step?.action.parameters.position).toBe('number')
    })

    it('should include reasoning in steps', () => {
      const trajectory = env.generateRandomTrajectory('test-agent')
      const hasReasoning = trajectory.steps.some((s) => s.action.reasoning)
      expect(hasReasoning).toBe(true)
    })
  })

  describe('generateTrajectoryBatch', () => {
    it('should generate multiple trajectories', () => {
      const trajectories = env.generateTrajectoryBatch(5, ['agent-1', 'agent-2'])
      expect(trajectories).toHaveLength(5)
    })

    it('should alternate between agents', () => {
      const trajectories = env.generateTrajectoryBatch(4, ['agent-1', 'agent-2'])
      expect(trajectories[0]?.agentId).toBe('agent-1')
      expect(trajectories[1]?.agentId).toBe('agent-2')
      expect(trajectories[2]?.agentId).toBe('agent-1')
      expect(trajectories[3]?.agentId).toBe('agent-2')
    })
  })

  describe('trajectory storage', () => {
    it('should store generated trajectories', () => {
      env.generateRandomTrajectory('agent-1')
      env.generateRandomTrajectory('agent-2')

      const trajectories = env.getTrajectories()
      expect(trajectories).toHaveLength(2)
    })

    it('should clear trajectories', () => {
      env.generateRandomTrajectory('agent-1')
      env.clearTrajectories()

      const trajectories = env.getTrajectories()
      expect(trajectories).toHaveLength(0)
    })
  })
})

describe('trajectoryToTrainingFormat', () => {
  it('should convert trajectory to training format', () => {
    const env = createTicTacToeEnv()
    const trajectory = env.generateRandomTrajectory('test-agent')

    const trainingData = trajectoryToTrainingFormat(trajectory)

    expect(trainingData.prompt).toContain('Tic-Tac-Toe')
    expect(trainingData.response).toContain('Move')
    expect(typeof trainingData.reward).toBe('number')
  })

  it('should include game result in response', () => {
    const env = createTicTacToeEnv()
    const trajectory = env.generateRandomTrajectory('test-agent')

    const trainingData = trajectoryToTrainingFormat(trajectory)

    expect(trainingData.response).toContain('Game result:')
  })
})

describe('winning line detection', () => {
  let env: TicTacToeEnv

  beforeEach(() => {
    env = createTicTacToeEnv()
  })

  it('should detect horizontal wins', () => {
    // Top row
    env.makeMove(0) // X
    env.makeMove(3) // O
    env.makeMove(1) // X
    env.makeMove(4) // O
    env.makeMove(2) // X wins

    expect(env.getState().winner).toBe('X')
  })

  it('should detect vertical wins', () => {
    // Left column
    env.makeMove(0) // X
    env.makeMove(1) // O
    env.makeMove(3) // X
    env.makeMove(2) // O
    env.makeMove(6) // X wins

    expect(env.getState().winner).toBe('X')
  })

  it('should detect diagonal wins', () => {
    // Main diagonal
    env.makeMove(0) // X
    env.makeMove(1) // O
    env.makeMove(4) // X
    env.makeMove(2) // O
    env.makeMove(8) // X wins

    expect(env.getState().winner).toBe('X')
  })

  it('should detect anti-diagonal wins', () => {
    // Anti-diagonal
    env.makeMove(2) // X
    env.makeMove(1) // O
    env.makeMove(4) // X
    env.makeMove(3) // O
    env.makeMove(6) // X wins

    expect(env.getState().winner).toBe('X')
  })
})

