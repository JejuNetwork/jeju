#!/usr/bin/env bun
/**
 * OIF Deployment Script
 * 
 * Deploys Open Intents Framework contracts to specified network.
 * 
 * Usage:
 *   bun run scripts/deploy-oif.ts [network]
 * 
 * Networks:
 *   localnet  - Local Anvil (chainId: 1337)
 *   testnet   - Jeju Testnet (420690) + Sepolia (11155111)
 *   mainnet   - Jeju Mainnet (420691) + Ethereum (1)
 * 
 * Environment:
 *   PRIVATE_KEY - Deployer private key
 *   ORACLE_TYPE - "simple", "hyperlane", or "superchain" (default: superchain for L2s)
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import path from 'path';

const CONTRACTS_DIR = path.join(import.meta.dirname, '../packages/contracts');
const DEPLOYMENTS_DIR = path.join(CONTRACTS_DIR, 'deployments');

interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  oracleType: 'simple' | 'hyperlane' | 'superchain';
}

const NETWORKS: Record<string, NetworkConfig[]> = {
  localnet: [
    { chainId: 1337, name: 'Anvil', rpcUrl: 'http://localhost:8545', oracleType: 'simple' },
  ],
  testnet: [
    { chainId: 420690, name: 'Jeju Testnet', rpcUrl: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network', oracleType: 'superchain' },
    { chainId: 11155111, name: 'Sepolia', rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', oracleType: 'superchain' },
  ],
  mainnet: [
    { chainId: 420691, name: 'Jeju Mainnet', rpcUrl: process.env.JEJU_RPC_URL || 'https://rpc.jeju.network', oracleType: 'superchain' },
    { chainId: 1, name: 'Ethereum', rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com', oracleType: 'hyperlane' },
  ],
};

interface DeploymentResult {
  chainId: number;
  solverRegistry: string;
  inputSettler: string;
  outputSettler: string;
  oracle: string;
  oracleType: string;
  txHash?: string;
}

async function deployToChain(config: NetworkConfig, privateKey: string): Promise<DeploymentResult | null> {
  console.log(`\n📡 Deploying to ${config.name} (${config.chainId})...`);
  console.log(`   RPC: ${config.rpcUrl}`);
  console.log(`   Oracle: ${config.oracleType}`);

  return new Promise((resolve) => {
    const child = spawn(
      'forge',
      [
        'script',
        'script/DeployOIF.s.sol:DeployOIF',
        '--rpc-url', config.rpcUrl,
        '--broadcast',
        '--json',
      ],
      {
        cwd: CONTRACTS_DIR,
        env: {
          ...process.env,
          PRIVATE_KEY: privateKey,
          ORACLE_TYPE: config.oracleType,
        },
      }
    );

    let output = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
      process.stdout.write(data);
    });

    child.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`   ❌ Deployment failed (exit code: ${code})`);
        resolve(null);
        return;
      }

      // Parse deployment output for addresses
      const solverMatch = output.match(/SolverRegistry deployed to: (0x[a-fA-F0-9]{40})/);
      const inputMatch = output.match(/InputSettler deployed to: (0x[a-fA-F0-9]{40})/);
      const outputMatch = output.match(/OutputSettler deployed to: (0x[a-fA-F0-9]{40})/);
      const oracleMatch = output.match(/Oracle deployed to: (0x[a-fA-F0-9]{40})/);

      if (solverMatch && inputMatch && outputMatch && oracleMatch) {
        console.log(`   ✅ Deployment successful`);
        resolve({
          chainId: config.chainId,
          solverRegistry: solverMatch[1],
          inputSettler: inputMatch[1],
          outputSettler: outputMatch[1],
          oracle: oracleMatch[1],
          oracleType: config.oracleType,
        });
      } else {
        console.error(`   ⚠️ Could not parse deployment addresses`);
        resolve(null);
      }
    });
  });
}

async function main() {
  const network = process.argv[2] || 'localnet';
  
  if (!NETWORKS[network]) {
    console.error(`Unknown network: ${network}`);
    console.error(`Valid networks: ${Object.keys(NETWORKS).join(', ')}`);
    process.exit(1);
  }

  const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error('PRIVATE_KEY or DEPLOYER_PRIVATE_KEY must be set');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              OIF DEPLOYMENT                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Network: ${network}`);
  console.log(`Chains: ${NETWORKS[network].map(c => c.name).join(', ')}`);

  const results: DeploymentResult[] = [];

  for (const config of NETWORKS[network]) {
    const result = await deployToChain(config, privateKey);
    if (result) {
      results.push(result);
    }
  }

  if (results.length === 0) {
    console.error('\n❌ No successful deployments');
    process.exit(1);
  }

  // Update deployment file
  const deploymentFile = path.join(DEPLOYMENTS_DIR, `oif-${network}.json`);
  const deployment = {
    network,
    status: 'deployed',
    timestamp: new Date().toISOString(),
    chains: Object.fromEntries(
      results.map(r => [r.chainId.toString(), {
        chainId: r.chainId,
        status: 'deployed',
        contracts: {
          solverRegistry: r.solverRegistry,
          inputSettler: r.inputSettler,
          outputSettler: r.outputSettler,
          oracle: r.oracle,
          oracleType: r.oracleType,
        },
      }])
    ),
  };

  writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log(`\n📄 Updated ${deploymentFile}`);

  // Output environment variables
  console.log('\n=== Add to .env ===\n');
  for (const r of results) {
    console.log(`OIF_SOLVER_REGISTRY_${r.chainId}=${r.solverRegistry}`);
    console.log(`OIF_INPUT_SETTLER_${r.chainId}=${r.inputSettler}`);
    console.log(`OIF_OUTPUT_SETTLER_${r.chainId}=${r.outputSettler}`);
    console.log(`OIF_ORACLE_${r.chainId}=${r.oracle}`);
    console.log('');
  }

  console.log('✅ Deployment complete');
}

main().catch(console.error);



