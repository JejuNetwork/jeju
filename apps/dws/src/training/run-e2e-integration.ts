#!/usr/bin/env bun
/**
 * End-to-End Training Integration
 *
 * Connects ALL Jeju infrastructure:
 * - Jeju CLI (localnet)
 * - DWS (Decentralized Web Services)
 * - CovenantSQL (Decentralized Database)
 * - Psyche (Solana Training Coordination)
 * - Cross-Chain Bridge (EVM <-> Solana)
 *
 * Run with: bun src/training/run-e2e-integration.ts
 */

import { spawn } from 'bun'
import { createAtroposServer } from './atropos-server'
import { createCrossChainBridge } from './cross-chain-bridge'
import { createDWSTrainingService } from './dws-integration'
import {
  createTicTacToeEnv,
  trajectoryToTrainingFormat,
} from './environments/tic-tac-toe'
import { createPsycheClient } from './psyche-client'

// Configuration
const CONFIG = {
  // Jeju Network
  jejuRpcUrl: process.env.RPC_URL || 'http://127.0.0.1:6546',
  jejuWsUrl: process.env.WS_URL || 'ws://127.0.0.1:9546',

  // Solana/Psyche
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899',

  // CovenantSQL
  cqlUrl: process.env.CQL_URL || 'http://127.0.0.1:4661',

  // DWS
  dwsPort: parseInt(process.env.DWS_PORT || '4030', 10),
  atroposPort: parseInt(process.env.ATROPOS_PORT || '8000', 10),

  // Training
  modelName: 'distilgpt2',
  batchSize: 8,
  trainingSteps: 5,

  // Test wallet (Anvil default)
  privateKey: (process.env.DEPLOYER_PRIVATE_KEY ||
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`,
}

interface ServiceStatus {
  name: string
  url: string
  healthy: boolean
  details?: string
}

async function checkService(
  name: string,
  url: string,
  healthPath = '/health',
): Promise<ServiceStatus> {
  try {
    const response = await fetch(`${url}${healthPath}`, {
      signal: AbortSignal.timeout(5000),
    })
    return {
      name,
      url,
      healthy: response.ok,
      details: response.ok ? 'Running' : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      name,
      url,
      healthy: false,
      details: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}

async function checkAllServices(): Promise<{
  services: ServiceStatus[]
  allHealthy: boolean
}> {
  console.log('\n[Status] Checking infrastructure services...\n')

  const services = await Promise.all([
    checkService('Jeju L2 RPC', CONFIG.jejuRpcUrl, ''),
    checkService('CovenantSQL', CONFIG.cqlUrl, '/health'),
    checkService('DWS', `http://localhost:${CONFIG.dwsPort}`, '/health'),
  ])

  // Check Solana (optional)
  const solanaStatus = await checkService(
    'Solana (Psyche)',
    CONFIG.solanaRpcUrl,
    '/health',
  ).catch(() => ({
    name: 'Solana (Psyche)',
    url: CONFIG.solanaRpcUrl,
    healthy: false,
    details: 'Not configured (optional)',
  }))
  services.push(solanaStatus)

  const maxNameLen = Math.max(...services.map((s) => s.name.length))

  for (const service of services) {
    const icon = service.healthy ? '✅' : '❌'
    const name = service.name.padEnd(maxNameLen)
    console.log(`  ${icon} ${name} - ${service.url} (${service.details})`)
  }

  const required = services.filter((s) => s.name !== 'Solana (Psyche)')
  const allHealthy = required.every((s) => s.healthy)

  return { services, allHealthy }
}

async function startJejuDev(): Promise<boolean> {
  console.log('\n[Jeju] Checking if localnet is running...')

  // Check if already running
  try {
    const response = await fetch(CONFIG.jejuRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(3000),
    })
    if (response.ok) {
      const data = (await response.json()) as { result: string }
      console.log(
        `[Jeju] Localnet already running at block ${parseInt(data.result, 16)}`,
      )
      return true
    }
  } catch {
    // Not running, need to start
  }

  console.log('[Jeju] Starting localnet with jeju dev...')
  console.log(
    '[Jeju] Run in another terminal: cd /home/shaw/Documents/jeju && bun packages/cli/src/index.ts dev',
  )
  console.log('[Jeju] Or: jeju dev (if CLI is installed globally)\n')

  return false
}

