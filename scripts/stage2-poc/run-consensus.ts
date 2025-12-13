#!/usr/bin/env bun

import { ethers } from 'ethers';
import { ConsensusAdapter } from './integration/consensus-adapter';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');

async function main() {
  console.log('🔄 Stage 2 Consensus Coordinator\n');

  const network = process.env.NETWORK || 'localnet';
  const rpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  const blockInterval = parseInt(process.env.BLOCK_INTERVAL || '2000', 10);
  const deploymentFile = join(DEPLOYMENTS_DIR, `stage2-${network}.json`);

  console.log(`Network: ${network}, RPC: ${rpcUrl}, Interval: ${blockInterval}ms\n`);

  if (!existsSync(deploymentFile)) {
    console.error(`Deployment file not found: ${deploymentFile}`);
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
  console.log(`SequencerRegistry: ${deployment.sequencerRegistry}\n`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const blockNumber = await provider.getBlockNumber();
  console.log(`Connected to L1 at block ${blockNumber}`);

  const sequencerRegistry = new ethers.Contract(
    deployment.sequencerRegistry,
    [
      'function getActiveSequencers() view returns (address[], uint256[])',
      'function recordBlockProposed(address, uint256)',
      'function getSelectionWeight(address) view returns (uint256)',
      'function isActiveSequencer(address) view returns (bool)'
    ],
    provider
  );

  const adapter = new ConsensusAdapter(sequencerRegistry, blockInterval);
  await adapter.start();

  console.log('Consensus coordinator running. Ctrl+C to stop.\n');

  process.on('SIGINT', () => { adapter.stop(); process.exit(0); });
  process.on('SIGTERM', () => { adapter.stop(); process.exit(0); });

  await new Promise(() => {});
}

main().catch(e => { console.error(e); process.exit(1); });
