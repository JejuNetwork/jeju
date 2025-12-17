#!/usr/bin/env bun
/**
 * @fileoverview Deploy BridgedBAT Token for Jeju Network
 *
 * Deploys the BridgedBAT token on Jeju and configures it in the existing
 * paymaster infrastructure. No special treatment - just another bridged token.
 *
 * Usage:
 *   bun run scripts/deploy/bat-integration.ts --network testnet
 *   bun run scripts/deploy/bat-integration.ts --network localnet
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getBalance } from 'viem/actions';
import { Logger } from '../shared/logger';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const logger = new Logger('deploy-bat');

const CONTRACTS_DIR = resolve(process.cwd(), 'packages/contracts');
const CONFIG_DIR = resolve(process.cwd(), 'packages/config');

const NETWORKS: Record<string, { chainId: number; name: string; rpcUrl: string }> = {
  localnet: {
    chainId: 1337,
    name: 'Localnet',
    rpcUrl: process.env.LOCALNET_RPC_URL || 'http://localhost:9545',
  },
  testnet: {
    chainId: 420690,
    name: 'Jeju Testnet',
    rpcUrl: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
  },
  mainnet: {
    chainId: 420691,
    name: 'Jeju Mainnet',
    rpcUrl: process.env.JEJU_MAINNET_RPC_URL || 'https://rpc.jejunetwork.org',
  },
};

async function deployBridgedBAT(
  rpcUrl: string,
  ownerAddress: string,
  privateKey: string
): Promise<string | null> {
  logger.info('Deploying BridgedBAT...');

  const args = [
    'create',
    'src/tokens/BridgedBAT.sol:BridgedBAT',
    '--rpc-url', rpcUrl,
    '--private-key', privateKey,
    '--broadcast',
    '--json',
    '--constructor-args', ownerAddress,
  ];

  const proc = Bun.spawn(['forge', ...args], {
    cwd: CONTRACTS_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    logger.error(`Deployment failed: ${stderr || stdout}`);
    return null;
  }

  // Parse deployment address
  let deployedAddress = '';
  const lines = (stdout + stderr).split('\n');
  for (const line of lines) {
    if (line.includes('deployedTo')) {
      const json = JSON.parse(line);
      deployedAddress = json.deployedTo;
      break;
    }
  }

  if (!deployedAddress) {
    const match = (stdout + stderr).match(/Deployed to: (0x[a-fA-F0-9]{40})/);
    if (match) deployedAddress = match[1];
  }

  if (!deployedAddress) {
    logger.error('Could not parse deployment address');
    return null;
  }

  logger.success(`BridgedBAT deployed: ${deployedAddress}`);
  return deployedAddress;
}

function updateTokensConfig(address: string, network: string): void {
  const tokensPath = resolve(CONFIG_DIR, 'tokens.json');
  const tokens = JSON.parse(readFileSync(tokensPath, 'utf-8'));

  if (tokens.tokens.BAT?.addresses) {
    tokens.tokens.BAT.addresses[network] = address;
    if (network === 'mainnet') {
      tokens.tokens.BAT.address = address;
    }
  }

  writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
  logger.info('Updated tokens.json');
}

async function main() {
  const args = process.argv.slice(2);
  const networkArg = args.indexOf('--network');
  const networkName = networkArg !== -1 ? args[networkArg + 1] : 'testnet';

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              Deploy BridgedBAT Token                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const network = NETWORKS[networkName];
  if (!network) {
    logger.error(`Unknown network: ${networkName}`);
    process.exit(1);
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    logger.error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  logger.info(`Network: ${network.name} (${network.chainId})`);
  logger.info(`Deployer: ${account.address}`);

  const chain: Chain = {
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  };
  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
  const balance = await getBalance(publicClient, { address: account.address });
  logger.info(`Balance: ${formatEther(balance)} ETH\n`);

  const bridgedBAT = await deployBridgedBAT(network.rpcUrl, account.address, privateKey);
  if (!bridgedBAT) {
    logger.error('Deployment failed');
    process.exit(1);
  }

  updateTokensConfig(bridgedBAT, networkName);

  console.log('\n' + '═'.repeat(60));
  console.log('DEPLOYMENT COMPLETE\n');
  logger.success(`BridgedBAT: ${bridgedBAT}`);
  console.log(`L1 BAT: 0x0D8775F648430679A709E98d2b0Cb6250d2887EF`);
  console.log('\nNext steps:');
  console.log('1. Register BAT in TokenRegistry (if using)');
  console.log('2. Enable BAT in CrossChainPaymaster: setTokenSupport(address, true)');
  console.log('3. Authorize paymaster as minter: setMinter(paymasterAddress, true)');
  console.log('4. Set BAT price in PriceOracle');
  console.log('5. Seed XLP liquidity with BAT and ETH');
}

main().catch(err => {
  logger.error(`Failed: ${err.message}`);
  process.exit(1);
});