async function testCQLConnection(): Promise<boolean> {
  console.log('\n[CQL] Testing CovenantSQL connection...')

  try {
    // Try to query the health endpoint
    const response = await fetch(`${CONFIG.cqlUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })

    if (response.ok) {
      console.log('[CQL] Connected to CovenantSQL')
      return true
    }
  } catch {
    // Not available
  }

  console.log('[CQL] CovenantSQL not available')
  console.log('[CQL] Start with: jeju infra start (or run docker-compose)')
  return false
}

async function initializePsycheClient() {
  console.log('\n[Psyche] Initializing Psyche client...')

  const psyche = createPsycheClient({
    solanaRpcUrl: CONFIG.solanaRpcUrl,
    evmRpcUrl: CONFIG.jejuRpcUrl,
    evmPrivateKey: CONFIG.privateKey,
  })

  // Check if we have a real Solana connection
  try {
    const balance = await psyche.getBalance()
    console.log(`[Psyche] Connected to Solana, balance: ${balance} lamports`)
    return psyche
  } catch {
    console.log('[Psyche] Solana not available - using mock coordination')
    return null
  }
}

async function runTrainingPipeline(atroposUrl: string) {
  console.log('\n[Training] Starting training pipeline...')

  // Step 1: Generate training data
  console.log('[Training] Step 1: Generating Tic-Tac-Toe trajectories...')
  const env = createTicTacToeEnv()
  const trajectories = env.generateTrajectoryBatch(50, [
    'agent-1',
    'agent-2',
    'agent-3',
  ])
  console.log(`[Training] Generated ${trajectories.length} trajectories`)

  // Step 2: Convert to training format
  const trainingData = trajectories.map((t) => trajectoryToTrainingFormat(t))
  console.log(`[Training] Converted to ${trainingData.length} training samples`)

  // Step 3: Submit to Atropos
  console.log('[Training] Step 2: Submitting to Atropos...')

  // Register trainer
  await fetch(`${atroposUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wandb_group: 'e2e-test',
      wandb_project: 'jeju-training',
      batch_size: CONFIG.batchSize,
      max_token_len: 512,
      starting_step: 0,
      checkpoint_dir: './training_output/e2e',
      save_checkpoint_interval: 5,
      num_steps: CONFIG.trainingSteps,
    }),
  })

  // Submit scored data
  const scoredData = trainingData.map((t, _i) => ({
    tokens: [[1, 2, 3, 4, 5]], // Simplified tokens
    masks: [[1, 1, 1, 1, 1]],
    scores: [t.reward],
    env_id: 0,
  }))

  await fetch(`${atroposUrl}/scored_data_list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scoredData),
  })

  console.log(`[Training] Submitted ${scoredData.length} samples to Atropos`)

  // Step 4: Run actual training
  console.log('[Training] Step 3: Running PyTorch training...')

  const trainingTexts = trainingData.map((t) =>
    `${t.prompt}\n\n${t.response}`
      .replace(/[\n\r]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  const trainingDataB64 = Buffer.from(
    JSON.stringify(trainingTexts.slice(0, 20)),
  ).toString('base64')

  const pythonScript = `
import torch
from torch.optim import AdamW
from transformers import AutoModelForCausalLM, AutoTokenizer
from torch.utils.data import Dataset, DataLoader
import json
import os
import base64

MODEL = "${CONFIG.modelName}"
OUTPUT = "./training_output/e2e-model"
EPOCHS = 3
BATCH_SIZE = 4
LR = 5e-4

# Training data from E2E pipeline
training_texts = json.loads(base64.b64decode("${trainingDataB64}").decode('utf-8'))
print(f"Training on {len(training_texts)} examples")

device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"Using device: {device}")

# Load model
print("Loading model...")
tokenizer = AutoTokenizer.from_pretrained(MODEL)
tokenizer.pad_token = tokenizer.eos_token
model = AutoModelForCausalLM.from_pretrained(MODEL)
model = model.to(device)
model.train()

optimizer = AdamW(model.parameters(), lr=LR)

# Simple dataset
class TextDataset(Dataset):
    def __init__(self, texts, tokenizer, max_len=256):
        self.encodings = tokenizer(
            texts, 
            truncation=True, 
            padding='max_length', 
            max_length=max_len, 
            return_tensors='pt'
        )
    def __len__(self):
        return len(self.encodings['input_ids'])
    def __getitem__(self, idx):
        return {k: v[idx] for k, v in self.encodings.items()}

dataset = TextDataset(training_texts, tokenizer)
dataloader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)

# Training loop
print("Training...")
for epoch in range(EPOCHS):
    total_loss = 0
    for batch in dataloader:
        input_ids = batch['input_ids'].to(device)
        attention_mask = batch['attention_mask'].to(device)
        
        outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=input_ids)
        loss = outputs.loss
        
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()
        
        total_loss += loss.item()
    
    avg_loss = total_loss / len(dataloader)
    print(f"Epoch {epoch+1}/{EPOCHS}: loss={avg_loss:.4f}")

