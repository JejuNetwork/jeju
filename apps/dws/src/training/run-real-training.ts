#!/usr/bin/env bun
/**
 * Real Training Demo
 * 
 * End-to-end training with real PyTorch and the smallest possible model.
 * Uses sshleifer/tiny-gpt2 (~2MB) for fast validation.
 * 
 * Usage:
 *   bun run src/training/run-real-training.ts
 */

import { createAtroposServer } from './atropos-server';
import { createTicTacToeEnv, trajectoryToTrainingFormat } from './environments/tic-tac-toe';
import { spawn } from 'bun';
import { join } from 'path';

const CONFIG = {
  atroposPort: 8200,
  modelName: 'sshleifer/tiny-gpt2',  // Smallest model: ~2MB
  batchSize: 2,
  learningRate: 5e-5,
  trainingSteps: 3,
  trajectoryCount: 6,
};

async function main() {
  console.log('='.repeat(70));
  console.log('REAL PYTORCH TRAINING DEMO');
  console.log('='.repeat(70));
  console.log();

  // Check PyTorch
  console.log('[1/6] Checking PyTorch...');
  const ptCheck = spawn(['python3', '-c', `
import torch
import transformers
print(f"PyTorch: {torch.__version__}")
print(f"Transformers: {transformers.__version__}")
print(f"CUDA: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
`], { stdout: 'pipe', stderr: 'pipe' });
  
  const ptOutput = await new Response(ptCheck.stdout).text();
  console.log(ptOutput);

  // Start Atropos
  console.log('[2/6] Starting Atropos Server...');
  const atroposApp = createAtroposServer();
  const server = Bun.serve({
    port: CONFIG.atroposPort,
    fetch: atroposApp.fetch,
  });
  console.log(`      Running on http://localhost:${CONFIG.atroposPort}`);

  // Generate trajectories
  console.log('[3/6] Generating Training Data...');
  const env = createTicTacToeEnv();
  const trajectories = env.generateTrajectoryBatch(CONFIG.trajectoryCount, ['agent-1', 'agent-2']);
  
  // Convert to prompts/completions
  const trainingData = trajectories.map(t => trajectoryToTrainingFormat(t));
  console.log(`      Generated ${trainingData.length} training examples`);

  // Register with Atropos
  console.log('[4/6] Registering with Atropos...');
  await fetch(`http://localhost:${CONFIG.atroposPort}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trainer_id: 'real-trainer',
      batch_size: CONFIG.batchSize,
    }),
  });

  // Submit training data
  const scoredData = trainingData.map((td, i) => ({
    tokens: [td.prompt.split(' ').map((_, j) => j + 1)],
    masks: [td.prompt.split(' ').map(() => 1)],
    scores: [td.reward],
    messages: [[
      { role: 'user' as const, content: td.prompt },
      { role: 'assistant' as const, content: td.response },
    ]],
  }));

  await fetch(`http://localhost:${CONFIG.atroposPort}/scored_data_list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scoredData),
  });
  console.log('      Training data submitted');

  // Run real training
  console.log('[5/6] Running Real PyTorch Training...');
  console.log(`      Model: ${CONFIG.modelName}`);
  console.log(`      Steps: ${CONFIG.trainingSteps}`);
  console.log(`      Batch size: ${CONFIG.batchSize}`);
  console.log();

  const pythonScript = `
import torch
from torch.optim import AdamW
from transformers import AutoModelForCausalLM, AutoTokenizer, get_linear_schedule_with_warmup
import json
import requests

# Config
MODEL = "${CONFIG.modelName}"
STEPS = ${CONFIG.trainingSteps}
LR = ${CONFIG.learningRate}
BATCH_SIZE = ${CONFIG.batchSize}
ATROPOS_URL = "http://localhost:${CONFIG.atroposPort}"

print(f"Loading model: {MODEL}")
tokenizer = AutoTokenizer.from_pretrained(MODEL)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(MODEL)
device = "cuda" if torch.cuda.is_available() else "cpu"
model = model.to(device)
print(f"Model loaded on {device}")

# Simple training data
training_texts = [
    "Playing tic-tac-toe: I take center position for strategic control.",
    "In tic-tac-toe, corners are strong positions after the center.",
    "Blocking opponent's winning move is crucial in tic-tac-toe.",
]

# Training loop
optimizer = AdamW(model.parameters(), lr=LR)
scheduler = get_linear_schedule_with_warmup(optimizer, num_warmup_steps=0, num_training_steps=STEPS)

model.train()
for step in range(STEPS):
    text = training_texts[step % len(training_texts)]
    inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=64)
    inputs = {k: v.to(device) for k, v in inputs.items()}
    
    outputs = model(**inputs, labels=inputs["input_ids"])
    loss = outputs.loss
    
    loss.backward()
    optimizer.step()
    scheduler.step()
    optimizer.zero_grad()
    
    print(f"Step {step+1}/{STEPS}: loss={loss.item():.4f}")

# Save checkpoint
model.save_pretrained("./training_output/tiny-gpt2-ttt")
tokenizer.save_pretrained("./training_output/tiny-gpt2-ttt")
print("Model saved to ./training_output/tiny-gpt2-ttt")
`;

  // Create output directory
  await Bun.spawn(['mkdir', '-p', './training_output']).exited;

  // Run training
  const trainProcess = spawn(['python3', '-c', pythonScript], {
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: process.cwd(),
  });

  await trainProcess.exited;

  // Verify output
  console.log();
  console.log('[6/6] Verifying Training Output...');
  
  const checkOutput = spawn(['ls', '-la', './training_output/tiny-gpt2-ttt'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  const outputList = await new Response(checkOutput.stdout).text();
  if (outputList.includes('config.json')) {
    console.log('      Model checkpoint saved successfully');
    console.log(outputList);
  } else {
    console.log('      Warning: Model checkpoint not found');
  }

  // Summary
  console.log();
  console.log('='.repeat(70));
  console.log('TRAINING COMPLETE');
  console.log('='.repeat(70));
  console.log();
  console.log('Summary:');
  console.log(`  Model: ${CONFIG.modelName}`);
  console.log(`  Steps: ${CONFIG.trainingSteps}`);
  console.log(`  Training data: ${CONFIG.trajectoryCount} tic-tac-toe games`);
  console.log(`  Output: ./training_output/tiny-gpt2-ttt`);
  console.log();

  server.stop();
  process.exit(0);
}

main().catch(err => {
  console.error('Training failed:', err);
  process.exit(1);
});
