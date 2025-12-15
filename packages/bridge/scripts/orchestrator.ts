#!/usr/bin/env bun
/**
 * EVMSol Orchestrator
 *
 * Main entry point for running the complete EVMSol bridge infrastructure:
 * - Relayer service
 * - Prover service
 * - Beacon watcher (for EVM chains)
 * - Health monitoring
 *
 * For Solana consensus, use the Geyser plugin which runs inside the validator.
 */

import { type Subprocess, spawn } from 'bun';
import { parseArgs } from 'util';
import {
  createHealthChecker,
  type HealthCheckConfig,
} from '../src/monitoring/health.js';
import {
  createRelayerService,
  type RelayerConfig,
} from '../src/relayer/service.js';
import { ChainId } from '../src/types/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface OrchestratorConfig {
  mode: 'local' | 'testnet' | 'mainnet';
  components: {
    relayer: boolean;
    prover: boolean;
    beaconWatcher: boolean;
    healthMonitor: boolean;
  };
  ports: {
    relayer: number;
    prover: number;
    health: number;
  };
  chains: {
    evm: Array<{
      chainId: ChainId;
      name: string;
      rpcUrl: string;
      beaconUrl?: string;
      bridgeAddress: string;
      lightClientAddress: string;
    }>;
    solana: {
      rpcUrl: string;
      bridgeProgramId: string;
      evmLightClientProgramId: string;
    };
  };
}

// Default configurations
const CONFIGS: Record<string, OrchestratorConfig> = {
  local: {
    mode: 'local',
    components: {
      relayer: true,
      prover: true,
      beaconWatcher: false, // No beacon node in local
      healthMonitor: true,
    },
    ports: {
      relayer: 8081,
      prover: 8082,
      health: 8083,
    },
    chains: {
      evm: [
        {
          chainId: ChainId.LOCAL_EVM,
          name: 'Local EVM',
          rpcUrl: 'http://127.0.0.1:8545',
          bridgeAddress: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
          lightClientAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        },
      ],
      solana: {
        rpcUrl: 'http://127.0.0.1:8899',
        bridgeProgramId: 'TokenBridge11111111111111111111111111111111',
        evmLightClientProgramId: 'EVMLightClient1111111111111111111111111111',
      },
    },
  },
  testnet: {
    mode: 'testnet',
    components: {
      relayer: true,
      prover: true,
      beaconWatcher: true,
      healthMonitor: true,
    },
    ports: {
      relayer: 8081,
      prover: 8082,
      health: 8083,
    },
    chains: {
      evm: [
        {
          chainId: ChainId.BASE_SEPOLIA,
          name: 'Base Sepolia',
          rpcUrl: process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org',
          beaconUrl:
            process.env.BEACON_URL ?? 'https://lodestar-sepolia.chainsafe.io',
          bridgeAddress: process.env.BASE_BRIDGE_ADDRESS ?? '',
          lightClientAddress: process.env.BASE_LIGHT_CLIENT_ADDRESS ?? '',
        },
      ],
      solana: {
        rpcUrl: process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com',
        bridgeProgramId: process.env.BRIDGE_PROGRAM_ID ?? '',
        evmLightClientProgramId: process.env.EVM_LIGHT_CLIENT_PROGRAM_ID ?? '',
      },
    },
  },
  mainnet: {
    mode: 'mainnet',
    components: {
      relayer: true,
      prover: true,
      beaconWatcher: true,
      healthMonitor: true,
    },
    ports: {
      relayer: 8081,
      prover: 8082,
      health: 8083,
    },
    chains: {
      evm: [
        {
          chainId: ChainId.ETHEREUM_MAINNET,
          name: 'Ethereum',
          rpcUrl: process.env.ETH_RPC ?? '',
          beaconUrl: process.env.BEACON_URL ?? '',
          bridgeAddress: process.env.ETH_BRIDGE_ADDRESS ?? '',
          lightClientAddress: process.env.ETH_LIGHT_CLIENT_ADDRESS ?? '',
        },
        {
          chainId: ChainId.BASE_MAINNET,
          name: 'Base',
          rpcUrl: process.env.BASE_RPC ?? 'https://mainnet.base.org',
          bridgeAddress: process.env.BASE_BRIDGE_ADDRESS ?? '',
          lightClientAddress: process.env.BASE_LIGHT_CLIENT_ADDRESS ?? '',
        },
      ],
      solana: {
        rpcUrl: process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com',
        bridgeProgramId: process.env.BRIDGE_PROGRAM_ID ?? '',
        evmLightClientProgramId: process.env.EVM_LIGHT_CLIENT_PROGRAM_ID ?? '',
      },
    },
  },
};

