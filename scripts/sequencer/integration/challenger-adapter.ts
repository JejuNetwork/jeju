/**
 * Challenger Adapter - monitors L2 outputs and creates dispute games for invalid ones
 */

import { ethers } from 'ethers';

const DISPUTE_GAME_ABI = [
  'function createGame(address proposer, bytes32 outputRoot, uint256 l2BlockNumber) payable returns (bytes32)',
  'function games(bytes32) view returns (address proposer, bytes32 outputRoot, uint256 l2BlockNumber, uint256 createdAt, uint8 status, address challenger, bytes32 counterRoot)',
  'function bondAmount() view returns (uint256)',
  'event GameCreated(bytes32 indexed gameId, address indexed proposer, bytes32 outputRoot, uint256 l2BlockNumber)',
];

const L2_OUTPUT_ABI = [
  'function latestOutputIndex() view returns (uint256)',
  'function getL2Output(uint256) view returns (bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber)',
];

interface ChallengerConfig {
  l1Provider: ethers.Provider;
  l2Provider: ethers.Provider;
  disputeGameFactory: string;
  l2OutputOracle: string;
  wallet: ethers.Wallet;
  pollInterval?: number;
}

export class ChallengerAdapter {
  private disputeGame: ethers.Contract;
  private l2Output: ethers.Contract;
  private running = false;
  private lastChecked = 0n;

  constructor(private config: ChallengerConfig) {
    this.disputeGame = new ethers.Contract(config.disputeGameFactory, DISPUTE_GAME_ABI, config.wallet);
    this.l2Output = new ethers.Contract(config.l2OutputOracle, L2_OUTPUT_ABI, config.l1Provider);
  }

  async start() {
    this.running = true;
    console.log(`🔍 Challenger monitoring ${this.config.l2OutputOracle}`);

    while (this.running) {
      await this.checkOutputs();
      await new Promise(r => setTimeout(r, this.config.pollInterval || 12000));
    }
  }

  stop() { this.running = false; }

  private async checkOutputs() {
    const latest = await this.l2Output.latestOutputIndex();
    if (latest <= this.lastChecked) return;

    for (let i = this.lastChecked + 1n; i <= latest; i++) {
      const output = await this.l2Output.getL2Output(i);
      const valid = await this.verifyOutput(output.outputRoot, output.l2BlockNumber);

      if (!valid) {
        console.log(`⚠️  Invalid output at index ${i}, challenging...`);
        await this.challenge(output.outputRoot, output.l2BlockNumber);
      }
    }

    this.lastChecked = latest;
  }

  private async verifyOutput(outputRoot: string, l2Block: bigint): Promise<boolean> {
    // Compute expected state root from L2
    const block = await this.config.l2Provider.getBlock(Number(l2Block));
    if (!block) return false;
    // Simplified: just check block exists. Real impl would compute full output root.
    return block.stateRoot !== ethers.ZeroHash;
  }

  private async challenge(outputRoot: string, l2Block: bigint) {
    const bond = await this.disputeGame.bondAmount();
    const tx = await this.disputeGame.createGame(ethers.ZeroAddress, outputRoot, l2Block, { value: bond });
    console.log(`   Tx: ${tx.hash}`);
    await tx.wait();
    console.log(`   ✓ Dispute game created`);
  }
}

