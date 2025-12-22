/**
 * Challenger Adapter - monitors L2 outputs and creates dispute games for invalid ones
 */

import { createPublicClient, http, readContract, waitForTransactionReceipt, getBlock, zeroAddress, zeroHash, type Address, type PublicClient, type WalletClient } from 'viem';
import { parseAbi } from 'viem';
import { inferChainFromRpcUrl } from '../../shared/chain-utils';

const DISPUTE_GAME_ABI = parseAbi([
  'function createGame(address proposer, bytes32 outputRoot, uint256 l2BlockNumber) payable returns (bytes32)',
  'function games(bytes32) view returns (address proposer, bytes32 outputRoot, uint256 l2BlockNumber, uint256 createdAt, uint8 status, address challenger, bytes32 counterRoot)',
  'function bondAmount() view returns (uint256)',
  'event GameCreated(bytes32 indexed gameId, address indexed proposer, bytes32 outputRoot, uint256 l2BlockNumber)',
]);

const L2_OUTPUT_ABI = parseAbi([
  'function latestOutputIndex() view returns (uint256)',
  'function getL2Output(uint256) view returns (bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber)',
]);

interface ChallengerConfig {
  l1RpcUrl: string;
  l2RpcUrl: string;
  disputeGameFactory: Address;
  l2OutputOracle: Address;
  walletClient: WalletClient;
  pollInterval?: number;
}

export class ChallengerAdapter {
  private l1PublicClient: PublicClient;
  private l2PublicClient: PublicClient;
  private disputeGameAddress: Address;
  private l2OutputAddress: Address;
  private walletClient: WalletClient;
  private running = false;
  private lastChecked = 0n;

  constructor(private config: ChallengerConfig) {
    const l1Chain = inferChainFromRpcUrl(config.l1RpcUrl);
    const l2Chain = inferChainFromRpcUrl(config.l2RpcUrl);
    this.l1PublicClient = createPublicClient({ chain: l1Chain, transport: http(config.l1RpcUrl) });
    this.l2PublicClient = createPublicClient({ chain: l2Chain, transport: http(config.l2RpcUrl) });
    this.disputeGameAddress = config.disputeGameFactory;
    this.l2OutputAddress = config.l2OutputOracle;
    this.walletClient = config.walletClient;
  }

  async start() {
    this.running = true;
    console.log(`🔍 Challenger monitoring ${this.l2OutputAddress}`);

    while (this.running) {
      await this.checkOutputs();
      await new Promise(r => setTimeout(r, this.config.pollInterval || 12000));
    }
  }

  stop() { this.running = false; }

  private async checkOutputs() {
    const latest = await readContract(this.l1PublicClient, {
      address: this.l2OutputAddress,
      abi: L2_OUTPUT_ABI,
      functionName: 'latestOutputIndex',
    });
    if (latest <= this.lastChecked) return;

    for (let i = this.lastChecked + 1n; i <= latest; i++) {
      const output = await readContract(this.l1PublicClient, {
        address: this.l2OutputAddress,
        abi: L2_OUTPUT_ABI,
        functionName: 'getL2Output',
        args: [i],
      });
      const valid = await this.verifyOutput(output[0] as `0x${string}`, output[2] as bigint);

      if (!valid) {
        console.log(`⚠️  Invalid output at index ${i}, challenging...`);
        await this.challenge(output[0] as `0x${string}`, output[2] as bigint);
      }
    }

    this.lastChecked = latest;
  }

  private async verifyOutput(outputRoot: `0x${string}`, l2Block: bigint): Promise<boolean> {
    // Compute expected state root from L2
    const block = await getBlock(this.l2PublicClient, { blockNumber: l2Block });
    if (!block) return false;
    // Simplified: just check block exists. Real impl would compute full output root.
    return block.stateRoot !== zeroHash;
  }

  private async challenge(outputRoot: `0x${string}`, l2Block: bigint) {
    const bond = await readContract(this.l1PublicClient, {
      address: this.disputeGameAddress,
      abi: DISPUTE_GAME_ABI,
      functionName: 'bondAmount',
    });
    const hash = await this.walletClient.writeContract({
      address: this.disputeGameAddress,
      abi: DISPUTE_GAME_ABI,
      functionName: 'createGame',
      args: [zeroAddress, outputRoot, l2Block],
      value: bond,
    });
    console.log(`   Tx: ${hash}`);
    await waitForTransactionReceipt(this.l1PublicClient, { hash });
    console.log(`   ✓ Dispute game created`);
  }
}