// =============================================================================
// ORCHESTRATOR
// =============================================================================

class Orchestrator {
  private config: OrchestratorConfig;
  private processes: Map<string, Subprocess> = new Map();
  private relayer: ReturnType<typeof createRelayerService> | null = null;
  private healthChecker: ReturnType<typeof createHealthChecker> | null = null;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    console.log(
      `\n🚀 Starting EVMSol Orchestrator (${this.config.mode} mode)\n`
    );
    console.log('='.repeat(60) + '\n');

    // Start health monitor first
    if (this.config.components.healthMonitor) {
      await this.startHealthMonitor();
    }

    // Start prover service
    if (this.config.components.prover) {
      await this.startProver();
    }

    // Start relayer service
    if (this.config.components.relayer) {
      await this.startRelayer();
    }

    // Start beacon watcher
    if (this.config.components.beaconWatcher) {
      await this.startBeaconWatcher();
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ All components started\n');
    this.printStatus();
  }

  async stop(): Promise<void> {
    console.log('\n🛑 Stopping EVMSol Orchestrator...\n');

    // Stop processes
    for (const [name, proc] of this.processes) {
      console.log(`  Stopping ${name}...`);
      proc.kill();
    }

    // Stop services
    if (this.relayer) {
      this.relayer.stop();
    }

    if (this.healthChecker) {
      this.healthChecker.stop();
    }

    console.log('\n✅ All components stopped\n');
  }

  private async startHealthMonitor(): Promise<void> {
    console.log('📊 Starting health monitor...');

    const healthConfig: HealthCheckConfig = {
      evmRpcUrls: new Map(
        this.config.chains.evm.map((c) => [c.chainId, c.rpcUrl])
      ),
      solanaRpcUrl: this.config.chains.solana.rpcUrl,
      beaconRpcUrl: this.config.chains.evm[0]?.beaconUrl ?? '',
      proverEndpoint: `http://127.0.0.1:${this.config.ports.prover}`,
      relayerEndpoint: `http://127.0.0.1:${this.config.ports.relayer}`,
      checkIntervalMs: 30000,
    };

    this.healthChecker = createHealthChecker(healthConfig);
    this.healthChecker.start();

    console.log(
      `   ✅ Health monitor started on port ${this.config.ports.health}`
    );
  }