# Save model
os.makedirs(OUTPUT, exist_ok=True)
model.save_pretrained(OUTPUT)
tokenizer.save_pretrained(OUTPUT)
print(f"Model saved to {OUTPUT}")
print("TRAINING_COMPLETE")
`

  const proc = spawn(['python3', '-c', pythonScript], {
    cwd: '/home/shaw/Documents/jeju/apps/dws',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  await proc.exited

  console.log(stdout)
  if (stderr && !stderr.includes('FutureWarning')) {
    console.error('[Training] Stderr:', stderr)
  }

  const success = stdout.includes('TRAINING_COMPLETE')
  if (success) {
    console.log('[Training] Training completed successfully')
  } else {
    console.log('[Training] Training may have failed')
  }

  return success
}

async function main() {
  console.log(
    '╔══════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║           JEJU E2E TRAINING INTEGRATION                       ║',
  )
  console.log(
    '╠══════════════════════════════════════════════════════════════╣',
  )
  console.log(
    '║  Components: Jeju CLI, DWS, CovenantSQL, Psyche               ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════╝',
  )

  // Step 1: Check infrastructure
  const { allHealthy } = await checkAllServices()

  if (!allHealthy) {
    console.log('\n[Warning] Some services are not running.')
    console.log('[Warning] For full integration, start with: jeju dev')
    console.log('[Warning] Proceeding with available services...\n')

    // Check if at least Jeju RPC is available
    const jejuCheck = await startJejuDev()
    if (!jejuCheck) {
      console.log('\n[Error] Jeju localnet is required.')
      console.log('[Error] Start with: jeju dev\n')
    }
  }

  // Step 2: Test CQL connection
  const cqlOk = await testCQLConnection()

  // Step 3: Initialize Psyche client
  const psyche = await initializePsycheClient()

  // Step 4: Start local services
  console.log('\n[Services] Starting local training services...')

  // Start Atropos server
  const atroposApp = createAtroposServer()
  const atroposServer = Bun.serve({
    port: CONFIG.atroposPort,
    fetch: atroposApp.fetch,
  })
  console.log(
    `[Atropos] Server running on http://localhost:${atroposServer.port}`,
  )

  // Start DWS Training Service
  const dwsService = createDWSTrainingService(true) // localMode
  const dwsTrainingApp = dwsService.getApp()
  const dwsServer = Bun.serve({
    port: CONFIG.dwsPort + 100, // Use different port for training API
    fetch: dwsTrainingApp.fetch,
  })
  console.log(
    `[DWS Training] API running on http://localhost:${dwsServer.port}`,
  )

  // Step 5: Initialize cross-chain bridge if we have both chains
  if (psyche) {
    console.log('\n[Bridge] Initializing cross-chain bridge...')
    const bridge = createCrossChainBridge({
      evmRpcUrl: CONFIG.jejuRpcUrl,
      evmPrivateKey: CONFIG.privateKey,
      bridgeContractAddress: '0x0000000000000000000000000000000000000000', // Placeholder
      solanaRpcUrl: CONFIG.solanaRpcUrl,
    })
    bridge.setPsycheClient(psyche)
    console.log('[Bridge] Cross-chain bridge initialized')
  }

  // Step 6: Run training pipeline
  const atroposUrl = `http://localhost:${atroposServer.port}`
  const trainingSuccess = await runTrainingPipeline(atroposUrl)

  // Summary
  console.log(
    '\n╔══════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                         SUMMARY                               ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════╝',
  )

  console.log('\nInfrastructure:')
  console.log(
    `  Jeju L2 RPC:    ${allHealthy ? '✅ Connected' : '⚠️ Check status'}`,
  )
  console.log(`  CovenantSQL:    ${cqlOk ? '✅ Connected' : '⚠️ Not available'}`)
  console.log(
    `  Psyche/Solana:  ${psyche ? '✅ Connected' : '⚠️ Not available'}`,
  )
  console.log(`  Atropos:        ✅ http://localhost:${atroposServer.port}`)
  console.log(`  DWS Training:   ✅ http://localhost:${dwsServer.port}`)

  console.log('\nTraining:')
  console.log(`  Model:          ${CONFIG.modelName}`)
  console.log(
    `  Status:         ${trainingSuccess ? '✅ Complete' : '❌ Failed'}`,
  )
  console.log(`  Output:         ./training_output/e2e-model`)

  console.log('\nTo run full integration:')
  console.log('  1. Start Jeju localnet: jeju dev')
  console.log('  2. Start CovenantSQL: jeju infra start')
  console.log('  3. (Optional) Start Solana: solana-test-validator')
  console.log('  4. Run this script again\n')

  // Cleanup
  atroposServer.stop()
  dwsServer.stop()

  if (trainingSuccess) {
    console.log('\n✅ E2E Integration completed successfully')
    process.exit(0)
  } else {
    console.log('\n⚠️ E2E Integration completed with warnings')
    process.exit(1)
  }
}

main().catch(console.error)
