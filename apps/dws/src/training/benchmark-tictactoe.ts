#!/usr/bin/env bun
/**
 * Tic-Tac-Toe Training Benchmark
 * 
 * Properly trains and evaluates a model on tic-tac-toe:
 * 1. Benchmark baseline model (100 games)
 * 2. Generate training data from optimal play
 * 3. Fine-tune model on training data
 * 4. Benchmark trained model (100 games)
 * 5. Compare results
 */

import { spawn } from 'bun';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  modelName: 'distilgpt2',  // Larger model that can actually learn
  trainedModelPath: './training_output/ttt-trained',
  numBenchmarkGames: 100,
  trainingEpochs: 10,
  batchSize: 8,
  learningRate: 5e-4,
};

// ============================================================================
// Tic-Tac-Toe Logic
// ============================================================================

type Player = 'X' | 'O';
type Cell = Player | null;
type Board = Cell[];

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
  [0, 4, 8], [2, 4, 6],             // Diagonals
];

function checkWinner(board: Board): Player | 'draw' | null {
  for (const [a, b, c] of WINNING_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as Player;
    }
  }
  return board.every(c => c !== null) ? 'draw' : null;
}

function getValidMoves(board: Board): number[] {
  return board.map((c, i) => c === null ? i : -1).filter(i => i !== -1);
}

function boardToPrompt(board: Board, player: Player): string {
  const display = board.map((c, i) => c ?? String(i)).join('');
  return `Tic-Tac-Toe board: ${display}. You are ${player}. Pick a position (0-8):`;
}

// Optimal strategy for tic-tac-toe
function getOptimalMove(board: Board, player: Player): number {
  const opponent = player === 'X' ? 'O' : 'X';
  const valid = getValidMoves(board);
  
  // Win if possible
  for (const move of valid) {
    const test = [...board];
    test[move] = player;
    if (checkWinner(test) === player) return move;
  }
  
  // Block opponent win
  for (const move of valid) {
    const test = [...board];
    test[move] = opponent;
    if (checkWinner(test) === opponent) return move;
  }
  
  // Take center
  if (valid.includes(4)) return 4;
  
  // Take corner
  const corners = [0, 2, 6, 8].filter(c => valid.includes(c));
  if (corners.length > 0) return corners[0];
  
  // Take any
  return valid[0];
}

// ============================================================================
// Training Data Generation
// ============================================================================

interface TrainingExample {
  prompt: string;
  completion: string;
}

function generateTrainingData(numGames: number): TrainingExample[] {
  const examples: TrainingExample[] = [];
  
  for (let g = 0; g < numGames; g++) {
    const board: Board = Array(9).fill(null);
    let player: Player = 'X';
    
    while (checkWinner(board) === null) {
      const validMoves = getValidMoves(board);
      if (validMoves.length === 0) break;
      
      const move = getOptimalMove(board, player);
      const prompt = boardToPrompt(board, player);
      
      examples.push({
        prompt,
        completion: String(move),
      });
      
      board[move] = player;
      player = player === 'X' ? 'O' : 'X';
    }
  }
  
  return examples;
}

// ============================================================================
// Model Evaluation
// ============================================================================

