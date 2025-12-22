/**
 * PeerDAS Integration Tests
 * 
 * Tests for EIP-7594 compatible PeerDAS functionality:
 * - 2D erasure coding
 * - Column-based custody
 * - Subnet distribution
 * - Light node sampling
 * - Blob reconstruction
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  PeerDAS,
  PeerDASBlobManager,
  createPeerDASBlobManager,
  DATA_COLUMN_COUNT,
  EXTENDED_COLUMN_COUNT,
  FIELD_ELEMENTS_PER_BLOB,
  MAX_BLOB_SIZE,
  CUSTODY_COLUMNS_PER_NODE,
  SAMPLES_PER_SLOT,
} from '../src/da';
import type { Address, Hex } from 'viem';
import { keccak256, toBytes } from 'viem';

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

describe('PeerDAS Constants', () => {
  it('should have correct data column count (128)', () => {
    expect(DATA_COLUMN_COUNT).toBe(128);
  });

  it('should have correct extended column count (256 = 2x data)', () => {
    expect(EXTENDED_COLUMN_COUNT).toBe(256);
    expect(EXTENDED_COLUMN_COUNT).toBe(DATA_COLUMN_COUNT * 2);
  });

  it('should have correct field elements per blob (4096)', () => {
    expect(FIELD_ELEMENTS_PER_BLOB).toBe(4096);
  });

  it('should have correct max blob size (128KB)', () => {
    expect(MAX_BLOB_SIZE).toBe(4096 * 32);
    expect(MAX_BLOB_SIZE).toBe(131072);
  });

  it('should have correct custody columns per node (8)', () => {
    expect(CUSTODY_COLUMNS_PER_NODE).toBe(8);
  });

  it('should have correct samples per slot (8)', () => {
    expect(SAMPLES_PER_SLOT).toBe(8);
  });
});

describe('PeerDAS Matrix Operations', () => {
  it('should convert blob to matrix', () => {
    const data = new Uint8Array(MAX_BLOB_SIZE);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }

    const matrix = PeerDAS.blobToMatrix(data);
    
    const expectedRows = FIELD_ELEMENTS_PER_BLOB / DATA_COLUMN_COUNT;
    expect(matrix.length).toBe(expectedRows);
    expect(matrix[0].length).toBe(DATA_COLUMN_COUNT);
  });

  it('should extend matrix with parity columns', () => {
    const data = new Uint8Array(MAX_BLOB_SIZE);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }

    const matrix = PeerDAS.blobToMatrix(data);
    const extended = PeerDAS.extendMatrix(matrix);
    
    expect(extended[0].length).toBe(EXTENDED_COLUMN_COUNT);
    expect(extended.length).toBe(matrix.length);
  });

  it('should extract column from matrix', () => {
    const data = new Uint8Array(MAX_BLOB_SIZE);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }

    const matrix = PeerDAS.blobToMatrix(data);
    const extended = PeerDAS.extendMatrix(matrix);
    
    const column = PeerDAS.extractColumn(extended, 0);
    expect(column.length).toBe(matrix.length);
    expect(column[0].length).toBe(32); // Field element size
  });
});

describe('PeerDAS Commitments', () => {
  it('should compute column commitment', () => {
    const column = Array.from({ length: 32 }, (_, i) => 
      new Uint8Array(32).fill(i)
    );
    
    const commitment = PeerDAS.computeColumnCommitment(column);
    expect(commitment).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should compute row commitment', () => {
    const row = Array.from({ length: DATA_COLUMN_COUNT }, (_, i) => 
      new Uint8Array(32).fill(i)
    );
    
    const commitment = PeerDAS.computeRowCommitment(row);
    expect(commitment).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should compute blob commitment from column commitments', () => {
    const columnCommitments = Array.from({ length: EXTENDED_COLUMN_COUNT }, (_, i) => 
      keccak256(toBytes(`column-${i}`))
    );
    
    const blobCommitment = PeerDAS.computeBlobCommitment(columnCommitments);
    expect(blobCommitment).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should produce deterministic commitments', () => {
    const column = Array.from({ length: 32 }, () => 
      new Uint8Array(32).fill(42)
    );
    
    const commitment1 = PeerDAS.computeColumnCommitment(column);
    const commitment2 = PeerDAS.computeColumnCommitment(column);
    
    expect(commitment1).toBe(commitment2);
  });
});

describe('PeerDAS Custody Assignment', () => {
  it('should get subnet for column index', () => {
    expect(PeerDAS.getSubnetForColumn(0)).toBe(0);
    expect(PeerDAS.getSubnetForColumn(7)).toBe(0);
    expect(PeerDAS.getSubnetForColumn(8)).toBe(1);
    expect(PeerDAS.getSubnetForColumn(255)).toBe(31);
  });

  it('should get columns for subnet', () => {
    const subnet0Columns = PeerDAS.getColumnsForSubnet(0);
    expect(subnet0Columns).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    
    const subnet1Columns = PeerDAS.getColumnsForSubnet(1);
    expect(subnet1Columns).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('should compute custody columns for node', () => {
    const columns = PeerDAS.computeCustodyColumns(TEST_ADDRESS);
    
    expect(columns.length).toBe(CUSTODY_COLUMNS_PER_NODE);
    expect(new Set(columns).size).toBe(CUSTODY_COLUMNS_PER_NODE); // All unique
    
    // All columns should be valid indices
    for (const col of columns) {
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(EXTENDED_COLUMN_COUNT);
    }
  });

  it('should produce deterministic custody for same node and epoch', () => {
    const columns1 = PeerDAS.computeCustodyColumns(TEST_ADDRESS, 0n);
    const columns2 = PeerDAS.computeCustodyColumns(TEST_ADDRESS, 0n);
    
    expect(columns1).toEqual(columns2);
  });

  it('should produce different custody for different epochs', () => {
    const columns1 = PeerDAS.computeCustodyColumns(TEST_ADDRESS, 0n);
    const columns2 = PeerDAS.computeCustodyColumns(TEST_ADDRESS, 1n);
    
    expect(columns1).not.toEqual(columns2);
  });

  it('should compute custody subnets from columns', () => {
    const columns = PeerDAS.computeCustodyColumns(TEST_ADDRESS);
    const subnets = PeerDAS.computeCustodySubnets(columns);
    
    // Subnets should be unique
    expect(new Set(subnets).size).toBe(subnets.length);
    
    // Each subnet should contain at least one custody column
    for (const subnet of subnets) {
      const subnetColumns = PeerDAS.getColumnsForSubnet(subnet);
      const hasColumn = columns.some(c => subnetColumns.includes(c));
      expect(hasColumn).toBe(true);
    }
  });

  it('should create full custody assignment', () => {
    const assignment = PeerDAS.createCustodyAssignment(TEST_ADDRESS, 0n);
    
    expect(assignment.nodeId).toBe(TEST_ADDRESS);
    expect(assignment.columns.length).toBe(CUSTODY_COLUMNS_PER_NODE);
    expect(assignment.subnets.length).toBeGreaterThan(0);
  });
});

describe('PeerDAS Light Node Sampling', () => {
  it('should generate sample request with correct number of columns', () => {
    const blobRoot = keccak256(toBytes('test-blob'));
    const request = PeerDAS.generateLightSampleRequest(blobRoot, 1n);
    
    expect(request.blobRoot).toBe(blobRoot);
    expect(request.slot).toBe(1n);
    expect(request.columnIndices.length).toBe(SAMPLES_PER_SLOT);
    
    // All indices should be valid
    for (const idx of request.columnIndices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(EXTENDED_COLUMN_COUNT);
    }
  });

  it('should generate deterministic samples for same node', () => {
    const blobRoot = keccak256(toBytes('test-blob'));
    
    const request1 = PeerDAS.generateLightSampleRequest(blobRoot, 1n, TEST_ADDRESS);
    const request2 = PeerDAS.generateLightSampleRequest(blobRoot, 1n, TEST_ADDRESS);
    
    expect(request1.columnIndices).toEqual(request2.columnIndices);
  });

  it('should calculate availability confidence', () => {
    const confidence0 = PeerDAS.calculateAvailabilityConfidence(0, 8);
    expect(confidence0).toBe(0);
    
    const confidence4 = PeerDAS.calculateAvailabilityConfidence(4, 8);
    expect(confidence4).toBeGreaterThan(0.9);
    
    const confidence8 = PeerDAS.calculateAvailabilityConfidence(8, 8);
    expect(confidence8).toBeGreaterThanOrEqual(0.99); // At least 99%
  });
});

describe('PeerDAS Blob Manager', () => {
  let manager: PeerDASBlobManager;

  beforeEach(() => {
    manager = createPeerDASBlobManager();
  });

  it('should prepare blob with correct structure', () => {
    const data = new Uint8Array(1024);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }

    const blob = manager.prepare(data);
    
    expect(blob.data.length).toBe(MAX_BLOB_SIZE);
    expect(blob.matrix.length).toBeGreaterThan(0);
    expect(blob.extendedMatrix.length).toBe(blob.matrix.length);
    expect(blob.columnCommitments.length).toBe(EXTENDED_COLUMN_COUNT);
    expect(blob.rowCommitments.length).toBe(blob.matrix.length);
    expect(blob.commitment).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should get columns for operator custody', () => {
    const data = new Uint8Array(1024).fill(42);
    const blob = manager.prepare(data);
    
    const columns = manager.getColumnsForOperator(blob.commitment, TEST_ADDRESS);
    
    expect(columns.length).toBe(CUSTODY_COLUMNS_PER_NODE);
    
    for (const column of columns) {
      expect(column.index).toBeGreaterThanOrEqual(0);
      expect(column.index).toBeLessThan(EXTENDED_COLUMN_COUNT);
      expect(column.cells.length).toBeGreaterThan(0);
      expect(column.commitment).toMatch(/^0x[a-f0-9]{64}$/);
    }
  });

  it('should store and retrieve columns', () => {
    const data = new Uint8Array(1024).fill(42);
    const blob = manager.prepare(data);
    
    const columns = manager.getColumnsForOperator(blob.commitment, TEST_ADDRESS);
    
    // Store each column
    for (const column of columns) {
      const stored = manager.storeColumn(blob.commitment, column);
      expect(stored).toBe(true);
    }
    
    // Retrieve each column
    for (const column of columns) {
      const retrieved = manager.getColumn(blob.commitment, column.index);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.index).toBe(column.index);
    }
  });

  it('should reject invalid column commitment', () => {
    const data = new Uint8Array(1024).fill(42);
    const blob = manager.prepare(data);
    
    const columns = manager.getColumnsForOperator(blob.commitment, TEST_ADDRESS);
    const column = columns[0];
    
    // Corrupt the commitment
    const invalidColumn = {
      ...column,
      commitment: keccak256(toBytes('invalid')) as Hex,
    };
    
    const stored = manager.storeColumn(blob.commitment, invalidColumn);
    expect(stored).toBe(false);
  });

  it('should handle sample request', () => {
    const data = new Uint8Array(1024).fill(42);
    const blob = manager.prepare(data);
    
    // Store all columns first
    for (let c = 0; c < EXTENDED_COLUMN_COUNT; c++) {
      const columnCells = PeerDAS.extractColumn(blob.extendedMatrix, c);
      manager.storeColumn(blob.commitment, {
        index: c,
        cells: columnCells,
        proof: keccak256(toBytes(`proof-${c}`)),
        commitment: blob.columnCommitments[c],
      });
    }
    
    // Generate and handle sample request
    const request = PeerDAS.generateLightSampleRequest(blob.commitment, 1n);
    const response = manager.handleSampleRequest(request);
    
    expect(response.available).toBe(true);
    expect(response.columns.length).toBe(SAMPLES_PER_SLOT);
  });

  it('should report reconstructability', () => {
    const data = new Uint8Array(1024).fill(42);
    const blob = manager.prepare(data);
    
    // Initially not reconstructable
    expect(manager.canReconstruct(blob.commitment)).toBe(false);
    
    // Store enough columns
    for (let c = 0; c < DATA_COLUMN_COUNT; c++) {
      const columnCells = PeerDAS.extractColumn(blob.extendedMatrix, c);
      manager.storeColumn(blob.commitment, {
        index: c,
        cells: columnCells,
        proof: keccak256(toBytes(`proof-${c}`)),
        commitment: blob.columnCommitments[c],
      });
    }
    
    // Now reconstructable
    expect(manager.canReconstruct(blob.commitment)).toBe(true);
  });

  it('should get statistics', () => {
    const stats = manager.getStats();
    
    expect(stats.blobCount).toBe(0);
    expect(stats.columnCount).toBe(0);
    expect(stats.reconstructable).toBe(0);
    
    // Add a blob
    const data = new Uint8Array(1024).fill(42);
    manager.prepare(data);
    
    const stats2 = manager.getStats();
    expect(stats2.blobCount).toBe(1);
  });
});

describe('PeerDAS End-to-End Flow', () => {
  it('should complete full PeerDAS workflow', async () => {
    const manager = createPeerDASBlobManager();
    
    // 1. Prepare blob data
    const originalData = new Uint8Array(2048);
    for (let i = 0; i < originalData.length; i++) {
      originalData[i] = (i * 17) % 256; // Some pattern
    }
    
    // 2. Prepare blob for distribution
    const blob = manager.prepare(originalData);
    expect(blob.commitment).toMatch(/^0x[a-f0-9]{64}$/);
    
    // 3. Distribute columns to operators
    const operators = [
      '0x1111111111111111111111111111111111111111' as Address,
      '0x2222222222222222222222222222222222222222' as Address,
      '0x3333333333333333333333333333333333333333' as Address,
      '0x4444444444444444444444444444444444444444' as Address,
    ];
    
    const operatorColumns: Map<Address, number[]> = new Map();
    
    // Store ALL columns to ensure sampling can find them
    for (let c = 0; c < EXTENDED_COLUMN_COUNT; c++) {
      const columnCells = PeerDAS.extractColumn(blob.extendedMatrix, c);
      manager.storeColumn(blob.commitment, {
        index: c,
        cells: columnCells,
        proof: keccak256(toBytes(`proof-${c}`)),
        commitment: blob.columnCommitments[c],
      });
    }
    
    // Track which operators custody which columns
    for (const operator of operators) {
      const columns = manager.getColumnsForOperator(blob.commitment, operator);
      operatorColumns.set(operator, columns.map(c => c.index));
    }
    
    // 4. Light node sampling verification
    const blobRoot = blob.commitment;
    const sampleRequest = PeerDAS.generateLightSampleRequest(blobRoot, 1n);
    const sampleResponse = manager.handleSampleRequest(sampleRequest);
    
    expect(sampleResponse.columns.length).toBeGreaterThan(0);
    
    // 5. Calculate availability confidence
    const confidence = PeerDAS.calculateAvailabilityConfidence(
      sampleResponse.columns.length,
      sampleRequest.columnIndices.length
    );
    
    expect(confidence).toBeGreaterThan(0.9);
    
    // 6. Verify sample response
    const isValid = PeerDAS.verifySampleResponse(sampleRequest, sampleResponse, blob.commitment);
    expect(isValid).toBe(true);
    
    console.log(`PeerDAS E2E: ${operators.length} operators, ${confidence * 100}% confidence`);
  });
});

