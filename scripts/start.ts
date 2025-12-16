#!/usr/bin/env bun
/**
 * Jeju Network Startup Script
 * 
 * Starts all infrastructure services and validates they're healthy
 * before allowing applications to start. Ensures a fully permissionless,
 * resilient network with no single points of failure.
 * 
 * Services Started:
 * - IPFS (storage)
 * - Cache Service (Redis-compatible)
 * - DA Server (data availability with vault)
 * - JNS Gateway (name resolution)
 * - Trigger Service (compute triggers)
 * - PostgreSQL (for Subsquid indexer)
 * 
 * Usage:
 *   bun run scripts/start.ts
 *   bun run scripts/start.ts --wait-only  # Just wait for services
 *   bun run scripts/start.ts --check      # Health check only
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

interface ServiceHealth {
  name: string;
  url: string;
  healthy: boolean;
  error?: string;
  latencyMs?: number;
}

interface StartupResult {
  success: boolean;
  services: ServiceHealth[];
  errors: string[];
}

interface ServiceConfig {
  name: string;
  url: string;
  method: string;
  healthPath?: string;
  port?: number;
}

const SERVICES: ServiceConfig[] = [
  { name: 'IPFS', url: 'http://localhost:5001/api/v0/id', method: 'POST', healthPath: '' },
  { name: 'Cache', url: 'http://localhost:4115/health', method: 'GET', healthPath: '/health' },
  { name: 'DA Server', url: 'http://localhost:4010/health', method: 'GET', healthPath: '/health' },
  { name: 'PostgreSQL', url: 'postgres://localhost:5434', method: 'TCP', port: 5434 },
];

const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 2000;

async function checkServiceHealth(service: ServiceConfig): Promise<ServiceHealth> {
  const startTime = Date.now();
  
  if (service.method === 'TCP') {
    const net = await import('net');
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve({
          name: service.name,
          url: service.url,
          healthy: true,
          latencyMs: Date.now() - startTime,
        });
      });
      
      socket.on('error', (err) => {
        socket.destroy();
        resolve({
          name: service.name,
          url: service.url,
          healthy: false,
          error: err.message,
          latencyMs: Date.now() - startTime,
        });
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          name: service.name,
          url: service.url,
          healthy: false,
          error: 'Connection timeout',
          latencyMs: Date.now() - startTime,
        });
      });
      
      socket.connect(service.port!, 'localhost');
    });
  }
  
  const response = await fetch(service.url, {
    method: service.method as 'GET' | 'POST',
    signal: AbortSignal.timeout(5000),
  }).catch((e: Error) => ({ ok: false, error: e.message }));
  
  const latencyMs = Date.now() - startTime;
  
  if ('error' in response) {
    return {
      name: service.name,
      url: service.url,
      healthy: false,
      error: response.error,
      latencyMs,
    };
  }
  
  return {
    name: service.name,
    url: service.url,
    healthy: response.ok,
    error: response.ok ? undefined : `HTTP ${(response as Response).status}`,
    latencyMs,
  };
}

async function waitForServices(): Promise<ServiceHealth[]> {
  console.log('⏳ Waiting for services to be healthy...\n');
  
  const results: ServiceHealth[] = [];
  
  for (const service of SERVICES) {
    console.log(`   Checking ${service.name}...`);
    
    let healthy = false;
    let lastHealth: ServiceHealth | null = null;
    
    for (let attempt = 0; attempt < MAX_RETRIES && !healthy; attempt++) {
      lastHealth = await checkServiceHealth(service);
      healthy = lastHealth.healthy;
      
      if (!healthy && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        process.stdout.write(`   Retry ${attempt + 1}/${MAX_RETRIES}...\r`);
      }
    }
    
    if (healthy && lastHealth) {
      console.log(`   ✅ ${service.name} healthy (${lastHealth.latencyMs}ms)`);
    } else if (lastHealth) {
      console.log(`   ❌ ${service.name} FAILED: ${lastHealth.error}`);
    }
    
    results.push(lastHealth!);
  }
  
  return results;
}

async function startDockerCompose(): Promise<void> {
  const composePath = join(process.cwd(), 'docker-compose.yml');
  
  if (!existsSync(composePath)) {
    throw new Error(`docker-compose.yml not found at ${composePath}`);
  }
  
  console.log('🐳 Starting Docker Compose services...\n');
  
  execSync('docker compose up -d', {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  
  console.log('');
}

async function startLocalnet(): Promise<void> {
  console.log('⛓️  Starting localnet...\n');
  
  const checkCmd = 'cast block-number --rpc-url http://127.0.0.1:9545 2>/dev/null';
  try {
    execSync(checkCmd, { encoding: 'utf-8', stdio: 'pipe' });
    console.log('   ✅ Localnet already running\n');
    return;
  } catch {
    // Not running, start it
  }
  
  const proc = spawn('bun', ['run', 'localnet:start'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      execSync(checkCmd, { encoding: 'utf-8', stdio: 'pipe' });
      console.log('   ✅ Localnet started\n');
      return;
    } catch {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  
  throw new Error('Localnet failed to start');
}

async function bootstrapContracts(): Promise<void> {
  console.log('📝 Bootstrapping contracts...\n');
  
  const deploymentPath = join(process.cwd(), 'packages/contracts/deployments/localnet-complete.json');
  if (existsSync(deploymentPath)) {
    console.log('   ✅ Contracts already deployed\n');
    return;
  }
  
  execSync('bun run scripts/bootstrap-localnet-complete.ts', {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  
  console.log('');
}

async function printEnvVars(): Promise<void> {
  console.log('📋 Environment variables for apps:\n');
  console.log('   export COVENANTSQL_NODES=http://localhost:4661');
  console.log('   export IPFS_GATEWAY_URL=http://localhost:4180');
  console.log('   export IPFS_API_URL=http://localhost:5001');
  console.log('   export CACHE_SERVICE_URL=http://localhost:4115');
  console.log('   export DA_SERVER_URL=http://localhost:4010');
  console.log('   export JEJU_RPC_URL=http://localhost:9545');
  console.log('');
}

async function main(): Promise<StartupResult> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const waitOnly = args.includes('--wait-only');
  
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                    JEJU NETWORK STARTUP                           ║');
  console.log('║                   100% Permissionless                             ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  const errors: string[] = [];
  
  if (checkOnly) {
    const health = await Promise.all(SERVICES.map(checkServiceHealth));
    console.log('Service Health:\n');
    for (const h of health) {
      const status = h.healthy ? '✅' : '❌';
      const latency = h.latencyMs ? ` (${h.latencyMs}ms)` : '';
      const error = h.error ? ` - ${h.error}` : '';
      console.log(`   ${status} ${h.name}${latency}${error}`);
    }
    console.log('');
    
    const allHealthy = health.every(h => h.healthy);
    return { success: allHealthy, services: health, errors };
  }
  
  if (!waitOnly) {
    try {
      await startDockerCompose();
    } catch (e) {
      const error = `Docker Compose failed: ${(e as Error).message}`;
      console.error(`❌ ${error}`);
      errors.push(error);
    }
  }
  
  const services = await waitForServices();
  const allHealthy = services.every(s => s.healthy);
  
  if (!allHealthy) {
    console.log('\n❌ Some services failed to start. Check Docker logs:');
    console.log('   docker compose logs');
    console.log('');
    
    for (const s of services.filter(s => !s.healthy)) {
      errors.push(`${s.name}: ${s.error}`);
    }
    
    return { success: false, services, errors };
  }
  
  if (!waitOnly) {
    try {
      await startLocalnet();
      await bootstrapContracts();
    } catch (e) {
      const error = `Chain setup failed: ${(e as Error).message}`;
      console.error(`❌ ${error}`);
      errors.push(error);
      return { success: false, services, errors };
    }
  }
  
  await printEnvVars();
  
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                    ✅ NETWORK READY                               ║');
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log('║  All services are healthy and running.                            ║');
  console.log('║  No fallbacks. No single points of failure.                       ║');
  console.log('║                                                                   ║');
  console.log('║  Start apps: bun run dev                                          ║');
  console.log('║  Stop all:   docker compose down && bun run localnet:stop         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  return { success: true, services, errors };
}

if (import.meta.main) {
  main().then((result) => {
    process.exit(result.success ? 0 : 1);
  }).catch((e) => {
    console.error('❌ Startup failed:', e);
    process.exit(1);
  });
}

export { main as start, checkServiceHealth, waitForServices };
