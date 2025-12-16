/**
 * Solana Mempool Monitor via Jito Geyser
 *
 * Streams pending transactions from Solana for MEV opportunities:
 * - Jupiter swap backruns
 * - Raydium arbitrage
 * - Token launch sniping
 * - Liquidation frontrunning
 *
 * Uses:
 * - Jito's Geyser gRPC for real-time pending tx streaming
 * - Triton's RPC for historical mempool data
 * - Helius webhooks for specific program monitoring
 */

import { EventEmitter } from 'events';
import { Connection, PublicKey, VersionedTransaction, TransactionMessage, SystemProgram } from '@solana/web3.js';
import WebSocket from 'ws';

// ============ Configuration ============

const JITO_GEYSER_WS = 'wss://mainnet.block-engine.jito.wtf/stream';
const JITO_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf';
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVmkdRmao126vhwQVqhEam',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
];

// Programs to monitor
const MONITORED_PROGRAMS = {
  jupiter: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  raydium_amm: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  raydium_clmm: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  orca_whirlpool: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  meteora: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  openbook: 'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EQBh8r',
  drift: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',
  mango: 'mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68',
  marginfi: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
  kamino: 'KLend2g3cP87ber41rcLPFi9k7R1S8YDq5sDULKbUhJ',
};

// Minimum value for backrun opportunities
const MIN_SWAP_VALUE_SOL = 1; // 1 SOL minimum
const MIN_PROFIT_LAMPORTS = 100000; // 0.0001 SOL minimum profit

// ============ Types ============

export interface PendingSolanaTx {
  signature: string;
  slot: number;
  timestamp: number;
  feePayer: string;
  programs: string[];
  instructions: ParsedInstruction[];
  priorityFee: number;
  computeUnits: number;
  rawTx: Uint8Array;
}

interface ParsedInstruction {
  program: string;
  programId: string;
  type: string;
  data: InstructionData;
}

interface InstructionData {
  // Jupiter swap
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  slippageBps?: number;
  // Raydium
  amm?: string;
  baseAmount?: string;
  quoteAmount?: string;
  // Generic
  accounts?: string[];
}

export interface SolanaArbOpportunity {
  id: string;
  type: 'backrun' | 'arbitrage' | 'liquidation' | 'sandwich';
  targetTx: PendingSolanaTx;
  expectedProfit: number;
  priority: number;
  route?: BackrunRoute;
  expiresAt: number;
}

interface BackrunRoute {
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  expectedOutput: bigint;
  priceImpact: number;
  dexes: string[];
}

interface JitoStreamMessage {
  type: 'transaction' | 'heartbeat';
  transaction?: {
    signature: string;
    slot: number;
    transaction: string; // base64
    meta: {
      fee: number;
      computeUnitsConsumed: number;
    };
  };
}

// ============ Mempool Monitor ============

export class SolanaMempoolMonitor extends EventEmitter {
  private connection: Connection;
  private ws: WebSocket | null = null;
  private running = false;
  private opportunities: Map<string, SolanaArbOpportunity> = new Map();
  private processedTxs: Set<string> = new Set();
  private programIds: Map<string, string> = new Map();

  constructor(rpcUrl: string) {
    super();
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Index program IDs
    for (const [name, address] of Object.entries(MONITORED_PROGRAMS)) {
      this.programIds.set(address, name);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('🔍 Starting Solana mempool monitor...');

    // Connect to Jito Geyser stream
    await this.connectGeyser();

    // Also subscribe to block updates for finality
    this.subscribeToBlocks();
  }

  stop(): void {
    this.running = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getOpportunities(): SolanaArbOpportunity[] {
    return Array.from(this.opportunities.values())
      .filter(o => o.expiresAt > Date.now())
      .sort((a, b) => b.expectedProfit - a.expectedProfit);
  }

  // ============ Geyser Connection ============

  private async connectGeyser(): Promise<void> {
    console.log('   Connecting to Jito Geyser...');

    this.ws = new WebSocket(JITO_GEYSER_WS);

    this.ws.on('open', () => {
      console.log('   ✓ Connected to Jito Geyser');

      // Subscribe to transaction stream
      const subscribeMsg = {
        jsonrpc: '2.0',
        id: 1,
        method: 'transactionSubscribe',
        params: [
          {
            vote: false,
            failed: false,
            accountInclude: Object.values(MONITORED_PROGRAMS),
          },
          {
            commitment: 'processed',
            encoding: 'base64',
            transactionDetails: 'full',
            maxSupportedTransactionVersion: 0,
          },
        ],
      };

      this.ws?.send(JSON.stringify(subscribeMsg));
    });

    this.ws.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString()) as JitoStreamMessage | { result: number };

      if ('result' in message) {
        console.log(`   Subscription confirmed: ${message.result}`);
        return;
      }

      if (message.type === 'transaction' && message.transaction) {
        this.handleTransaction(message.transaction);
      }
    });

