#!/usr/bin/env bun

import { ethers } from 'ethers';
import { ChallengerAdapter } from './integration/challenger-adapter';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');

async function main() {
  console.log('⚔️  Permissionless Challenger\n');

  const network = process.env.NETWORK || 'localnet';
  const rpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  const deploymentFile = join(DEPLOYMENTS_DIR, `stage2-${network}.json`);

  if (!existsSync(deploymentFile)) {
    console.error('Deployment file not found');
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const l2OutputOracle = process.env.L2_OUTPUT_ORACLE_ADDRESS || ethers.ZeroAddress;

  const disputeGameFactory = new ethers.Contract(
    deployment.disputeGameFactory,
    [
      'function createGame(address,bytes32,bytes32,uint8,uint8) payable returns (bytes32)',
      'function resolveChallengerWins(bytes32,bytes)',
      'event GameCreated(bytes32 indexed, address indexed, address indexed, bytes32, uint8, uint8, uint256)'
    ],
    provider
  );

  const l2OutputOracleContract = new ethers.Contract(
    l2OutputOracle,
    ['event OutputProposed(uint256 indexed, uint256 indexed, bytes32, bytes32, address indexed)'],
    provider
  );

  const adapter = new ChallengerAdapter(provider, disputeGameFactory, l2OutputOracleContract);
  await adapter.monitorAndChallenge();

  console.log('Challenger running. Ctrl+C to stop.\n');

  process.on('SIGINT', () => process.exit(0));
}

main().catch(e => { console.error(e); process.exit(1); });
