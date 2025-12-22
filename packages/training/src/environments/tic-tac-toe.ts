/**
 * Tic-Tac-Toe Environment for Training
 *
 * A simple game environment for demonstrating RLAIF training.
 * Agents learn to play tic-tac-toe through self-play and LLM-as-judge scoring.
 */

// ============================================================================
// Types
// ============================================================================

export type Player = 'X' | 'O'
export type Cell = Player | null
export type Board = [Cell, Cell, Cell, Cell, Cell, Cell, Cell, Cell, Cell]

export interface GameState {
  board: Board
  currentPlayer: Player
  moveNumber: number
  winner: Player | 'draw' | null
  history: Move[]
}

export interface Move {
  player: Player
  position: number
  reasoning?: string
}

export interface GameStep {
  stepNumber: number
  timestamp: number
  observation: {
    board: string
    currentPlayer: Player
    validMoves: number[]
    moveNumber: number
  }
  action: {
    type: 'move'
    parameters: { position: number }
    reasoning?: string
  }
  reward: number
  done: boolean
}

export interface GameTrajectory {
  trajectoryId: string
  agentId: string
  steps: GameStep[]
  totalReward: number
  metadata: {
    winner: Player | 'draw' | null
    totalMoves: number
    startTime: number
    endTime: number
  }
}

// ============================================================================
// Game Logic
// ============================================================================

const WINNING_LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8], // Rows
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8], // Columns
  [0, 4, 8],
  [2, 4, 6], // Diagonals
] as const

function createEmptyBoard(): Board {
  return [null, null, null, null, null, null, null, null, null]
}

function checkWinner(board: Board): Player | 'draw' | null {
  for (const [a, b, c] of WINNING_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as Player
    }
  }

  if (board.every((cell) => cell !== null)) {
    return 'draw'
  }

  return null
}

function getValidMoves(board: Board): number[] {
  return board
    .map((cell, i) => (cell === null ? i : -1))
    .filter((i) => i !== -1)
}

function boardToString(board: Board): string {
  const symbols = board.map((cell) => cell ?? '.')
  return `${symbols[0]}|${symbols[1]}|${symbols[2]}\n-+-+-\n${symbols[3]}|${symbols[4]}|${symbols[5]}\n-+-+-\n${symbols[6]}|${symbols[7]}|${symbols[8]}`
}

// ============================================================================
// Environment
// ============================================================================

export class TicTacToeEnv {
  private state: GameState
  private trajectories: GameTrajectory[] = []

  constructor() {
    this.state = this.resetGame()
  }

  private resetGame(): GameState {
    return {
      board: createEmptyBoard(),
      currentPlayer: 'X',
      moveNumber: 0,
      winner: null,
      history: [],
    }
  }

  makeMove(
    position: number,
    reasoning?: string,
  ): { valid: boolean; reward: number; done: boolean } {
    if (this.state.winner !== null) {
      return { valid: false, reward: -1, done: true }
    }

    if (this.state.board[position] !== null) {
      return { valid: false, reward: -0.5, done: false }
    }

    this.state.board[position] = this.state.currentPlayer
    this.state.history.push({
      player: this.state.currentPlayer,
      position,
      reasoning,
    })
    this.state.moveNumber++

    const winner = checkWinner(this.state.board)
    this.state.winner = winner

    let reward = 0
    const done = winner !== null

    if (winner === this.state.currentPlayer) {
      reward = 1
    } else if (winner === 'draw') {
      reward = 0.3
    }

    this.state.currentPlayer = this.state.currentPlayer === 'X' ? 'O' : 'X'

    return { valid: true, reward, done }
  }

  getObservation(): GameStep['observation'] {
    return {
      board: boardToString(this.state.board),
      currentPlayer: this.state.currentPlayer,
      validMoves: getValidMoves(this.state.board),
      moveNumber: this.state.moveNumber,
    }
  }

  getState(): GameState {
    return { ...this.state }
  }

  reset(): void {
    this.state = this.resetGame()
  }

