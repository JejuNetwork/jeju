#!/usr/bin/env bun
/**
 * Distributed Training Demo
 * 
 * Runs a complete distributed training demo with:
 * - Atropos server for coordination
 * - vLLM for inference
 * - Fundamental prediction environment
 * 
 * Uses microsoft/phi-2 (no auth required, 2.7B params)
 */

import { spawn, type Subprocess } from 'bun';
import { createAtroposServer, type ScoredData } from './atropos-server';

// Configuration
const MODEL = 'microsoft/phi-2';
const ATROPOS_PORT = 8000;
const VLLM_PORT = 9001;
const GROUP_SIZE = 4;
const TRAINING_STEPS = 5;

console.log('='.repeat(60));
console.log('Jeju DWS Distributed Training Demo');
console.log('='.repeat(60));
console.log(`Model: ${MODEL}`);
console.log(`Training Steps: ${TRAINING_STEPS}`);
console.log(`Group Size: ${GROUP_SIZE}`);
console.log('='.repeat(60));

let atroposServer: ReturnType<typeof Bun.serve> | null = null;
let vllmProcess: Subprocess | null = null;

async function cleanup() {
  console.log('\nCleaning up...');
  if (vllmProcess) {
    vllmProcess.kill();
    await vllmProcess.exited;
  }
  if (atroposServer) {
    atroposServer.stop();
  }
}

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

