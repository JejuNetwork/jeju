#!/usr/bin/env bun
/**
 * Local Development Environment Setup
 * 
 * Starts all necessary services for local MEV + LP bot development:
 * - Anvil (EVM local node)
 * - Solana Test Validator
 * - Crucible Bot (with local configuration)
 * 
 * Usage:
 *   bun run scripts/start-local-env.ts
 *   bun run scripts/start-local-env.ts --evm-only
 *   bun run scripts/start-local-env.ts --solana-only
 */

import { spawn, type Subprocess } from 'bun';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ============ Configuration ============

interface LocalEnvConfig {
  // EVM (Anvil)
  anvilPort: number;
  anvilChainId: number;
  anvilBlockTime: number; // seconds, 0 for instant mining
  anvilForkUrl?: string;
  anvilForkBlockNumber?: number;
  
  // Solana
  solanaRpcPort: number;
  solanaFaucetPort: number;
  solanaLedgerDir: string;
  solanaResetLedger: boolean;
  
  // Bot
  botRestPort: number;
  botA2aPort: number;
  botMcpPort: number;
}

const DEFAULT_CONFIG: LocalEnvConfig = {
  anvilPort: 8545,
  anvilChainId: 31337,
  anvilBlockTime: 1,
  solanaRpcPort: 8899,
  solanaFaucetPort: 9900,
  solanaLedgerDir: './test-ledger',
  solanaResetLedger: false,
  botRestPort: 4020,
  botA2aPort: 4021,
  botMcpPort: 4022,
};

// ============ Process Management ============

const processes: Map<string, Subprocess> = new Map();

function cleanup(): void {
  console.log('\n🛑 Shutting down local environment...');
  
  for (const [name, proc] of processes) {
    console.log(`   Stopping ${name}...`);
    proc.kill();
  }
  
  processes.clear();
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

// ============ Anvil (EVM) ============

async function startAnvil(config: LocalEnvConfig): Promise<void> {
  console.log('🔷 Starting Anvil...');
  
  const args = [
    '--port', config.anvilPort.toString(),
    '--chain-id', config.anvilChainId.toString(),
    '--accounts', '10',
    '--balance', '10000',
  ];
  
  if (config.anvilBlockTime > 0) {
    args.push('--block-time', config.anvilBlockTime.toString());
  }
  
  if (config.anvilForkUrl) {
    args.push('--fork-url', config.anvilForkUrl);
    if (config.anvilForkBlockNumber) {
      args.push('--fork-block-number', config.anvilForkBlockNumber.toString());
    }
  }
  
  const proc = spawn(['anvil', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  processes.set('anvil', proc);
  
  // Wait for Anvil to start
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Anvil failed to start')), 10000);
    
    const reader = proc.stdout.getReader();
    const checkReady = async () => {
      const { value } = await reader.read();
      if (value) {
        const text = new TextDecoder().decode(value);
        if (text.includes('Listening on')) {
          clearTimeout(timeout);
          console.log(`   ✅ Anvil running on http://localhost:${config.anvilPort}`);
          resolve();
        } else {
          checkReady();
        }
      }
    };
    checkReady();
  });
}

// ============ Solana Test Validator ============

async function startSolanaValidator(config: LocalEnvConfig): Promise<void> {
  console.log('🟣 Starting Solana Test Validator...');
  
  const args = [
    '--rpc-port', config.solanaRpcPort.toString(),
    '--faucet-port', config.solanaFaucetPort.toString(),
    '--ledger', config.solanaLedgerDir,
    '--quiet',
  ];
  
  if (config.solanaResetLedger) {
    args.push('--reset');
  }
  
  const proc = spawn(['solana-test-validator', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  processes.set('solana-validator', proc);
  
  // Wait for Solana to start
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Solana validator failed to start')), 30000);
    
    const checkReady = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${config.solanaRpcPort}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getHealth',
          }),
        });
        
        const data = await response.json();
        if (data.result === 'ok') {
          clearTimeout(timeout);
          console.log(`   ✅ Solana running on http://localhost:${config.solanaRpcPort}`);
          resolve();
          return;
        }
      } catch {
        // Not ready yet
      }
      
      setTimeout(checkReady, 500);
    };
    
    setTimeout(checkReady, 2000); // Give it a moment to start
  });
}