  generateRandomTrajectory(agentId: string): GameTrajectory {
    this.reset()
    const steps: GameStep[] = []
    const startTime = Date.now()
    let totalReward = 0

    while (this.state.winner === null) {
      const obs = this.getObservation()
      const validMoves = obs.validMoves

      if (validMoves.length === 0) break

      let position: number
      const center = 4
      const corners = [0, 2, 6, 8]

      const randomMove =
        validMoves[Math.floor(Math.random() * validMoves.length)] ??
        validMoves[0] ??
        0

      if (validMoves.includes(center)) {
        position = Math.random() < 0.3 ? center : randomMove
      } else if (corners.some((c) => validMoves.includes(c))) {
        const availableCorners = corners.filter((c) => validMoves.includes(c))
        const randomCorner =
          availableCorners[
            Math.floor(Math.random() * availableCorners.length)
          ] ??
          availableCorners[0] ??
          0
        position = Math.random() < 0.4 ? randomCorner : randomMove
      } else {
        position = randomMove
      }

      const reasoning = this.generateReasoning(obs, position)
      const { reward, done } = this.makeMove(position, reasoning)
      totalReward += reward

      steps.push({
        stepNumber: steps.length,
        timestamp: Date.now(),
        observation: obs,
        action: {
          type: 'move',
          parameters: { position },
          reasoning,
        },
        reward,
        done,
      })
    }

    const trajectory: GameTrajectory = {
      trajectoryId: `ttt-${crypto.randomUUID()}`,
      agentId,
      steps,
      totalReward,
      metadata: {
        winner: this.state.winner,
        totalMoves: this.state.moveNumber,
        startTime,
        endTime: Date.now(),
      },
    }

    this.trajectories.push(trajectory)
    return trajectory
  }

  private generateReasoning(
    _obs: GameStep['observation'],
    position: number,
  ): string {
    const positionLabels = [
      'top-left',
      'top-center',
      'top-right',
      'middle-left',
      'center',
      'middle-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ]

    const reasons = [
      `I chose ${positionLabels[position]} because it gives me a strategic advantage.`,
      `Playing ${positionLabels[position]} blocks my opponent's potential winning line.`,
      `${positionLabels[position]} is the best move to control the center of the board.`,
      `I'm setting up a winning position by playing ${positionLabels[position]}.`,
      `This move at ${positionLabels[position]} creates two winning threats.`,
    ]

    const reason = reasons[Math.floor(Math.random() * reasons.length)]
    return reason ?? reasons[0] ?? 'Strategic move.'
  }

  generateTrajectoryBatch(count: number, agentIds: string[]): GameTrajectory[] {
    const trajectories: GameTrajectory[] = []

    for (let i = 0; i < count; i++) {
      const agentId = agentIds[i % agentIds.length]
      if (!agentId) continue
      trajectories.push(this.generateRandomTrajectory(agentId))
    }

    return trajectories
  }

  getTrajectories(): GameTrajectory[] {
    return this.trajectories
  }

  clearTrajectories(): void {
    this.trajectories = []
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createTicTacToeEnv(): TicTacToeEnv {
  return new TicTacToeEnv()
}

export function trajectoryToTrainingFormat(trajectory: GameTrajectory): {
  prompt: string
  response: string
  reward: number
} {
  const prompt = `You are playing Tic-Tac-Toe. The current board is:
${trajectory.steps[0]?.observation.board ?? 'Empty board'}

You are player ${trajectory.steps[0]?.observation.currentPlayer ?? 'X'}.
Valid moves: ${trajectory.steps[0]?.observation.validMoves.join(', ') ?? 'None'}

What move do you make and why?`

  const moves = trajectory.steps
    .map(
      (s) =>
        `Move ${s.stepNumber + 1}: Position ${s.action.parameters.position} - ${s.action.reasoning}`,
    )
    .join('\n')

  const response = `I'll analyze the game strategically:

${moves}

Game result: ${trajectory.metadata.winner === 'draw' ? 'Draw' : `Player ${trajectory.metadata.winner} wins`}`

  return {
    prompt,
    response,
    reward: trajectory.totalReward,
  }
}