async function main() {
  try {
    // Step 1: Start Atropos server
    console.log('\n[1/4] Starting Atropos API server...');
    const app = createAtroposServer();
    atroposServer = Bun.serve({
      port: ATROPOS_PORT,
      fetch: app.fetch,
    });
    console.log(`   Atropos running on http://localhost:${ATROPOS_PORT}`);

    // Step 2: Start vLLM
    console.log('\n[2/4] Starting vLLM inference server...');
    console.log(`   Loading model ${MODEL}...`);
    
    vllmProcess = spawn([
      'python3', '-m', 'vllm.entrypoints.openai.api_server',
      '--model', MODEL,
      '--port', String(VLLM_PORT),
      '--dtype', 'float16',
      '--gpu-memory-utilization', '0.7',
      '--max-model-len', '1024',
      '--enforce-eager', // Required for RTX 50 series to avoid triton issues
    ], {
      stdout: 'inherit',
      stderr: 'inherit',
    });

    // Wait for vLLM to be ready (check health endpoint)
    console.log('   Waiting for vLLM to be ready...');
    let ready = false;
    for (let i = 0; i < 180; i++) { // 3 minute timeout
      try {
        const r = await fetch(`http://localhost:${VLLM_PORT}/health`);
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {
        // Not ready yet
      }
      
      // Check if process died
      if (vllmProcess.exitCode !== null) {
        const stderr = await new Response(vllmProcess.stderr).text();
        throw new Error(`vLLM process exited: ${stderr}`);
      }
      
      if (i % 10 === 0) {
        console.log(`   Still loading... (${i}s)`);
      }
      await Bun.sleep(1000);
    }

    if (!ready) {
      throw new Error('vLLM failed to start within 3 minutes');
    }
    console.log(`   vLLM ready on http://localhost:${VLLM_PORT}`);

    // Step 3: Register trainer and environment
    console.log('\n[3/4] Registering with Atropos...');
    
    // Register trainer
    await fetch(`http://localhost:${ATROPOS_PORT}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wandb_group: 'jeju-demo',
        wandb_project: 'distributed-training',
        batch_size: GROUP_SIZE * 4,
        max_token_len: 2048,
        checkpoint_dir: './checkpoints',
        save_checkpoint_interval: 5,
        starting_step: 0,
        num_steps: TRAINING_STEPS,
      }),
    });
    console.log('   Trainer registered');

    // Start training (triggers trainer)
    await fetch(`http://localhost:${ATROPOS_PORT}/batch`);

    // Register environment
    const envRes = await fetch(`http://localhost:${ATROPOS_PORT}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_token_length: 2048,
        desired_name: 'fundamental_prediction',
        weight: 1.0,
        group_size: GROUP_SIZE,
      }),
    });
    const envData = await envRes.json() as { env_id: number };
    console.log(`   Environment registered (ID: ${envData.env_id})`);

    // Step 4: Training loop
    console.log('\n[4/4] Starting distributed training loop...');
    console.log('='.repeat(60));

    const prompts = [
      'Analyze this financial data:\nQ3 Revenue: $45B (+12%)\nNet Income: $8B\nPredict earnings guidance direction.',
      'Given the following:\nRevenue down 5%\nCustomer churn up 3%\nPredict revenue forecast change.',
      'Market conditions:\nGDP growth 2.8%\nInflation 3.2%\nPredict dividend policy.',
    ];

    for (let step = 0; step < TRAINING_STEPS; step++) {
      console.log(`\n--- Training Step ${step + 1}/${TRAINING_STEPS} ---`);

      // Generate completions from vLLM
      const prompt = prompts[step % prompts.length];
      console.log('   Generating rollouts...');

      const completions: string[] = [];
      for (let i = 0; i < GROUP_SIZE; i++) {
        try {
          const response = await fetch(`http://localhost:${VLLM_PORT}/v1/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: MODEL,
              prompt: prompt,
              max_tokens: 256,
              temperature: 0.8,
              n: 1,
            }),
          });

          const data = await response.json() as {
            choices: Array<{ text: string }>;
          };
          completions.push(data.choices[0].text);
        } catch (e) {
          console.log(`   Warning: Completion ${i} failed, using placeholder`);
          completions.push('Unable to generate prediction.');
        }
      }

      // Score completions (simple heuristic for demo)
      const scores = completions.map((c) => {
        // Simple scoring: longer responses with keywords get higher scores
        let score = 0;
        if (c.includes('raised') || c.includes('increase')) score += 0.5;
        if (c.includes('reduced') || c.includes('decrease')) score += 0.3;
        if (c.includes('maintained') || c.includes('stable')) score += 0.2;
        if (c.length > 100) score += 0.3;
        if (c.length > 200) score += 0.2;
        return score > 0.5 ? 1.0 : -1.0;
      });

      // Submit scored data
      const scoredData: ScoredData = {
        tokens: completions.map((c) => 
          Array.from(new TextEncoder().encode(c.slice(0, 100)))
        ),
        masks: completions.map((c) => {
          const len = Math.min(c.length, 100);
          return Array(len).fill(0).map((_, i) => i < len / 2 ? 0 : -100);
        }),
        scores,
        env_id: envData.env_id,
      };

      await fetch(`http://localhost:${ATROPOS_PORT}/scored_data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scoredData),
      });

      // Log stats
      const posCount = scores.filter(s => s > 0).length;
      console.log(`   Generated ${GROUP_SIZE} completions`);
      console.log(`   Positive: ${posCount}, Negative: ${GROUP_SIZE - posCount}`);
      console.log(`   Avg completion length: ${Math.round(completions.reduce((a, c) => a + c.length, 0) / GROUP_SIZE)} chars`);

      // Check queue status
      const status = await fetch(`http://localhost:${ATROPOS_PORT}/status`);
      const statusData = await status.json() as { queue_size: number; current_step: number };
      console.log(`   Queue size: ${statusData.queue_size}, Step: ${statusData.current_step}`);
    }

    // Get final batch
    console.log('\n' + '='.repeat(60));
    console.log('Fetching training batch...');
    const batchRes = await fetch(`http://localhost:${ATROPOS_PORT}/batch`);
    const batchData = await batchRes.json() as { batch: ScoredData[] | null };

    if (batchData.batch) {
      const totalSeqs = batchData.batch.reduce((sum, b) => sum + b.tokens.length, 0);
      console.log(`Got batch with ${totalSeqs} sequences ready for GRPO training`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('DISTRIBUTED TRAINING DEMO COMPLETE');
    console.log('='.repeat(60));
    console.log('\nThis demo showed:');
    console.log('  - Atropos server coordinating rollouts');
    console.log('  - vLLM generating model completions');
    console.log('  - Scoring and batching for GRPO training');
    console.log('  - Ready for distributed training with Psyche integration');
    console.log('\nNext steps:');
    console.log('  - Connect to Psyche network for decentralized coordination');
    console.log('  - Deploy training coordinator contract on Jeju EVM');
    console.log('  - Run actual GRPO training loop with gradient updates');
    console.log('='.repeat(60));

  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error('\nError:', err.message);
  cleanup().then(() => process.exit(1));
});

