#!/usr/bin/env bun
/**
 * Bridge Multiple Tokens from Base to Jeju
 * 
 * Supports:
 * - CLANKER (tokenbot)
 * - VIRTUAL (Virtuals Protocol)
 * - CLANKERMON (Clankermon)
 * - elizaOS (if deployed on Base)
 * - ETH (native)
 * 
 * Uses OP Stack Standard Bridge for secure L2 ↔ L2 transfers
 * 
 * Usage:
 *   # Bridge CLANKER
 *   bun run scripts/bridge-multi-tokens.ts CLANKER 100
 *   
 *   # Bridge VIRTUAL
 *   bun run scripts/bridge-multi-tokens.ts VIRTUAL 1000
 *   
 *   # Bridge to specific address
 *   bun run scripts/bridge-multi-tokens.ts CLANKERMON 5000 0x...
 */

import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { STANDARD_BRIDGE_ABI, OP_STACK_PREDEPLOYS, estimateBridgeTime } from './shared/bridge-helpers';
import { getAllSupportedTokens, parseTokenAmount, formatTokenAmount } from './shared/token-utils';

interface BridgeOptions {
  token: string; // Symbol or address
  amount: string;
  recipient?: Address;
  network?: 'mainnet' | 'testnet';
}

class MultiTokenBridger {
  private baseClient;
  private baseWalletClient;
  private account;
  private network: 'mainnet' | 'testnet';

  constructor(privateKey: string, network: 'mainnet' | 'testnet' = 'mainnet') {
    this.network = network;
    this.account = privateKeyToAccount(privateKey as `0x${string}`);

    const rpcUrl = network === 'mainnet' 
      ? 'https://mainnet.base.org'
      : 'https://sepolia.base.org';

    this.baseClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl)
    });

    this.baseWalletClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(rpcUrl)
    });

    console.log('🌉 Multi-Token Bridger Initialized');
    console.log('   Network:', network);
    console.log('   Account:', this.account.address);
    console.log('');
  }

  /**
   * Bridge any supported token from Base to Jeju
   */
  async bridge(options: BridgeOptions): Promise<string> {
    const tokens = getAllSupportedTokens();
    const tokenInfo = tokens.find(t => 
      t.symbol.toLowerCase() === options.token.toLowerCase() ||
      t.address.toLowerCase() === options.token.toLowerCase()
    );

    if (!tokenInfo) {
      throw new Error(`Unsupported token: ${options.token}`);
    }

    console.log(`🚀 Bridging ${options.amount} ${tokenInfo.symbol} to Jeju`);
    console.log('   From: Base');
    console.log('   To: Jeju');
    console.log('   Token:', tokenInfo.address);
    console.log('');

    const amount = parseTokenAmount(options.amount, tokenInfo.symbol);
    const recipient = options.recipient || this.account.address;

    // Step 1: Approve bridge
    console.log('📝 Step 1: Approving bridge...');
    const approveHash = await this.baseWalletClient.writeContract({
      address: tokenInfo.address as Address,
      abi: [{
        type: 'function',
        name: 'approve',
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' }
        ],
        outputs: [{ type: 'bool' }],
        stateMutability: 'nonpayable'
      }],
      functionName: 'approve',
      args: [OP_STACK_PREDEPLOYS.L2StandardBridge, amount],
    });

    await this.baseClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('   ✅ Approved:', approveHash);
    console.log('');

    // Step 2: Bridge tokens
    console.log('📝 Step 2: Initiating bridge transfer...');
    const bridgeHash = await this.baseWalletClient.writeContract({
      address: OP_STACK_PREDEPLOYS.L2StandardBridge,
      abi: STANDARD_BRIDGE_ABI,
      functionName: 'bridgeERC20To',
      args: [
        tokenInfo.address as Address, // local token (Base)
        tokenInfo.address as Address, // remote token (Jeju - same address)
        recipient,
        amount,
        200000, // min gas limit
        '0x' as `0x${string}` // extra data
      ],
    });

    console.log('   ✅ Bridge initiated:', bridgeHash);
    console.log('');

    // Estimate completion
    const estimatedTime = estimateBridgeTime({
      sourceChain: 'base',
      destinationChain: 'jeju',
      token: tokenInfo.address as Address,
      amount,
    });

    console.log('='.repeat(70));
    console.log('✅ Bridge Transaction Submitted!');
    console.log('='.repeat(70));
    console.log('');
    console.log('Details:');
    console.log('  Token:', tokenInfo.symbol);
    console.log('  Amount:', formatTokenAmount(amount, tokenInfo.symbol));
    console.log('  From:', this.account.address);
    console.log('  To:', recipient);
    console.log('  Tx Hash:', bridgeHash);
    console.log('');
    console.log(`Status: Pending relay to Jeju (~${estimatedTime} seconds)`);
    console.log('');
    console.log('Track status:');
    console.log(`  https://${this.network === 'mainnet' ? '' : 'sepolia.'}basescan.org/tx/${bridgeHash}`);
    console.log('');

    return bridgeHash;
  }

  /**
   * Check balance on Jeju after bridge
   */
  async checkJejuBalance(token: string, account?: Address): Promise<string> {
    const jejuRpcUrl = process.env.JEJU_RPC_URL || 'https://rpc.jeju.network';
    
    const jejuClient = createPublicClient({
      transport: http(jejuRpcUrl)
    });

    const tokens = getAllSupportedTokens();
    const tokenInfo = tokens.find(t => 
      t.symbol.toLowerCase() === token.toLowerCase() ||
      t.address.toLowerCase() === token.toLowerCase()
    );

    if (!tokenInfo) {
      throw new Error(`Unsupported token: ${token}`);
    }

    const accountAddress = account || this.account.address;

    const balance = await jejuClient.readContract({
      address: tokenInfo.address as Address,
      abi: [{
        type: 'function',
        name: 'balanceOf',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view'
      }],
      functionName: 'balanceOf',
      args: [accountAddress],
    });

    const formatted = formatTokenAmount(balance, tokenInfo.symbol);
    
    console.log(`Balance on Jeju:`);
    console.log(`  ${formatted} ${tokenInfo.symbol}`);
    console.log('');

    return formatted;
  }
}

/**
 * CLI Interface
 */
async function main() {
  const tokenSymbol = process.argv[2];
  const amount = process.argv[3];
  const recipient = process.argv[4] as Address | undefined;
  const network = (process.argv[5] || 'mainnet') as 'mainnet' | 'testnet';

  if (!tokenSymbol || !amount) {
    console.log('Usage: bun run scripts/bridge-multi-tokens.ts <TOKEN> <AMOUNT> [RECIPIENT] [NETWORK]');
    console.log('');
    console.log('Examples:');
    console.log('  bun run scripts/bridge-multi-tokens.ts CLANKER 100');
    console.log('  bun run scripts/bridge-multi-tokens.ts VIRTUAL 1000 0x... testnet');
    console.log('');
    console.log('Supported tokens: elizaOS, CLANKER, VIRTUAL, CLANKERMON');
    process.exit(1);
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  const bridger = new MultiTokenBridger(privateKey, network);
  await bridger.bridge({ token: tokenSymbol, amount, recipient, network });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { MultiTokenBridger };

