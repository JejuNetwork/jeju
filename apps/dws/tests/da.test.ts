/**
 * Data Availability Layer Tests
 */

import { describe, it, expect, beforeEach, beforeAll } from 'bun:test';
import {
  ReedSolomonCodec,
  createReedSolomonCodec,
  createCommitment,
  initializeCommitmentSystem,
  verifyProof,
  DASampler,
  BlobManager,
  Disperser,
  DAOperator,
  DAClient,
  computeBlobId,
} from '../src/da';
import type { Chunk, BlobCommitment, DAOperatorInfo } from '../src/da/types';
import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

describe('Reed-Solomon Erasure Coding', () => {
  it('should encode and decode data correctly', () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 4 });
    const data = new TextEncoder().encode('Hello, World! This is a test of erasure coding.');
    
    const shards = codec.encode(data);
    expect(shards.length).toBe(8); // 4 data + 4 parity
    
    // Verify decoding with all shards
    const decoded = codec.decode(shards, data.length);
    expect(new TextDecoder().decode(decoded)).toBe('Hello, World! This is a test of erasure coding.');
  });

  it('should reconstruct data with missing shards', () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 4 });
    const data = new TextEncoder().encode('Test data for reconstruction');
    
    const shards = codec.encode(data);
    
    // Remove 4 shards (half)
    const partialShards: (Uint8Array | null)[] = shards.map((s, i) => 
      i % 2 === 0 ? s : null
    );
    
    const decoded = codec.decode(partialShards, data.length);
    expect(new TextDecoder().decode(decoded)).toBe('Test data for reconstruction');
  });

  it('should verify shard consistency', () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 4 });
    const data = new TextEncoder().encode('Verification test');
    
    const shards = codec.encode(data);
    expect(codec.verify(shards)).toBe(true);
    
    // Corrupt a shard
    const corrupted = [...shards];
    corrupted[0] = new Uint8Array(corrupted[0].length).fill(0);
    expect(codec.verify(corrupted)).toBe(false);
  });

  it('should create chunks with Merkle proofs', () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 4 });
    const data = new TextEncoder().encode('Chunk test data');
    const blobId = computeBlobId(data);
    
    const chunks = codec.createChunks(data, blobId);
    expect(chunks.length).toBe(8);
    
    for (const chunk of chunks) {
      expect(chunk.proof.merkleProof.length).toBeGreaterThan(0);
      expect(chunk.blobId).toBe(blobId);
    }
  });
});

describe('Polynomial Commitments', () => {
  beforeAll(async () => {
    await initializeCommitmentSystem();
  });

  it('should create valid commitment from chunks', async () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 4 });
    const data = new TextEncoder().encode('Commitment test data');
    
    const shards = codec.encode(data);
    const chunkSize = shards[0].length;
    
    const commitment = await createCommitment(shards, chunkSize, 4, 4);
    
    expect(commitment.commitment).toBeDefined();
    expect(commitment.merkleRoot).toBeDefined();
    expect(commitment.dataChunkCount).toBe(4);
    expect(commitment.parityChunkCount).toBe(4);
    expect(commitment.totalChunkCount).toBe(8);
  });

  it('should verify valid chunk proofs', async () => {
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 4 });
    const data = new TextEncoder().encode('Proof verification test');
    const blobId = computeBlobId(data);
    
    const chunks = codec.createChunks(data, blobId);
    const shards = chunks.map(c => c.data);
    const commitment = await createCommitment(shards, shards[0].length, 4, 4);
    
    // Verify each chunk
    for (const chunk of chunks) {
      const result = verifyProof(chunk, commitment);
      expect(result).toBe(true);
    }
  });
});

describe('Blob Manager', () => {
  let blobManager: BlobManager;
  const testAddress = '0x1234567890123456789012345678901234567890' as Address;

  // Use smaller config for faster tests
  const testConfig = {
    erasure: {
      dataShards: 4,
      parityShards: 4,
      chunkSize: 1024,
    },
  };

  beforeAll(async () => {
    await initializeCommitmentSystem();
  });

  beforeEach(() => {
    blobManager = new BlobManager(testConfig);
  });

  it('should submit and retrieve blob', async () => {
    const data = new TextEncoder().encode('Blob manager test');
    
    const { blob, chunks, commitment, metadata } = await blobManager.submit({
      data,
      submitter: testAddress,
    });
    
    expect(blob.id).toBeDefined();
    expect(chunks.length).toBe(8); // 4 data + 4 parity
    expect(commitment.commitment).toBeDefined();
    expect(metadata.status).toBe('pending');
    
    // Retrieve
    const retrieved = blobManager.retrieve({
      blobId: blob.id,
      commitment,
    });
    
    expect(new TextDecoder().decode(retrieved.data)).toBe('Blob manager test');
    expect(retrieved.verified).toBe(true);
  });

  it('should track blob status', async () => {
    const data = new TextEncoder().encode('Status test');
    
    const { blob } = await blobManager.submit({
      data,
      submitter: testAddress,
    });
    
    expect(blobManager.getMetadata(blob.id)?.status).toBe('pending');
    
    blobManager.updateStatus(blob.id, 'available');
    expect(blobManager.getMetadata(blob.id)?.status).toBe('available');
  });

  it('should list blobs by status', async () => {
    const data1 = new TextEncoder().encode('Blob 1');
    const data2 = new TextEncoder().encode('Blob 2');
    
    const { blob: blob1 } = await blobManager.submit({ data: data1, submitter: testAddress });
    const { blob: blob2 } = await blobManager.submit({ data: data2, submitter: testAddress });
    
    blobManager.updateStatus(blob1.id, 'available');
    
    const pending = blobManager.listByStatus('pending');
    const available = blobManager.listByStatus('available');
    
    expect(pending.length).toBe(1);
    expect(available.length).toBe(1);
  }, { timeout: 30000 }); // Extended timeout for KZG operations
});