    this.ws.on('error', (error) => {
      console.error('   Geyser error:', error);
    });

    this.ws.on('close', () => {
      console.log('   Geyser connection closed');
      if (this.running) {
        // Reconnect after delay
        setTimeout(() => this.connectGeyser(), 5000);
      }
    });
  }

  private subscribeToBlocks(): void {
    this.connection.onSlotChange((slotInfo) => {
      // Clean up expired opportunities on each slot
      const now = Date.now();
      for (const [id, opp] of this.opportunities) {
        if (opp.expiresAt < now) {
          this.opportunities.delete(id);
        }
      }

      // Clean old processed txs
      if (this.processedTxs.size > 10000) {
        const toDelete = Array.from(this.processedTxs).slice(0, 5000);
        for (const sig of toDelete) {
          this.processedTxs.delete(sig);
        }
      }
    });
  }

  // ============ Transaction Processing ============

  private handleTransaction(txData: {
    signature: string;
    slot: number;
    transaction: string;
    meta: { fee: number; computeUnitsConsumed: number };
  }): void {
    // Skip if already processed
    if (this.processedTxs.has(txData.signature)) return;
    this.processedTxs.add(txData.signature);

    // Decode transaction
    const txBuffer = Buffer.from(txData.transaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);

    // Parse transaction
    const parsedTx = this.parseTransaction(tx, txData);
    if (!parsedTx) return;

    // Analyze for opportunities
    const opportunities = this.analyzeForOpportunities(parsedTx);

    for (const opp of opportunities) {
      this.opportunities.set(opp.id, opp);
      this.emit('opportunity', opp);
    }
  }

  private parseTransaction(
    tx: VersionedTransaction,
    meta: { signature: string; slot: number; meta: { fee: number; computeUnitsConsumed: number } }
  ): PendingSolanaTx | null {
    const message = tx.message;

    // Get static account keys
    const accountKeys = message.staticAccountKeys.map(k => k.toBase58());

    // Parse instructions
    const instructions: ParsedInstruction[] = [];
    const programs: string[] = [];

    for (const ix of message.compiledInstructions) {
      const programId = accountKeys[ix.programIdIndex];
      const programName = this.programIds.get(programId);

      if (programName) {
        programs.push(programName);
        const parsed = this.parseInstruction(programName, programId, ix.data, ix.accountKeyIndexes.map(i => accountKeys[i]));
        if (parsed) {
          instructions.push(parsed);
        }
      }
    }

    // Skip if no monitored programs
    if (programs.length === 0) return null;

    return {
      signature: meta.signature,
      slot: meta.slot,
      timestamp: Date.now(),
      feePayer: accountKeys[0],
      programs,
      instructions,
      priorityFee: meta.meta.fee,
      computeUnits: meta.meta.computeUnitsConsumed,
      rawTx: tx.serialize(),
    };
  }

  private parseInstruction(
    program: string,
    programId: string,
    data: Uint8Array,
    accounts: string[]
  ): ParsedInstruction | null {
    // Parse based on program
    switch (program) {
      case 'jupiter':
        return this.parseJupiterSwap(programId, data, accounts);
      case 'raydium_amm':
        return this.parseRaydiumSwap(programId, data, accounts);
      default:
        return {
          program,
          programId,
          type: 'unknown',
          data: { accounts },
        };
    }
  }

  private parseJupiterSwap(
    programId: string,
    data: Uint8Array,
    accounts: string[]
  ): ParsedInstruction | null {
    // Jupiter route instruction discriminator
    const discriminator = data.slice(0, 8);

    // Common Jupiter swap accounts layout
    // [tokenProgram, user, userSource, userDest, ...]
    if (accounts.length < 4) return null;

    return {
      program: 'jupiter',
      programId,
      type: 'swap',
      data: {
        inputMint: accounts[2], // userSource token account
        outputMint: accounts[3], // userDest token account
        accounts,
      },
    };
  }

  private parseRaydiumSwap(
    programId: string,
    data: Uint8Array,
    accounts: string[]
  ): ParsedInstruction | null {
    // Raydium AMM swap accounts layout
    // [amm, authority, userSource, userDest, poolSource, poolDest, ...]
    if (accounts.length < 6) return null;

    return {
      program: 'raydium_amm',
      programId,
      type: 'swap',
      data: {
        amm: accounts[0],
        accounts,
      },
    };
  }

  // ============ Opportunity Detection ============

  private analyzeForOpportunities(tx: PendingSolanaTx): SolanaArbOpportunity[] {
    const opportunities: SolanaArbOpportunity[] = [];

    // Look for Jupiter/Raydium swaps to backrun
    for (const ix of tx.instructions) {
      if (ix.type === 'swap') {
        const backrunOpp = this.analyzeBackrunOpportunity(tx, ix);
        if (backrunOpp) {
          opportunities.push(backrunOpp);
        }
      }
    }

    // Look for liquidations
    if (tx.programs.includes('marginfi') || tx.programs.includes('kamino')) {
      const liqOpp = this.analyzeLiquidationOpportunity(tx);
      if (liqOpp) {
        opportunities.push(liqOpp);
      }
    }

    return opportunities;
  }

  private analyzeBackrunOpportunity(
    tx: PendingSolanaTx,
    swapIx: ParsedInstruction
  ): SolanaArbOpportunity | null {
    // Parse actual token amounts from the swap instruction
    const inputMint = swapIx.data.inputMint || '';
    const outputMint = swapIx.data.outputMint || '';
    
    // Parse amounts - Jupiter/Raydium encode these differently
    let inputAmount = BigInt(0);
    let outputAmount = BigInt(0);
    
    if (swapIx.data.inAmount) {
      inputAmount = BigInt(swapIx.data.inAmount);
    } else if (swapIx.data.baseAmount) {
      // Raydium format
      inputAmount = BigInt(swapIx.data.baseAmount);
    }
    
    if (swapIx.data.outAmount) {
      outputAmount = BigInt(swapIx.data.outAmount);
    } else if (swapIx.data.quoteAmount) {
      outputAmount = BigInt(swapIx.data.quoteAmount);
    }
    
    // Check minimum value (roughly 1 SOL = 1e9 lamports, tokens vary)
    // SOL mint: So11111111111111111111111111111111111111112
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const isSolInput = inputMint === SOL_MINT;
    const isSolOutput = outputMint === SOL_MINT;
    
    // Determine if swap is large enough
    // For SOL: 1e9 lamports = 1 SOL
    // For tokens: estimate based on amount (e.g., USDC has 6 decimals)
    let valueLamports = BigInt(0);
    if (isSolInput) {
      valueLamports = inputAmount;
    } else if (isSolOutput) {
      valueLamports = outputAmount;
    } else {
      // Estimate value: assume average token has 6-9 decimals
      // For significant arb, we want at least $100 worth
      // Skip small swaps entirely based on priority fee as fallback
      if (tx.priorityFee < 5000 && inputAmount < BigInt(1e8)) {
        return null;
      }
      // Use input amount as proxy (not ideal but better than priority fee alone)
      valueLamports = inputAmount;
    }
    
    // Minimum 1 SOL value for backrun
    const MIN_VALUE = BigInt(1e9);
    if (valueLamports < MIN_VALUE && !isSolInput && !isSolOutput) {
      return null;
    }
    
    // Calculate expected profit based on price impact
    // Larger swaps create more price impact to capture
    const slippageBps = swapIx.data.slippageBps || 50; // Default 0.5% if not specified
    const priceImpactEstimate = Math.min(slippageBps / 10000, 0.03); // Cap at 3%
    
    // Profit estimate: capture fraction of price movement after their swap
    // Typically can capture 20-50% of the reversion
    const captureRate = 0.3;
    const expectedProfitLamports = Number(valueLamports) * priceImpactEstimate * captureRate;
    
    // Skip if profit too low
    if (expectedProfitLamports < MIN_PROFIT_LAMPORTS) {
      return null;
    }
    
    const id = `backrun-${tx.signature.slice(0, 16)}`;

    const opportunity: SolanaArbOpportunity = {
      id,
      type: 'backrun',
      targetTx: tx,
      expectedProfit: expectedProfitLamports,
      priority: tx.priorityFee + Math.floor(expectedProfitLamports * 0.1), // Bid based on expected profit
      route: {
        inputMint,
        outputMint,
        inputAmount,
        expectedOutput: outputAmount,
        priceImpact: priceImpactEstimate,
        dexes: [swapIx.program],
      },
      expiresAt: Date.now() + 2000, // 2 second expiry
    };

    return opportunity;
  }

  private analyzeLiquidationOpportunity(tx: PendingSolanaTx): SolanaArbOpportunity | null {
    // Look for liquidation instructions in lending protocols
    const liquidationPrograms = ['marginfi', 'kamino', 'mango', 'drift'];
    const hasLiquidation = tx.programs.some(p => liquidationPrograms.includes(p));

    if (!hasLiquidation) return null;

    // Parse instruction data to identify liquidation amount
    // Liquidation instructions typically have:
    // - borrower account
    // - collateral token account
    // - debt token account
    // - liquidation amount

    for (const ix of tx.instructions) {
      if (!liquidationPrograms.includes(ix.program)) continue;

      // Check for liquidation instruction discriminator
      // MarginFi: 0x05 (liquidate)
      // Kamino: depends on instruction layout

      // For now, flag any transaction touching these programs as potential liquidation
      const id = `liq-${tx.signature.slice(0, 16)}`;

      const opportunity: SolanaArbOpportunity = {
        id,
        type: 'liquidation',
        targetTx: tx,
        expectedProfit: tx.priorityFee * 0.5, // Estimate: 50% of their priority fee in profit
        priority: tx.priorityFee * 2, // Bid higher than target
        expiresAt: Date.now() + 1000, // 1 second expiry for liquidations
      };

      console.log(`⚡ Liquidation opportunity: ${id} | Est. profit: ${opportunity.expectedProfit} lamports`);

      return opportunity;
    }

    return null;
  }

  // ============ Execution ============

  async executeBackrun(
    opportunity: SolanaArbOpportunity,
    keypair: { publicKey: PublicKey; secretKey: Uint8Array }
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    if (!opportunity.route) {
      return { success: false, error: 'No route for backrun' };
    }

    console.log(`🎯 Executing backrun for ${opportunity.targetTx.signature.slice(0, 16)}...`);

    // 1. Build backrun transaction via Jupiter
    const jupiterQuoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${opportunity.route.inputMint}&outputMint=${opportunity.route.outputMint}&amount=${opportunity.route.inputAmount}&slippageBps=50`;

    const quoteResponse = await fetch(jupiterQuoteUrl);
    if (!quoteResponse.ok) {
      return { success: false, error: 'Failed to get Jupiter quote' };
    }

    const quote = await quoteResponse.json() as {
      inAmount: string;
      outAmount: string;
      routePlan: Array<{ swapInfo: { label: string } }>;
    };

    console.log(`   Quote: ${quote.inAmount} -> ${quote.outAmount}`);
    console.log(`   Route: ${quote.routePlan.map(r => r.swapInfo.label).join(' → ')}`);

    // 2. Get swap transaction
    const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });

    if (!swapResponse.ok) {
      return { success: false, error: 'Failed to get swap tx' };
    }

    const { swapTransaction, lastValidBlockHeight } = await swapResponse.json() as { 
      swapTransaction: string;
      lastValidBlockHeight: number;
    };

    // 3. Deserialize and sign backrun tx
    const txBuffer = Buffer.from(swapTransaction, 'base64');
    const backrunTx = VersionedTransaction.deserialize(txBuffer);

    // Create a signer from the keypair
    const signer = {
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
    };
    backrunTx.sign([signer]);

    // 4. Create Jito tip transaction
    const tipAccount = new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
    const tipAmount = Math.max(10000, Math.floor(opportunity.expectedProfit * 0.1)); // 10% of profit as tip

    const { blockhash } = await this.connection.getLatestBlockhash();
    const tipIx = SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: tipAccount,
      lamports: tipAmount,
    });

    const tipMessage = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [tipIx],
    }).compileToV0Message();

    const tipTx = new VersionedTransaction(tipMessage);
    tipTx.sign([signer]);

    // 5. Bundle: [target tx, backrun tx, tip tx]
    const bundle = [
      Buffer.from(opportunity.targetTx.rawTx).toString('base64'),
      Buffer.from(backrunTx.serialize()).toString('base64'),
      Buffer.from(tipTx.serialize()).toString('base64'),
    ];

    console.log(`   Submitting bundle with ${bundle.length} txs, tip: ${tipAmount} lamports`);

    const bundleResponse = await fetch(`${JITO_BLOCK_ENGINE}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [bundle],
      }),
    });

    const bundleResult = await bundleResponse.json() as { result?: string; error?: { message: string } };

    if (bundleResult.error) {
      return { success: false, error: bundleResult.error.message };
    }

    const bundleId = bundleResult.result || '';
    console.log(`   Bundle submitted: ${bundleId}`);

    // 6. Wait for bundle confirmation
    const landed = await this.waitForBundle(bundleId);

    if (!landed) {
      return { success: false, error: 'Bundle not landed' };
    }

    // Get backrun tx signature
    const signature = Buffer.from(backrunTx.signatures[0]).toString('base64');
    console.log(`   ✓ Backrun landed: ${signature}`);

    return {
      success: true,
      signature,
    };
  }

  private async waitForBundle(bundleId: string): Promise<boolean> {
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));

      const response = await fetch(`${JITO_BLOCK_ENGINE}/api/v1/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBundleStatuses',
          params: [[bundleId]],
        }),
      });

      const result = await response.json() as {
        result?: { value: Array<{ confirmation_status: string }> };
      };

      const status = result.result?.value?.[0]?.confirmation_status;
      if (status === 'confirmed' || status === 'finalized') {
        return true;
      }
      if (status === 'failed') {
        return false;
      }
    }
    return false;
  }
}

// ============ Factory ============

export function createSolanaMempoolMonitor(rpcUrl: string): SolanaMempoolMonitor {
  return new SolanaMempoolMonitor(rpcUrl);
}

