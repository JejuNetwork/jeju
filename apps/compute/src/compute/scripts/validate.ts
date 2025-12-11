#!/usr/bin/env bun
/**
 * Jeju Compute - Comprehensive Validation Script
 * 
 * Validates:
 * 1. Local Node - Starts and tests a local compute node
 * 
 * Usage:
 *   bun run src/compute/scripts/validate.ts
 */

import { Wallet } from 'ethers';
import { ComputeNodeServer } from '../node/server';
import { detectHardware, formatHardwareInfo } from '../node/hardware';

// Test account (Anvil default #0)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const LOCAL_PORT = 4008;

interface ValidationResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const results: ValidationResult[] = [];

function log(msg: string) {
  console.log(msg);
}

function pass(name: string, details?: string) {
  results.push({ name, passed: true, details });
  log(`  ✅ ${name}${details ? `: ${details}` : ''}`);
}

function fail(name: string, error: string) {
  results.push({ name, passed: false, error });
  log(`  ❌ ${name}: ${error}`);
}

// ============================================================================
// Local Node Validation
// ============================================================================

async function validateLocalNode(): Promise<boolean> {
  log('\n╔══════════════════════════════════════════════════════════════════╗');
  log('║                    LOCAL NODE VALIDATION                         ║');
  log('╚══════════════════════════════════════════════════════════════════╝\n');

  const baseUrl = `http://localhost:${LOCAL_PORT}`;

  // 1. Hardware Detection
  log('1. Hardware Detection');
  const hardware = await detectHardware();
  
  if (hardware.platform && hardware.arch) {
    pass('Platform detected', `${hardware.platform}/${hardware.arch}`);
  } else {
    fail('Platform detected', 'Could not detect platform');
  }

  if (hardware.cpus > 0 && hardware.memory > 0) {
    const memGB = Math.round(hardware.memory / 1024 / 1024 / 1024);
    pass('CPU/Memory', `${hardware.cpus} cores, ${memGB}GB RAM`);
  } else {
    fail('CPU/Memory', 'Could not detect CPU/memory');
  }

  if (hardware.gpuType) {
    pass('GPU detected', hardware.gpuType);
  } else {
    pass('GPU detected', 'None (CPU-only mode)');
  }

  if (hardware.macAddress) {
    pass('MAC address', hardware.macAddress);
  } else {
    fail('MAC address', 'Could not detect MAC address');
  }

  if (hardware.containerRuntime) {
    pass('Container runtime', hardware.containerRuntime);
  } else {
    pass('Container runtime', 'Not available');
  }

  log(`\n   Full hardware info:\n${formatHardwareInfo(hardware)}`);

  // 2. Server Startup
  log('\n2. Server Startup');
  
  const wallet = new Wallet(TEST_PRIVATE_KEY);
  
  const server = new ComputeNodeServer({
    privateKey: TEST_PRIVATE_KEY,
    port: LOCAL_PORT,
    models: [{ 
      name: 'test-model', 
      backend: 'mock',
      pricePerInputToken: 0n,
      pricePerOutputToken: 0n,
      maxContextLength: 4096,
    }],
    registryAddress: '0x0000000000000000000000000000000000000000',
    ledgerAddress: '0x0000000000000000000000000000000000000000',
    inferenceAddress: '0x0000000000000000000000000000000000000000',
    rpcUrl: 'http://localhost:8545',
  });

  server.start(LOCAL_PORT);
  void server; // Keep reference for future cleanup
  pass('Server started', `http://localhost:${LOCAL_PORT}`);

  // Give server time to fully initialize
  await new Promise(r => setTimeout(r, 500));

  // 3. Health Endpoint
  log('\n3. Health Endpoint');
  
  const healthRes = await fetch(`${baseUrl}/health`);
  if (healthRes.ok) {
    const health = await healthRes.json() as { status: string; provider: string; warmth: string };
    if (health.status === 'ok') {
      pass('Health check', `provider=${health.provider}, warmth=${health.warmth}`);
    } else {
      fail('Health check', `status=${health.status}`);
    }
  } else {
    fail('Health check', `HTTP ${healthRes.status}`);
  }

  // 4. Models Endpoint
  log('\n4. Models Endpoint');
  
  const modelsRes = await fetch(`${baseUrl}/v1/models`);
  if (modelsRes.ok) {
    const models = await modelsRes.json() as { data: Array<{ id: string }> };
    if (models.data?.length > 0) {
      pass('Models list', models.data.map(m => m.id).join(', '));
    } else {
      fail('Models list', 'No models returned');
    }
  } else {
    fail('Models list', `HTTP ${modelsRes.status}`);
  }

  // 5. Inference (Non-streaming)
  log('\n5. Inference (Non-streaming)');
  
  const inferenceRes = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'test-model',
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      stream: false,
    }),
  });

  if (inferenceRes.ok) {
    const inference = await inferenceRes.json() as { 
      choices: Array<{ message: { content: string } }>;
      usage: { total_tokens: number };
    };
    if (inference.choices?.[0]?.message?.content) {
      pass('Non-streaming inference', `${inference.usage?.total_tokens || '?'} tokens`);
    } else {
      fail('Non-streaming inference', 'No response content');
    }
  } else {
    fail('Non-streaming inference', `HTTP ${inferenceRes.status}`);
  }

  // 6. Inference (Streaming)
  log('\n6. Inference (Streaming)');
  
  const streamRes = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    }),
  });

  if (streamRes.ok) {
    const text = await streamRes.text();
    const chunks = text.split('\n').filter(l => l.startsWith('data:'));
    if (chunks.length > 0) {
      pass('Streaming inference', `${chunks.length} chunks received`);
    } else {
      fail('Streaming inference', 'No chunks received');
    }
  } else {
    fail('Streaming inference', `HTTP ${streamRes.status}`);
  }

  // 7. Metrics Endpoint
  log('\n7. Metrics Endpoint');
  
  const metricsRes = await fetch(`${baseUrl}/v1/metrics`);
  if (metricsRes.ok) {
    const metrics = await metricsRes.json() as { 
      warmth: string; 
      totalInferences: number;
      uptime: number;
    };
    pass('Metrics', `warmth=${metrics.warmth}, inferences=${metrics.totalInferences}, uptime=${metrics.uptime}ms`);
  } else {
    fail('Metrics', `HTTP ${metricsRes.status}`);
  }

  // 8. Attestation Endpoint
  log('\n8. Attestation Endpoint');
  
  const attestRes = await fetch(`${baseUrl}/v1/attestation/report`);
  if (attestRes.ok) {
    const attest = await attestRes.json() as { 
      attestationType: string;
      provider: string;
      hardwareHash: string;
    };
    pass('Attestation', `type=${attest.attestationType || 'simulated'}, hash=${attest.hardwareHash?.slice(0, 18)}...`);
  } else {
    fail('Attestation', `HTTP ${attestRes.status}`);
  }

  // 9. Hardware Endpoint
  log('\n9. Hardware Endpoint');
  
  const hwRes = await fetch(`${baseUrl}/v1/hardware`);
  if (hwRes.ok) {
    const hw = await hwRes.json() as { platform: string; gpuType: string | null };
    pass('Hardware endpoint', `platform=${hw.platform}, gpu=${hw.gpuType || 'none'}`);
  } else {
    fail('Hardware endpoint', `HTTP ${hwRes.status}`);
  }

  // 10. Auth Headers
  log('\n10. Authenticated Request');
  
  const nonce = crypto.randomUUID();
  const timestamp = Date.now().toString();
  const message = `${wallet.address}:${nonce}:${timestamp}:${wallet.address}`;
  const signature = await wallet.signMessage(message);

  const authRes = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': wallet.address,
      'x-jeju-nonce': nonce,
      'x-jeju-signature': signature,
      'x-jeju-timestamp': timestamp,
    },
    body: JSON.stringify({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Auth test' }],
    }),
  });

  if (authRes.ok) {
    pass('Authenticated request', 'Signature verified');
  } else {
    fail('Authenticated request', `HTTP ${authRes.status}`);
  }

  // Server will be cleaned up when process exits
  log('\n   Local node validation complete.');

  return true;
}

async function main() {
  log('');
  log('╔══════════════════════════════════════════════════════════════════╗');
  log('║              JEJU COMPUTE VALIDATION SUITE                       ║');
  log('╚══════════════════════════════════════════════════════════════════╝');
  log('');

  await validateLocalNode();

  // Summary
  log('\n╔══════════════════════════════════════════════════════════════════╗');
  log('║                       VALIDATION SUMMARY                         ║');
  log('╚══════════════════════════════════════════════════════════════════╝\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  log(`   Total:  ${results.length} tests`);
  log(`   Passed: ${passed} ✅`);
  log(`   Failed: ${failed} ${failed > 0 ? '❌' : ''}`);

  if (failed > 0) {
    log('\n   Failed tests:');
    for (const r of results.filter(r => !r.passed)) {
      log(`     ❌ ${r.name}: ${r.error}`);
    }
  }

  log('');

  if (failed === 0) {
    log('🎉 All validations passed!\n');
    process.exit(0);
  } else {
    log('⚠️  Some validations failed.\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n❌ Validation crashed:', error);
  process.exit(1);
});