  private async startProver(): Promise<void> {
    console.log('🔐 Starting prover service...');

    // For production, this would start the SP1 prover
    // For now, we spawn our prover service
    const proc = spawn({
      cmd: ['bun', 'run', 'prover/services/prover.ts'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROVER_PORT: this.config.ports.prover.toString(),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    this.processes.set('prover', proc);

    // Wait for prover to be ready
    await this.waitForService(
      `http://127.0.0.1:${this.config.ports.prover}/health`,
      10
    );

    console.log(
      `   ✅ Prover service started on port ${this.config.ports.prover}`
    );
  }

  private async startRelayer(): Promise<void> {
    console.log('🔗 Starting relayer service...');

    const relayerConfig: RelayerConfig = {
      port: this.config.ports.relayer,
      evmChains: this.config.chains.evm.map((c) => ({
        chainId: c.chainId,
        rpcUrl: c.rpcUrl,
        bridgeAddress: c.bridgeAddress,
        lightClientAddress: c.lightClientAddress,
        privateKey:
          process.env.PRIVATE_KEY ??
          '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      })),
      solanaConfig: {
        rpcUrl: this.config.chains.solana.rpcUrl,
        bridgeProgramId: this.config.chains.solana.bridgeProgramId,
        evmLightClientProgramId:
          this.config.chains.solana.evmLightClientProgramId,
        keypairPath: process.env.SOLANA_KEYPAIR ?? '~/.config/solana/id.json',
      },
      proverEndpoint: `http://127.0.0.1:${this.config.ports.prover}`,
      teeEndpoint: 'http://127.0.0.1:8080',
      batchSize: 10,
      batchTimeoutMs: 30000,
      retryAttempts: 3,
      retryDelayMs: 5000,
    };

    this.relayer = createRelayerService(relayerConfig);
    await this.relayer.start();

    console.log(
      `   ✅ Relayer service started on port ${this.config.ports.relayer}`
    );
  }

  private async startBeaconWatcher(): Promise<void> {
    const beaconUrl = this.config.chains.evm[0]?.beaconUrl;
    if (!beaconUrl) {
      console.log('⚠️  No beacon URL configured, skipping beacon watcher');
      return;
    }

    console.log('👀 Starting beacon watcher...');

    const proc = spawn({
      cmd: ['bun', 'run', 'geyser/ethereum-watcher/src/watcher.ts'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        BEACON_RPC_URL: beaconUrl,
        EXECUTION_RPC_URL: this.config.chains.evm[0].rpcUrl,
        RELAYER_ENDPOINT: `http://127.0.0.1:${this.config.ports.relayer}`,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    this.processes.set('beacon-watcher', proc);
    console.log('   ✅ Beacon watcher started');
  }

  private async waitForService(
    url: string,
    maxAttempts: number
  ): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(url);
        if (response.ok) return true;
      } catch {
        // Service not ready yet
      }
      await Bun.sleep(1000);
    }
    return false;
  }

  private printStatus(): void {
    console.log('Components:');
    console.log(
      `  Relayer:        http://127.0.0.1:${this.config.ports.relayer}`
    );
    console.log(
      `  Prover:         http://127.0.0.1:${this.config.ports.prover}`
    );
    console.log(
      `  Health:         http://127.0.0.1:${this.config.ports.health}/monitoring/health`
    );
    console.log('');
    console.log('Chains:');
    for (const chain of this.config.chains.evm) {
      console.log(`  ${chain.name}: ${chain.rpcUrl}`);
    }
    console.log(`  Solana: ${this.config.chains.solana.rpcUrl}`);
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('');
  }
}

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      mode: {
        type: 'string',
        short: 'm',
        default: 'local',
      },
      help: {
        type: 'boolean',
        short: 'h',
        default: false,
      },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
EVMSol Orchestrator

Usage: bun run scripts/orchestrator.ts [options]

Options:
  -m, --mode <mode>  Deployment mode (local, testnet, mainnet)
  -h, --help         Show this help message

Environment Variables:
  PRIVATE_KEY              EVM wallet private key
  SOLANA_KEYPAIR          Path to Solana keypair file
  ETH_RPC                  Ethereum RPC URL (mainnet)
  BASE_RPC                 Base RPC URL (mainnet)
  BEACON_URL               Beacon chain RPC URL
  SOLANA_RPC               Solana RPC URL
  BRIDGE_PROGRAM_ID        Solana bridge program ID
  EVM_LIGHT_CLIENT_PROGRAM_ID  Solana EVM light client program ID
`);
    process.exit(0);
  }

  const mode = values.mode as keyof typeof CONFIGS;
  const config = CONFIGS[mode];

  if (!config) {
    console.error(`Unknown mode: ${mode}`);
    console.error('Available modes: local, testnet, mainnet');
    process.exit(1);
  }

  const orchestrator = new Orchestrator(config);

  // Handle shutdown
  process.on('SIGINT', async () => {
    await orchestrator.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await orchestrator.stop();
    process.exit(0);
  });

  await orchestrator.start();

  // Keep process alive
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