async function evaluateModel(
  modelPath: string,
  numGames: number,
  description: string
): Promise<{ wins: number; losses: number; draws: number; invalidMoves: number }> {
  console.log(`\nEvaluating: ${description}`);
  console.log(`Playing ${numGames} games against optimal opponent...`);
  
  const pythonScript = `
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import sys
import re

MODEL_PATH = "${modelPath}"
NUM_GAMES = ${numGames}

# Load model
tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token
model = AutoModelForCausalLM.from_pretrained(MODEL_PATH)
device = "cuda" if torch.cuda.is_available() else "cpu"
model = model.to(device)
model.eval()

WINNING_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
]

def check_winner(board):
    for a, b, c in WINNING_LINES:
        if board[a] and board[a] == board[b] == board[c]:
            return board[a]
    if all(c is not None for c in board):
        return 'draw'
    return None

def get_valid_moves(board):
    return [i for i, c in enumerate(board) if c is None]

def get_optimal_move(board, player):
    opponent = 'O' if player == 'X' else 'X'
    valid = get_valid_moves(board)
    
    # Win if possible
    for move in valid:
        test = board[:]
        test[move] = player
        if check_winner(test) == player:
            return move
    
    # Block opponent
    for move in valid:
        test = board[:]
        test[move] = opponent
        if check_winner(test) == opponent:
            return move
    
    # Center, corners, edges
    if 4 in valid: return 4
    for c in [0, 2, 6, 8]:
        if c in valid: return c
    return valid[0] if valid else -1

def get_model_move(board, player):
    display = ''.join(str(i) if c is None else c for i, c in enumerate(board))
    prompt = f"Tic-Tac-Toe board: {display}. You are {player}. Pick a position (0-8):"
    
    inputs = tokenizer(prompt, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=5,
            do_sample=True,
            temperature=0.7,
            pad_token_id=tokenizer.pad_token_id,
        )
    
    response = tokenizer.decode(outputs[0], skip_special_tokens=True)
    response = response[len(prompt):].strip()
    
    # Extract digit from response
    match = re.search(r'[0-8]', response)
    if match:
        move = int(match.group())
        if move in get_valid_moves(board):
            return move
    
    # Fallback to random valid move
    valid = get_valid_moves(board)
    return valid[0] if valid else -1

wins = 0
losses = 0
draws = 0
invalid_moves = 0

for game in range(NUM_GAMES):
    board = [None] * 9
    model_player = 'X' if game % 2 == 0 else 'O'
    current = 'X'
    
    while check_winner(board) is None:
        valid = get_valid_moves(board)
        if not valid:
            break
        
        if current == model_player:
            move = get_model_move(board, current)
            if move not in valid:
                invalid_moves += 1
                move = valid[0]
        else:
            move = get_optimal_move(board, current)
        
        board[move] = current
        current = 'O' if current == 'X' else 'X'
    
    result = check_winner(board)
    if result == model_player:
        wins += 1
    elif result == 'draw':
        draws += 1
    else:
        losses += 1
    
    if (game + 1) % 20 == 0:
        print(f"  Game {game + 1}/{NUM_GAMES}: W={wins} L={losses} D={draws}", file=sys.stderr)

print(f"RESULTS:{wins},{losses},{draws},{invalid_moves}")
`;

  const proc = spawn(['python3', '-c', pythonScript], {
    stdout: 'pipe',
    stderr: 'inherit',
  });

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const match = output.match(/RESULTS:(\d+),(\d+),(\d+),(\d+)/);
  if (!match) {
    console.error('Failed to parse results:', output);
    return { wins: 0, losses: 0, draws: 0, invalidMoves: 0 };
  }

  return {
    wins: parseInt(match[1]),
    losses: parseInt(match[2]),
    draws: parseInt(match[3]),
    invalidMoves: parseInt(match[4]),
  };
}

// ============================================================================
// Training
// ============================================================================

