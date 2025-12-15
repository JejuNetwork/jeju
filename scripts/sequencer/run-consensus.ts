#!/usr/bin/env bun
/**
 * Consensus Coordinator
 * 
 * Coordinates block production with real P2P signature collection from threshold signers.
 * This is the decentralized sequencer selection and block finalization service.
 */

import { ethers } from 'ethers';
import { ConsensusAdapter } from './integration/consensus-adapter';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');

async function main() {
  console.log('🔄 Decentralized Consensus Coordinator\n');

  const network = process.env.NETWORK || 'localnet';
  const rpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  const blockInterval = parseInt(process.env.BLOCK_INTERVAL || '2000', 10);
  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`);

  // Load signer configuration
  const signerUrls = [
    process.env.SIGNER_1_URL || 'http://signer-1:4100',
    process.env.SIGNER_2_URL || 'http://signer-2:4100',
    process.env.SIGNER_3_URL || 'http://signer-3:4100',
  ].filter(Boolean);
  const signerApiKey = process.env.SIGNER_API_KEY || 'demo-key';
  const voteRatio = parseFloat(process.env.VOTE_RATIO || '0.67');

  console.log(`Network: ${network}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Block interval: ${blockInterval}ms`);
  console.log(`Vote ratio: ${voteRatio * 100}%`);
  console.log(`Signers: ${signerUrls.length}`);
  console.log('');

  if (!existsSync(deploymentFile)) {
    console.error(`Deployment file not found: ${deploymentFile}`);
    console.error(`Run: bun run scripts/deploy/decentralization.ts`);
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
  console.log(`SequencerRegistry: ${deployment.sequencerRegistry}\n`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const blockNumber = await provider.getBlockNumber();
  console.log(`✅ Connected to L1 at block ${blockNumber}`);

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

  // Create adapter with P2P configuration
  const adapter = new ConsensusAdapter(
    sequencerRegistry,
    blockInterval,
    voteRatio,
    {
      signerUrls,
      signerApiKey,
      requestTimeout: 5000,
    }
  );
  
  await adapter.start();

  console.log('\n🚀 Consensus coordinator running with REAL P2P signature collection');
  console.log('   Press Ctrl+C to stop\n');

  process.on('SIGINT', () => { adapter.stop(); process.exit(0); });
  process.on('SIGTERM', () => { adapter.stop(); process.exit(0); });

  await new Promise(() => {});
}

main().catch(e => { console.error(e); process.exit(1); });