// ============ Bot Startup ============

async function startBot(config: LocalEnvConfig): Promise<void> {
  console.log('🤖 Starting Unified Bot...');
  
  const env = {
    ...process.env,
    RPC_URL_31337: `http://localhost:${config.anvilPort}`,
    SOLANA_RPC_URL: `http://localhost:${config.solanaRpcPort}`,
    SOLANA_NETWORK: 'localnet',
    BOT_REST_PORT: config.botRestPort.toString(),
    BOT_A2A_PORT: config.botA2aPort.toString(),
    BOT_MCP_PORT: config.botMcpPort.toString(),
  };
  
  // Generate test wallets
  const anvilPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // First Anvil account
  env.EVM_PRIVATE_KEY = anvilPrivateKey;
  
  const proc = spawn(['bun', 'run', 'src/bots/api-server.ts'], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  
  processes.set('bot', proc);
  
  // Wait a moment for the bot to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log(`   ✅ Bot APIs:
      REST: http://localhost:${config.botRestPort}
      A2A:  http://localhost:${config.botA2aPort}
      MCP:  http://localhost:${config.botMcpPort}`);
}

// ============ Deploy Test Contracts ============

async function deployTestContracts(config: LocalEnvConfig): Promise<void> {
  console.log('📜 Deploying test contracts...');
  
  // Deploy Uniswap V2 style DEX for testing
  // This would use forge script or similar
  
  // For now, just log that we would deploy
  console.log('   ⏭️ Skipping contract deployment (use existing deployments or deploy manually)');
}

// ============ Fund Test Accounts ============

async function fundSolanaAccounts(config: LocalEnvConfig): Promise<void> {
  console.log('💰 Funding Solana test accounts...');
  
  // Use Solana CLI to airdrop to test accounts
  const testAccounts: string[] = [
    // Add any known test pubkeys here
  ];
  
  for (const account of testAccounts) {
    const proc = spawn([
      'solana', 'airdrop', '100', account,
      '--url', `http://localhost:${config.solanaRpcPort}`,
    ]);
    await proc.exited;
  }
  
  console.log('   ✅ Accounts funded');
}

// ============ Main ============

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const evmOnly = args.includes('--evm-only');
  const solanaOnly = args.includes('--solana-only');
  const skipBot = args.includes('--no-bot');
  const fork = args.find(a => a.startsWith('--fork='))?.split('=')[1];
  
  const config: LocalEnvConfig = {
    ...DEFAULT_CONFIG,
    anvilForkUrl: fork,
    solanaResetLedger: args.includes('--reset'),
  };
  
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║            MEV + LP Bot Local Development Environment         ║
╠══════════════════════════════════════════════════════════════╣
║  EVM (Anvil):     http://localhost:${config.anvilPort}                       ║
║  Solana:          http://localhost:${config.solanaRpcPort}                       ║
║  Bot REST:        http://localhost:${config.botRestPort}                       ║
║  Bot A2A:         http://localhost:${config.botA2aPort}                       ║
║  Bot MCP:         http://localhost:${config.botMcpPort}                       ║
╚══════════════════════════════════════════════════════════════╝
`);
  
  try {
    // Start EVM
    if (!solanaOnly) {
      await startAnvil(config);
      await deployTestContracts(config);
    }
    
    // Start Solana
    if (!evmOnly) {
      await startSolanaValidator(config);
      await fundSolanaAccounts(config);
    }
    
    // Start Bot
    if (!skipBot) {
      await startBot(config);
    }
    
    console.log(`
✅ Local environment is ready!

Test the APIs:
  curl http://localhost:${config.botRestPort}/health
  curl http://localhost:${config.botRestPort}/stats
  curl http://localhost:${config.botA2aPort}/.well-known/agent-card.json
  curl http://localhost:${config.botMcpPort}/

Press Ctrl+C to stop all services.
`);
    
    // Keep running
    await new Promise(() => {});
    
  } catch (error) {
    console.error('❌ Failed to start local environment:', error);
    cleanup();
    process.exit(1);
  }
}

main();