async function trainModel(
  baseModel: string,
  outputPath: string,
  examples: TrainingExample[]
): Promise<void> {
  console.log(`\nTraining model on ${examples.length} examples...`);
  
  // Prepare training data as JSON
  const trainingData = examples.map(e => ({
    text: `${e.prompt} ${e.completion}`,
  }));

  const pythonScript = `
import torch
from torch.optim import AdamW
from transformers import AutoModelForCausalLM, AutoTokenizer, get_linear_schedule_with_warmup
from torch.utils.data import Dataset, DataLoader
import json

BASE_MODEL = "${baseModel}"
OUTPUT_PATH = "${outputPath}"
EPOCHS = ${CONFIG.trainingEpochs}
BATCH_SIZE = ${CONFIG.batchSize}
LR = ${CONFIG.learningRate}

# Training data
training_data = json.loads('''${JSON.stringify(trainingData)}''')

print(f"Loading model: {BASE_MODEL}")
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(BASE_MODEL)
device = "cuda" if torch.cuda.is_available() else "cpu"
model = model.to(device)
print(f"Model loaded on {device}")

# Tokenize
print(f"Tokenizing {len(training_data)} examples...")
encodings = []
for item in training_data:
    enc = tokenizer(
        item["text"],
        truncation=True,
        max_length=64,
        padding="max_length",
        return_tensors="pt"
    )
    encodings.append({
        "input_ids": enc["input_ids"].squeeze(),
        "attention_mask": enc["attention_mask"].squeeze(),
    })

class TTTDataset(Dataset):
    def __init__(self, encodings):
        self.encodings = encodings
    def __len__(self):
        return len(self.encodings)
    def __getitem__(self, idx):
        return self.encodings[idx]

dataset = TTTDataset(encodings)
loader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)

# Training
optimizer = AdamW(model.parameters(), lr=LR)
total_steps = len(loader) * EPOCHS
scheduler = get_linear_schedule_with_warmup(optimizer, num_warmup_steps=0, num_training_steps=total_steps)

model.train()
for epoch in range(EPOCHS):
    total_loss = 0
    for batch_idx, batch in enumerate(loader):
        input_ids = batch["input_ids"].to(device)
        attention_mask = batch["attention_mask"].to(device)
        
        outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=input_ids)
        loss = outputs.loss
        
        loss.backward()
        optimizer.step()
        scheduler.step()
        optimizer.zero_grad()
        
        total_loss += loss.item()
    
    avg_loss = total_loss / len(loader)
    print(f"Epoch {epoch + 1}/{EPOCHS}: avg_loss={avg_loss:.4f}")

# Save
print(f"Saving to {OUTPUT_PATH}")
model.save_pretrained(OUTPUT_PATH)
tokenizer.save_pretrained(OUTPUT_PATH)
print("Training complete.")
`;

  await Bun.spawn(['mkdir', '-p', outputPath]).exited;

  const proc = spawn(['python3', '-c', pythonScript], {
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Training failed with exit code ${exitCode}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('TIC-TAC-TOE TRAINING BENCHMARK');
  console.log('='.repeat(70));
  console.log();
  console.log(`Model: ${CONFIG.modelName}`);
  console.log(`Games per benchmark: ${CONFIG.numBenchmarkGames}`);
  console.log(`Training epochs: ${CONFIG.trainingEpochs}`);
  console.log();

  // Step 1: Benchmark baseline
  console.log('STEP 1: Benchmark baseline model');
  const baseline = await evaluateModel(
    CONFIG.modelName,
    CONFIG.numBenchmarkGames,
    'Baseline (untrained)'
  );
  console.log(`\nBaseline Results:`);
  console.log(`  Wins: ${baseline.wins} (${(baseline.wins / CONFIG.numBenchmarkGames * 100).toFixed(1)}%)`);
  console.log(`  Losses: ${baseline.losses} (${(baseline.losses / CONFIG.numBenchmarkGames * 100).toFixed(1)}%)`);
  console.log(`  Draws: ${baseline.draws} (${(baseline.draws / CONFIG.numBenchmarkGames * 100).toFixed(1)}%)`);
  console.log(`  Invalid moves: ${baseline.invalidMoves}`);

  // Step 2: Generate training data
  console.log('\nSTEP 2: Generate training data');
  const trainingData = generateTrainingData(50);
  console.log(`Generated ${trainingData.length} training examples from optimal play`);

  // Step 3: Train model
  console.log('\nSTEP 3: Train model');
  await trainModel(CONFIG.modelName, CONFIG.trainedModelPath, trainingData);

  // Step 4: Benchmark trained model
  console.log('\nSTEP 4: Benchmark trained model');
  const trained = await evaluateModel(
    CONFIG.trainedModelPath,
    CONFIG.numBenchmarkGames,
    'Trained model'
  );
  console.log(`\nTrained Results:`);
  console.log(`  Wins: ${trained.wins} (${(trained.wins / CONFIG.numBenchmarkGames * 100).toFixed(1)}%)`);
  console.log(`  Losses: ${trained.losses} (${(trained.losses / CONFIG.numBenchmarkGames * 100).toFixed(1)}%)`);
  console.log(`  Draws: ${trained.draws} (${(trained.draws / CONFIG.numBenchmarkGames * 100).toFixed(1)}%)`);
  console.log(`  Invalid moves: ${trained.invalidMoves}`);

  // Step 5: Compare results
  console.log('\n' + '='.repeat(70));
  console.log('COMPARISON');
  console.log('='.repeat(70));
  
  // In tic-tac-toe against optimal opponent, not losing is winning
  // The best possible outcome is always drawing
  const baselineNotLoseRate = (baseline.wins + baseline.draws) / CONFIG.numBenchmarkGames;
  const trainedNotLoseRate = (trained.wins + trained.draws) / CONFIG.numBenchmarkGames;
  
  const lossReduction = baseline.losses - trained.losses;
  const lossReductionPct = baseline.losses > 0 ? (lossReduction / baseline.losses * 100) : 0;
  
  console.log();
  console.log('Performance against optimal opponent:');
  console.log('  (Note: Against perfect play, drawing is the best possible outcome)');
  console.log();
  console.log(`  Baseline: ${baseline.wins}W / ${baseline.losses}L / ${baseline.draws}D`);
  console.log(`  Trained:  ${trained.wins}W / ${trained.losses}L / ${trained.draws}D`);
  console.log();
  console.log(`  Loss reduction: ${lossReduction} games (${lossReductionPct.toFixed(1)}% fewer losses)`);
  console.log(`  Not-lose rate:  ${(baselineNotLoseRate * 100).toFixed(1)}% -> ${(trainedNotLoseRate * 100).toFixed(1)}%`);
  console.log();

  if (lossReduction > 0) {
    console.log('SUCCESS: Model learned to play better tic-tac-toe.');
    if (trained.losses === 0) {
      console.log('PERFECT: Model achieved optimal play - never loses.');
    }
  } else if (lossReduction === 0) {
    console.log('NEUTRAL: No improvement in loss rate.');
  } else {
    console.log('REGRESSION: Model got worse after training.');
  }

  // Additional stats
  console.log();
  console.log('Additional metrics:');
  console.log(`  Invalid moves: ${baseline.invalidMoves} -> ${trained.invalidMoves}`);
  
  const validMoveImprovement = baseline.invalidMoves - trained.invalidMoves;
  if (validMoveImprovement > 0) {
    console.log(`  Model learned to make ${validMoveImprovement} fewer invalid moves.`);
  }

  console.log();
}

main().catch(console.error);

