/**
 * Psyche Client for Jeju DWS
 * 
 * TypeScript client for Nous Research's Psyche distributed training network.
 * Implements LLM-as-judge for scoring rollout bundles and coordinates
 * with DWS for on-demand node provisioning.
 * 
 * Features:
 * - Real Solana state parsing for coordinator accounts
 * - LLM-as-judge integration for rollout scoring
 * - Witness proof generation with ed25519 signatures
 * - Cross-chain bridging to Jeju EVM
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import { createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import * as borsh from 'borsh';
import { sign } from 'tweetnacl';

// ============================================================================
// Constants - Real Psyche Program IDs
// ============================================================================

// From vendor_examples/psyche/architectures/decentralized/solana-coordinator
export const PSYCHE_COORDINATOR_PROGRAM_ID = new PublicKey(
  '4SHugWqSXwKE5fqDchkJcPEqnoZE22VYKtSTVm7axbT7'
);

// From vendor_examples/psyche/architectures/decentralized/solana-treasurer
// Using coordinator ID as placeholder for now - replace with actual deployed address
export const PSYCHE_TREASURER_PROGRAM_ID = new PublicKey(
  '4SHugWqSXwKE5fqDchkJcPEqnoZE22VYKtSTVm7axbT7'
);

// From vendor_examples/psyche/architectures/decentralized/solana-mining-pool
// Using coordinator ID as placeholder for now - replace with actual deployed address
export const PSYCHE_MINING_POOL_PROGRAM_ID = new PublicKey(
  '4SHugWqSXwKE5fqDchkJcPEqnoZE22VYKtSTVm7axbT7'
);

// Coordinator account discriminator
const COORDINATOR_DISCRIMINATOR = Buffer.from([0x63, 0x6f, 0x6f, 0x72, 0x64, 0x69, 0x6e, 0x61]);

// ============================================================================
// Types
// ============================================================================

export interface PsycheConfig {
  solanaRpcUrl: string;
  solanaWsUrl?: string;
  evmRpcUrl?: string;
  evmPrivateKey?: Hex;
  solanaKeypair?: Keypair;
  llmJudgeUrl?: string;
  llmJudgeModel?: string;
}

export interface RunMetadata {
  name: string;
  description: string;
  modelHubRepo: string;
  datasetHubRepo: string;
}

export interface CoordinatorConfig {
  maxClients: number;
  minClients: number;
  epochLengthMs: number;
  warmupEpochs: number;
  checkpointIntervalEpochs: number;
  learningRate: number;
  batchSize: number;
  gradientAccumulationSteps: number;
  maxSeqLength: number;
}

export interface Model {
  hubRepo: string;
  revision: string;
  sha256: string;
}

export type CoordinatorProgress =
  | { type: 'Uninitialized' }
  | { type: 'WarmingUp'; epoch: number }
  | { type: 'Training'; epoch: number; step: number }
  | { type: 'Checkpointing'; epoch: number }
  | { type: 'Paused'; lastEpoch: number }
  | { type: 'Finished' };

export interface CoordinatorState {
  runId: string;
  metadata: RunMetadata;
  config: CoordinatorConfig;
  model: Model;
  progress: CoordinatorProgress;
  clients: ClientInfo[];
  currentEpoch: number;
  totalSteps: number;
  paused: boolean;
}

export interface ClientInfo {
  id: number;
  pubkey: PublicKey;
  gpuType: string;
  gpuCount: number;
  memoryGb: number;
  joinedAt: number;
  lastHealthCheck: number;
  stepsContributed: number;
  healthy: boolean;
}

export interface WitnessProof {
  signature: Uint8Array;
  timestamp: number;
  participantCount: number;
  merkleRoot: Uint8Array;
}

export interface TrainingMetrics {
  loss: number;
  learningRate: number;
  gradNorm: number;
  epochProgress: number;
  samplesProcessed: number;
  tokensProcessed: number;
}

// LLM-as-Judge types
export interface RolloutBundle {
  prompt: string;
  completions: string[];
  metadata?: Record<string, string | number>;
}

export interface JudgeScore {
  completionIndex: number;
  score: number;
  reasoning: string;
}

export interface JudgeResult {
  bundleId: string;
  scores: JudgeScore[];
  bestCompletionIndex: number;
  timestamp: number;
}

// ============================================================================
// Coordinator State Parsing (Real Implementation)
// ============================================================================

interface ParsedCoordinatorAccount {
  version: bigint;
  runId: string;
  creator: PublicKey;
  progress: CoordinatorProgress;
  config: {
    maxClients: number;
    minClients: number;
    epochLengthMs: number;
    warmupEpochs: number;
    checkpointIntervalEpochs: number;
    learningRate: number;
    batchSize: number;
    gradientAccumulationSteps: number;
    maxSeqLength: number;
  };
  metadata: {
    name: string;
    description: string;
    modelHubRepo: string;
    datasetHubRepo: string;
  };
  model: {
    hubRepo: string;
    revision: string;
    sha256: string;
  };
  clients: ClientInfo[];
  paused: boolean;
}

function readString(data: Buffer, offset: number): [string, number] {
  const len = data.readUInt32LE(offset);
  const str = data.subarray(offset + 4, offset + 4 + len).toString('utf8');
  return [str, offset + 4 + len];
}

function parseProgress(data: Buffer, offset: number): [CoordinatorProgress, number] {
  const progressType = data.readUInt8(offset);
  offset += 1;
  
  switch (progressType) {
    case 0:
      return [{ type: 'Uninitialized' }, offset];
    case 1: {
      const epoch = data.readUInt32LE(offset);
      return [{ type: 'WarmingUp', epoch }, offset + 4];
    }
    case 2: {
      const epoch = data.readUInt32LE(offset);
      const step = Number(data.readBigUInt64LE(offset + 4));
      return [{ type: 'Training', epoch, step }, offset + 12];
    }
    case 3: {
      const epoch = data.readUInt32LE(offset);
      return [{ type: 'Checkpointing', epoch }, offset + 4];
    }
    case 4: {
      const lastEpoch = data.readUInt32LE(offset);
      return [{ type: 'Paused', lastEpoch }, offset + 4];
    }
    case 5:
      return [{ type: 'Finished' }, offset];
    default:
      return [{ type: 'Uninitialized' }, offset];
  }
}

function parseCoordinatorAccount(data: Buffer): ParsedCoordinatorAccount | null {
  // Validate discriminator
  const discriminator = data.subarray(0, 8);
  if (!discriminator.equals(COORDINATOR_DISCRIMINATOR)) {
    return null;
  }

  let offset = 8;
  
  // Version
  const version = data.readBigUInt64LE(offset);
  offset += 8;

  // Run ID
  const [runId, newOffset1] = readString(data, offset);
  offset = newOffset1;

  // Creator pubkey
  const creator = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // Progress
  const [progress, newOffset2] = parseProgress(data, offset);
  offset = newOffset2;

  // Config
  const config = {
    maxClients: data.readUInt32LE(offset),
    minClients: data.readUInt32LE(offset + 4),
    epochLengthMs: Number(data.readBigUInt64LE(offset + 8)),
    warmupEpochs: data.readUInt32LE(offset + 16),
    checkpointIntervalEpochs: data.readUInt32LE(offset + 20),
    learningRate: data.readFloatLE(offset + 24),
    batchSize: data.readUInt32LE(offset + 28),
    gradientAccumulationSteps: data.readUInt32LE(offset + 32),
    maxSeqLength: data.readUInt32LE(offset + 36),
  };
  offset += 40;

  // Metadata
  const [name, o1] = readString(data, offset);
  const [description, o2] = readString(data, o1);
  const [modelHubRepo, o3] = readString(data, o2);
  const [datasetHubRepo, o4] = readString(data, o3);
  offset = o4;

  const metadata = { name, description, modelHubRepo, datasetHubRepo };

  // Model
  const [hubRepo, m1] = readString(data, offset);
  const [revision, m2] = readString(data, m1);
  const [sha256, m3] = readString(data, m2);
  offset = m3;

  const model = { hubRepo, revision, sha256 };

  // Clients count
  const clientsCount = data.readUInt32LE(offset);
  offset += 4;

  const clients: ClientInfo[] = [];
  for (let i = 0; i < clientsCount && offset + 64 <= data.length; i++) {
    const id = data.readUInt32LE(offset);
    const pubkey = new PublicKey(data.subarray(offset + 4, offset + 36));
    const [gpuType, g1] = readString(data, offset + 36);
    const gpuCount = data.readUInt32LE(g1);
    const memoryGb = data.readUInt32LE(g1 + 4);
    const joinedAt = Number(data.readBigUInt64LE(g1 + 8));
    const lastHealthCheck = Number(data.readBigUInt64LE(g1 + 16));
    const stepsContributed = Number(data.readBigUInt64LE(g1 + 24));
    const healthy = data.readUInt8(g1 + 32) === 1;
    offset = g1 + 33;

    clients.push({
      id,
      pubkey,
      gpuType,
      gpuCount,
      memoryGb,
      joinedAt,
      lastHealthCheck,
      stepsContributed,
      healthy,
    });
  }

  // Paused flag
  const paused = offset < data.length ? data.readUInt8(offset) === 1 : false;

  return {
    version,
    runId,
    creator,
    progress,
    config,
    metadata,
    model,
    clients,
    paused,
  };
}

// ============================================================================
// Borsh Schema for Solana Instructions
// ============================================================================

class InitCoordinatorInstruction {
  instruction = 0;
  runId: string;
  metadata: RunMetadata;
  config: {
    maxClients: number;
    minClients: number;
    epochLengthMs: bigint;
    warmupEpochs: number;
    checkpointIntervalEpochs: number;
    learningRate: number;
    batchSize: number;
    gradientAccumulationSteps: number;
    maxSeqLength: number;
  };
  model: Model;

  constructor(
    runId: string,
    metadata: RunMetadata,
    config: CoordinatorConfig,
    model: Model
  ) {
    this.runId = runId;
    this.metadata = metadata;
    this.config = {
      ...config,
      epochLengthMs: BigInt(config.epochLengthMs),
    };
    this.model = model;
  }
}

// ============================================================================
// LLM-as-Judge Implementation
// ============================================================================

const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator for AI model responses. Your task is to score completions based on quality, accuracy, and helpfulness.

For each completion, provide:
1. A score from 0.0 to 1.0 (where 1.0 is perfect)
2. A brief reasoning for your score

Consider:
- Accuracy and correctness of information
- Clarity and coherence of the response
- Relevance to the prompt
- Helpfulness and completeness

Output your evaluation as JSON with this format:
{
  "scores": [
    {"index": 0, "score": 0.85, "reasoning": "Clear and accurate response..."},
    {"index": 1, "score": 0.65, "reasoning": "Partially correct but..."}
  ],
  "best": 0
}`;

async function callLLMJudge(
  prompt: string,
  completions: string[],
  judgeUrl: string,
  judgeModel: string
): Promise<JudgeScore[]> {
  const userPrompt = `Evaluate these completions for the following prompt:

PROMPT: ${prompt}

COMPLETIONS:
${completions.map((c, i) => `[${i}]: ${c}`).join('\n\n')}

Provide your evaluation as JSON.`;

  const response = await fetch(`${judgeUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: judgeModel,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM judge request failed: ${response.status}`);
  }

  const result = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = result.choices[0].message.content;
  
  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse judge response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    scores: Array<{ index: number; score: number; reasoning: string }>;
    best: number;
  };

  return parsed.scores.map((s) => ({
    completionIndex: s.index,
    score: s.score,
    reasoning: s.reasoning,
  }));
}

// ============================================================================
// Psyche Client
// ============================================================================

export class PsycheClient {
  private connection: Connection;
  private evmWalletClient;
  private evmAccount;
  private solanaKeypair: Keypair | null = null;
  private config: PsycheConfig;

  constructor(config: PsycheConfig) {
    this.config = config;
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');

    if (config.solanaKeypair) {
      this.solanaKeypair = config.solanaKeypair;
    }

    if (config.evmRpcUrl && config.evmPrivateKey) {
      this.evmAccount = privateKeyToAccount(config.evmPrivateKey);
      this.evmWalletClient = createWalletClient({
        account: this.evmAccount,
        chain: foundry,
        transport: http(config.evmRpcUrl),
      });
    }
  }

  // ============================================================================
  // LLM-as-Judge for Rollout Bundles
  // ============================================================================

  async judgeRolloutBundle(bundle: RolloutBundle): Promise<JudgeResult> {
    const judgeUrl = this.config.llmJudgeUrl ?? 'http://localhost:9001';
    const judgeModel = this.config.llmJudgeModel ?? 'default';

    const scores = await callLLMJudge(
      bundle.prompt,
      bundle.completions,
      judgeUrl,
      judgeModel
    );

    const bestIndex = scores.reduce((best, s, i) =>
      s.score > scores[best].score ? i : best, 0
    );

    return {
      bundleId: `bundle-${Date.now()}`,
      scores,
      bestCompletionIndex: bestIndex,
      timestamp: Date.now(),
    };
  }

  async judgeMultipleBundles(bundles: RolloutBundle[]): Promise<JudgeResult[]> {
    return Promise.all(bundles.map((b) => this.judgeRolloutBundle(b)));
  }

  // ============================================================================
  // Run Management
  // ============================================================================

  async createRun(
    runId: string,
    metadata: RunMetadata,
    config: CoordinatorConfig,
    model: Model
  ): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required to create runs');
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID
    );

    const coordinatorAccount = Keypair.generate();

    const instruction = new InitCoordinatorInstruction(runId, metadata, config, model);
    const data = borsh.serialize(
      {
        struct: {
          instruction: 'u8',
          runId: 'string',
          metadata: {
            struct: {
              name: 'string',
              description: 'string',
              modelHubRepo: 'string',
              datasetHubRepo: 'string',
            },
          },
          config: {
            struct: {
              maxClients: 'u32',
              minClients: 'u32',
              epochLengthMs: 'u64',
              warmupEpochs: 'u32',
              checkpointIntervalEpochs: 'u32',
              learningRate: 'f32',
              batchSize: 'u32',
              gradientAccumulationSteps: 'u32',
              maxSeqLength: 'u32',
            },
          },
          model: {
            struct: {
              hubRepo: 'string',
              revision: 'string',
              sha256: 'string',
            },
          },
        },
      },
      instruction
    );

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          { pubkey: this.solanaKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
          { pubkey: coordinatorAccount.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(data),
      })
    );

    const signature = await sendAndConfirmTransaction(this.connection, tx, [
      this.solanaKeypair,
      coordinatorAccount,
    ]);

    console.log(`[Psyche] Created run ${runId}: ${signature}`);
    return signature;
  }

  async getRunState(runId: string): Promise<CoordinatorState | null> {
    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID
    );

    const accountInfo = await this.connection.getAccountInfo(coordinatorInstance);
    if (!accountInfo) {
      return null;
    }

    const parsed = parseCoordinatorAccount(Buffer.from(accountInfo.data));
    if (!parsed) {
      return null;
    }

    // Calculate current epoch and total steps from progress
    let currentEpoch = 0;
    let totalSteps = 0;
    
    switch (parsed.progress.type) {
      case 'WarmingUp':
        currentEpoch = parsed.progress.epoch;
        break;
      case 'Training':
        currentEpoch = parsed.progress.epoch;
        totalSteps = parsed.progress.step;
        break;
      case 'Checkpointing':
        currentEpoch = parsed.progress.epoch;
        break;
      case 'Paused':
        currentEpoch = parsed.progress.lastEpoch;
        break;
    }

    return {
      runId: parsed.runId,
      metadata: parsed.metadata,
      config: parsed.config,
      model: parsed.model,
      progress: parsed.progress,
      clients: parsed.clients,
      currentEpoch,
      totalSteps,
      paused: parsed.paused,
    };
  }

  async joinRun(
    runId: string,
    clientId: number,
    gpuType: string,
    gpuCount: number,
    memoryGb: number
  ): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required to join runs');
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID
    );

    const data = borsh.serialize(
      {
        struct: {
          instruction: 'u8',
          clientId: 'u32',
          gpuType: 'string',
          gpuCount: 'u32',
          memoryGb: 'u32',
        },
      },
      { instruction: 1, clientId, gpuType, gpuCount, memoryGb }
    );

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          { pubkey: this.solanaKeypair.publicKey, isSigner: true, isWritable: false },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(data),
      })
    );

    const signature = await sendAndConfirmTransaction(this.connection, tx, [
      this.solanaKeypair,
    ]);

    console.log(`[Psyche] Joined run ${runId} as client ${clientId}: ${signature}`);
    return signature;
  }

  // ============================================================================
  // Witness Proofs with Real Signatures
  // ============================================================================

  async createWitnessProof(
    runId: string,
    epoch: number,
    step: number,
    participantPubkeys: PublicKey[],
    merkleRoot: Uint8Array
  ): Promise<WitnessProof> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required for witness proofs');
    }

    // Create message to sign
    const message = Buffer.concat([
      Buffer.from(runId),
      Buffer.from(new Uint32Array([epoch]).buffer),
      Buffer.from(new BigUint64Array([BigInt(step)]).buffer),
      Buffer.from(merkleRoot),
      Buffer.from(new Uint32Array([participantPubkeys.length]).buffer),
    ]);

    // Sign with ed25519
    const signature = sign.detached(message, this.solanaKeypair.secretKey);

    return {
      signature,
      timestamp: Date.now(),
      participantCount: participantPubkeys.length,
      merkleRoot,
    };
  }

  async submitWitness(
    runId: string,
    proof: WitnessProof,
    participantBloom: Uint8Array,
    broadcastBloom: Uint8Array,
    broadcastMerkle: Uint8Array
  ): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required');
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID
    );

    const data = borsh.serialize(
      {
        struct: {
          instruction: 'u8',
          proof: { array: { type: 'u8' } },
          participantBloom: { array: { type: 'u8' } },
          broadcastBloom: { array: { type: 'u8' } },
          broadcastMerkle: { array: { type: 'u8' } },
        },
      },
      {
        instruction: 3,
        proof: Array.from(proof.signature),
        participantBloom: Array.from(participantBloom),
        broadcastBloom: Array.from(broadcastBloom),
        broadcastMerkle: Array.from(broadcastMerkle),
      }
    );

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          { pubkey: this.solanaKeypair.publicKey, isSigner: true, isWritable: false },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(data),
      })
    );

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair]);
  }

  async tick(runId: string): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required');
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID
    );

    const data = borsh.serialize({ struct: { instruction: 'u8' } }, { instruction: 2 });

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          { pubkey: this.solanaKeypair.publicKey, isSigner: true, isWritable: false },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(data),
      })
    );

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair]);
  }

  async healthCheck(runId: string, clientId: number): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required');
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID
    );

    const data = borsh.serialize(
      {
        struct: {
          instruction: 'u8',
          clientId: 'u32',
        },
      },
      { instruction: 4, clientId }
    );

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          { pubkey: this.solanaKeypair.publicKey, isSigner: true, isWritable: false },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(data),
      })
    );

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair]);
  }

  async checkpoint(runId: string, hubRepo: string): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required');
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID
    );

    const data = borsh.serialize(
      {
        struct: {
          instruction: 'u8',
          hubRepo: 'string',
        },
      },
      { instruction: 5, hubRepo }
    );

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          { pubkey: this.solanaKeypair.publicKey, isSigner: true, isWritable: false },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(data),
      })
    );

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair]);
  }

  // ============================================================================
  // Cross-Chain Bridge to Jeju EVM
  // ============================================================================

  async bridgeProgressToEVM(
    runId: string,
    state: CoordinatorState,
    bridgeAddress: Address
  ): Promise<Hex> {
    if (!this.evmWalletClient || !this.evmAccount) {
      throw new Error('EVM wallet required for bridging');
    }

    const abi = [
      {
        inputs: [
          { name: 'runId', type: 'bytes32' },
          { name: 'epoch', type: 'uint32' },
          { name: 'step', type: 'uint64' },
          { name: 'clientCount', type: 'uint32' },
          { name: 'modelHash', type: 'bytes32' },
        ],
        name: 'reportProgress',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ] as const;

    const runIdBytes = `0x${Buffer.from(runId).toString('hex').padEnd(64, '0')}` as Hex;
    const modelHash = `0x${Buffer.from(state.model.sha256).toString('hex').padEnd(64, '0')}` as Hex;

    const hash = await this.evmWalletClient.writeContract({
      address: bridgeAddress,
      abi,
      functionName: 'reportProgress',
      args: [
        runIdBytes,
        state.currentEpoch,
        BigInt(state.totalSteps),
        state.clients.length,
        modelHash,
      ],
    });

    console.log(`[Psyche] Bridged progress to EVM: ${hash}`);
    return hash;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  async getBalance(): Promise<number> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required');
    }
    return this.connection.getBalance(this.solanaKeypair.publicKey);
  }

  getPublicKey(): PublicKey | null {
    return this.solanaKeypair?.publicKey ?? null;
  }

  getEvmAddress(): Address | null {
    return this.evmAccount?.address ?? null;
  }

  getConnection(): Connection {
    return this.connection;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createPsycheClient(config: PsycheConfig): PsycheClient {
  return new PsycheClient(config);
}