describe('Data Availability Sampling', () => {
  it('should generate random sample indices', () => {
    const { generateSampleIndices } = require('../src/da/sampling');
    
    const indices = generateSampleIndices(32, 8);
    
    expect(indices.length).toBe(8);
    expect(new Set(indices).size).toBe(8); // All unique
    expect(indices.every((i: number) => i >= 0 && i < 32)).toBe(true);
  });

  it('should calculate required samples for confidence', () => {
    const { calculateRequiredSamples } = require('../src/da/sampling');
    
    // 99.99% confidence with 50% availability threshold
    const samples = calculateRequiredSamples(0.9999, 0.5);
    expect(samples).toBeGreaterThanOrEqual(13); // ~13.3 samples needed
  });
});

describe('DA Operator', () => {
  let operator: DAOperator;
  const privateKey = generatePrivateKey();

  beforeAll(async () => {
    // Initialize KZG trusted setup for commitment generation
    await initializeCommitmentSystem();
  });

  beforeEach(() => {
    operator = new DAOperator({
      privateKey,
      endpoint: 'http://localhost:3000',
      capacityGB: 100,
      region: 'us-east-1',
    });
  });

  it('should start and stop correctly', async () => {
    await operator.start();
    expect(operator.getStatus()).toBe('active');
    
    operator.stop();
    expect(operator.getStatus()).toBe('stopped');
  });

  it('should store and retrieve chunks', async () => {
    await operator.start();
    
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 4 });
    const data = new TextEncoder().encode('Operator chunk test');
    const blobId = computeBlobId(data);
    const chunks = codec.createChunks(data, blobId);
    const commitment = await createCommitment(
      chunks.map(c => c.data),
      chunks[0].data.length,
      4, 4
    );
    
    // Store chunks
    for (const chunk of chunks) {
      const stored = operator.storeChunk(
        blobId,
        chunk.index,
        chunk.data,
        chunk.proof,
        commitment
      );
      expect(stored).toBe(true);
    }
    
    expect(operator.hasBlob(blobId)).toBe(true);
    expect(operator.getChunkCount(blobId)).toBe(8);
    
    operator.stop();
  });

  it('should handle sample requests', async () => {
    await operator.start();
    
    const codec = createReedSolomonCodec({ dataShards: 4, parityShards: 4 });
    const data = new TextEncoder().encode('Sample request test');
    const blobId = computeBlobId(data);
    const chunks = codec.createChunks(data, blobId);
    const commitment = await createCommitment(
      chunks.map(c => c.data),
      chunks[0].data.length,
      4, 4
    );
    
    // Store chunks
    for (const chunk of chunks) {
      operator.storeChunk(blobId, chunk.index, chunk.data, chunk.proof, commitment);
    }
    
    // Create sample request
    const request = {
      blobId,
      chunkIndices: [0, 2, 4],
      requester: privateKeyToAccount(privateKey).address,
      nonce: keccak256(toBytes('test-nonce')) as Hex,
      timestamp: Date.now(),
    };
    
    const response = operator.handleSampleRequest(request);
    
    expect(response.chunks.length).toBe(3);
    expect(response.chunks.map(c => c.index).sort()).toEqual([0, 2, 4]);
    
    operator.stop();
  });

  it('should track metrics', async () => {
    await operator.start();
    
    const metrics = operator.getMetrics();
    
    expect(metrics.samplesResponded).toBe(0);
    expect(metrics.samplesFailed).toBe(0);
    expect(metrics.totalDataStored).toBe(0n);
    
    operator.stop();
  });
});

describe('Disperser', () => {
  it('should create disperser with blob manager', () => {
    const disperser = new Disperser();
    
    expect(disperser.getBlobManager()).toBeDefined();
    expect(disperser.getSampler()).toBeDefined();
  });

  it('should register and track operators', () => {
    const disperser = new Disperser();
    
    const operator: DAOperatorInfo = {
      address: '0x1234567890123456789012345678901234567890' as Address,
      agentId: 1n,
      stake: 1000n,
      endpoint: 'http://localhost:3001',
      teeAttestation: '0x' as Hex,
      region: 'us-east-1',
      capacityGB: 100,
      usedGB: 0,
      status: 'active',
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
    };
    
    disperser.registerOperator(operator);
    
    const active = disperser.getActiveOperators();
    expect(active.length).toBe(1);
    expect(active[0].address).toBe(operator.address);
  });
});

describe('Blob ID Computation', () => {
  it('should compute consistent blob IDs', () => {
    const data = new TextEncoder().encode('Consistent ID test');
    
    const id1 = computeBlobId(data);
    const id2 = computeBlobId(data);
    
    expect(id1).toBe(id2);
    expect(id1.startsWith('0x')).toBe(true);
    expect(id1.length).toBe(66); // 0x + 64 hex chars
  });

  it('should produce different IDs for different data', () => {
    const data1 = new TextEncoder().encode('Data 1');
    const data2 = new TextEncoder().encode('Data 2');
    
    const id1 = computeBlobId(data1);
    const id2 = computeBlobId(data2);
    
    expect(id1).not.toBe(id2);
  });
});

